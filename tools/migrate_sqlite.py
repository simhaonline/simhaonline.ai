#!/usr/bin/env python3
"""SQLite (legacy ollama-proxy) → PostgreSQL (simhaonline.ai) migration tool.

Maps legacy SQLite tables to the live schema (database/01_schema.sql):

    users            → users               (email, password_hash pbkdf2$250k$sha256 kept verbatim)
    client_keys      → client_api_keys     (key_hash + prefix — existing keys stay valid)
    chats            → chat_history        (title/model/project preserved)
    messages         → chat_messages       (chat ids remapped to new chat_history ids)
    settings         → user_settings       (key/value pairs merged into settings_json)
    feedback         → feedback
    request_history  → request_history     (TimescaleDB hypertable, tokens/status mapped)
    accounts         → accounts            (provider accounts; secrets re-encrypted separately)
    request_windows  → skipped             (rolling windows are recomputed fresh by the gateway)

Usage (run as root or as a user that can read the legacy dir):

    sudo python3 tools/migrate_sqlite.py \
        --db /srv/ollama-proxy/simhaedge.db \
        --database-url postgresql://simha:PW@127.0.0.1:5433/simhaonline \
        [--dry-run] [--skip-existing]

Only tables present in the source are migrated; missing ones are skipped with a note.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

try:
    import psycopg
    from psycopg.types.json import Json
except ImportError:
    sys.exit("pip install 'psycopg[binary]' first (or use the worker venv)")


def fetch_all(sconn, table):
    cur = sconn.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return cols, [dict(zip(cols, row)) for row in cur.fetchall()]


def parse_dt(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(float(v), tz=timezone.utc)
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def as_json(v):
    if v is None or v == "":
        return None
    if isinstance(v, str):
        try:
            return Json(json.loads(v))
        except (ValueError, TypeError):
            return Json({"value": v})
    return Json(v)


def boolify(v):
    if isinstance(v, bool):
        return v
    return v in (1, "1", "true", "True", "t", "yes")


def migrate_users(pg, sconn, skip_existing):
    _, data = fetch_all(sconn, "users")
    n = 0
    with pg.cursor() as cur:
        for r in data:
            if skip_existing:
                cur.execute("SELECT 1 FROM users WHERE email = %s", (r.get("email"),))
                if cur.fetchone():
                    continue
            role = (r.get("role") or "user").lower()
            if role not in ("admin", "operator"):
                role = "operator"
            cur.execute(
                """INSERT INTO users (email, password_hash, role, active, created_at)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (email) DO NOTHING""",
                (
                    r.get("email"),
                    r.get("password_hash") or r.get("password"),
                    role,
                    boolify(r.get("is_active", 1)),
                    parse_dt(r.get("created_at")) or datetime.now(timezone.utc),
                ),
            )
            n += cur.rowcount
    return n


def migrate_client_keys(pg, sconn, skip_existing):
    _, data = fetch_all(sconn, "client_keys")
    n = 0
    with pg.cursor() as cur:
        for r in data:
            if skip_existing:
                cur.execute("SELECT 1 FROM client_api_keys WHERE key_hash = %s",
                            (r.get("key_hash") or r.get("hash"),))
                if cur.fetchone():
                    continue
            cur.execute(
                """INSERT INTO client_api_keys
                       (name, key_hash, key_prefix, active, created_at,
                        expires_at, last_used_at, request_count, owner_user_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (key_hash) DO NOTHING""",
                (
                    r.get("name") or "migrated",
                    r.get("key_hash") or r.get("hash"),
                    r.get("prefix") or "",
                    boolify(r.get("is_active", 1)),
                    parse_dt(r.get("created_at")) or datetime.now(timezone.utc),
                    parse_dt(r.get("expires_at")),
                    parse_dt(r.get("last_used_at")),
                    r.get("use_count") or r.get("request_count") or 0,
                    r.get("user_id") or r.get("owner_user_id"),
                ),
            )
            n += cur.rowcount
    return n


def migrate_chats_messages(pg, sconn):
    id_map = {}
    n_chats = 0
    with pg.cursor() as cur:
        _, chats = fetch_all(sconn, "chats")
        for r in chats:
            cur.execute(
                """INSERT INTO chat_history (user_id, project_id, title, model,
                                             created_at, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s) RETURNING id""",
                (
                    r.get("user_id") or r.get("owner"),
                    r.get("project_id"),
                    r.get("title") or "migrated chat",
                    r.get("model") or "auto",
                    parse_dt(r.get("created_at")) or datetime.now(timezone.utc),
                    parse_dt(r.get("updated_at")) or datetime.now(timezone.utc),
                ),
            )
            id_map[r.get("id")] = cur.fetchone()[0]
            n_chats += 1
    n_msgs = 0
    with pg.cursor() as cur:
        _, messages = fetch_all(sconn, "messages")
        for r in messages:
            cur.execute(
                """INSERT INTO chat_messages (chat_id, role, content, model, tokens, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (
                    id_map.get(r.get("chat_id")),
                    r.get("role") or "user",
                    r.get("content") or "",
                    r.get("model"),
                    r.get("tokens", 0),
                    parse_dt(r.get("created_at")) or datetime.now(timezone.utc),
                ),
            )
            n_msgs += cur.rowcount
    return {"chats": n_chats, "messages": n_msgs}


def migrate_settings_feedback(pg, sconn):
    # settings: legacy key/value rows → per-user settings_json
    n = 0
    with pg.cursor() as cur:
        _, data = fetch_all(sconn, "settings")
        per_user: dict = {}
        for r in data:
            uid = r.get("user_id")
            k = r.get("key")
            if uid is None or k is None:
                continue
            try:
                v = json.loads(r.get("value"))
            except (ValueError, TypeError):
                v = r.get("value")
            per_user.setdefault(uid, {})[k] = v
        for uid, blob in per_user.items():
            cur.execute(
                """INSERT INTO user_settings (user_id, settings_json, updated_at)
                   VALUES (%s,%s,now())
                   ON CONFLICT (user_id) DO UPDATE
                       SET settings_json = user_settings.settings_json || EXCLUDED.settings_json,
                           updated_at = now()""",
                (uid, Json(blob)),
            )
            n += 1
    # feedback
    f = 0
    try:
        _, data = fetch_all(sconn, "feedback")
    except sqlite3.OperationalError:
        return {"settings_users": n, "feedback": 0}
    with pg.cursor() as cur:
        for r in data:
            cur.execute(
                """INSERT INTO feedback (user_id, category, message, created_at)
                   VALUES (%s,%s,%s,%s)""",
                (
                    r.get("user_id"),
                    r.get("category") or "general",
                    r.get("message") or r.get("content") or "",
                    parse_dt(r.get("created_at")) or datetime.now(timezone.utc),
                ),
            )
            f += cur.rowcount
    return {"settings_users": n, "feedback": f}


def migrate_request_history(pg, sconn):
    try:
        _, data = fetch_all(sconn, "request_history")
    except sqlite3.OperationalError:
        print("  (no request_history table — skipping)")
        return 0
    n = 0
    with pg.cursor() as cur:
        for r in data:
            pin = r.get("tokens_in") or r.get("prompt_tokens") or 0
            pout = r.get("tokens_out") or r.get("completion_tokens") or 0
            cur.execute(
                """INSERT INTO request_history
                       (requested_at, account_name, model, status,
                        prompt_tokens, completion_tokens, total_tokens, client_key_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    parse_dt(r.get("ts") or r.get("created_at") or r.get("requested_at"))
                    or datetime.now(timezone.utc),
                    r.get("account") or r.get("account_name"),
                    r.get("model"),
                    r.get("status_code") if r.get("status_code") is not None else r.get("status"),
                    int(pin or 0),
                    int(pout or 0),
                    int(pin or 0) + int(pout or 0),
                    r.get("client_key_id"),
                ),
            )
            n += cur.rowcount
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="path to legacy SQLite file")
    ap.add_argument("--database-url", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-existing", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.db):
        sys.exit(f"SQLite file not found: {args.db}  (run as a user that can read it, e.g. sudo)")

    sconn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    sconn.row_factory = sqlite3.Row
    pg = psycopg.connect(args.database_url, autocommit=True)

    tables = {r[0] for r in sconn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    print(f"legacy tables: {sorted(tables)}")

    if args.dry_run:
        print("dry-run: no writes performed")
        return

    plan = []
    if "users" in tables:
        plan.append(("users", lambda: migrate_users(pg, sconn, args.skip_existing)))
    if "client_keys" in tables:
        plan.append(("client_keys", lambda: migrate_client_keys(pg, sconn, args.skip_existing)))
    if "chats" in tables:
        plan.append(("chats+messages", lambda: migrate_chats_messages(pg, sconn)))
    if "settings" in tables:
        plan.append(("settings+feedback", lambda: migrate_settings_feedback(pg, sconn)))
    if "request_history" in tables:
        plan.append(("request_history", lambda: migrate_request_history(pg, sconn)))

    report = {}
    for name, fn in plan:
        try:
            report[name] = fn()
            print(f"  {name}: {report[name]}")
        except Exception as e:  # noqa: BLE001
            print(f"  {name}: FAILED — {e}")
            report[name] = f"FAILED: {e}"

    print(json.dumps(report, indent=2, default=str))
    print("Migration complete.")


if __name__ == "__main__":
    main()