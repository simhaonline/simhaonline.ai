# Simha worker: background jobs + tiny status API.
# Jobs (asyncio): gateway-triggered discovery, status health snapshots,
# TimescaleDB rollups, email delivery queue (Valkey pubsub), semantic memory
# indexer (pgvector), scheduled task runner.
import asyncio
import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import psycopg
from psycopg_pool import AsyncConnectionPool
import redis.asyncio as aioredis
from fastapi import FastAPI

LOG = logging.getLogger("simha.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://simha:simha_dev_password@localhost:5433/simhaonline")
VALKEY_URL = os.environ.get("VALKEY_URL", "redis://localhost:6380/2")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://gateway:8080")
CONTROL_URL = os.environ.get("CONTROL_PLANE_URL", "http://control-plane:8081")
DISCOVERY_INTERVAL = int(os.environ.get("MODEL_REFRESH_INTERVAL", "300"))
STATUS_INTERVAL = int(os.environ.get("STATUS_SNAPSHOT_INTERVAL", "60"))

pool: AsyncConnectionPool | None = None


async def db() -> AsyncConnectionPool:
    global pool
    if pool is None:
        pool = AsyncConnectionPool(DB_URL, min_size=1, max_size=8, open=True)
    return pool


# ---------------- jobs ----------------

async def trigger_discovery():
    """Ask the gateway to run one model-discovery pass (leader-locked)."""
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{GATEWAY_URL}/internal/refresh-models")
            if r.status_code == 200:
                LOG.info("discovery triggered")
            else:
                LOG.warning("discovery trigger: HTTP %s", r.status_code)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("discovery trigger failed: %s", exc)


async def discovery_loop():
    while True:
        await trigger_discovery()
        await asyncio.sleep(DISCOVERY_INTERVAL)


async def status_snapshot():
    """Record one public health snapshot (Provider / Models components)."""
    global pool
    if pool is None:
        pool = await db()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{GATEWAY_URL}/healthz")
            provider_ok = r.status_code == 200
        async with httpx.AsyncClient(timeout=10) as client:
            r2 = await client.get(f"{CONTROL_URL}/healthz")
            cp_ok = r2.status_code == 200
    except Exception:  # noqa: BLE001
        provider_ok = False
        cp_ok = False
    try:
        async with pool.connection() as c:
            async with c.cursor() as cur:
                # models_ok: at least one discovered model exists
                await cur.execute("SELECT COUNT(*) FROM discovered_models")
                n = (await cur.fetchone())[0]
                models_ok = n > 0
                await cur.execute(
                    "INSERT INTO status_checks(checked_at, provider_ok, models_ok) VALUES (now(), %s, %s)",
                    (provider_ok, models_ok),
                )
        LOG.info("status snapshot recorded (provider_ok=%s models_ok=%s cp_ok=%s)", provider_ok, models_ok, cp_ok)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("status snapshot failed: %s", exc)


async def status_loop():
    while True:
        await status_snapshot()
        await asyncio.sleep(STATUS_INTERVAL)


async def email_worker():
    """Consume control-plane email publishes and deliver via SMTP (no-op if unconfigured)."""
    r = aioredis.from_url(VALKEY_URL, decode_responses=True)
    pubsub = r.pubsub()
    await pubsub.subscribe("simha:email")
    smtp_host = os.environ.get("SMTP_HOST", "")
    async for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        try:
            doc = json.loads(message["data"])
        except (ValueError, TypeError):
            continue
        if not smtp_host:
            LOG.info("email skipped (SMTP unconfigured): %s -> %s", doc.get("subject"), doc.get("recipient"))
            continue
        try:
            import smtplib
            from email.message import EmailMessage

            m = EmailMessage()
            m["Subject"] = doc.get("subject", "")
            m["From"] = os.environ.get("SMTP_FROM", "no-reply@simhaonline.ai")
            m["To"] = doc.get("recipient", "")
            m.set_content(doc.get("text", ""))
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None,
                lambda: _send_smtp(m, smtp_host, int(os.environ.get("SMTP_PORT", "587")),
                                   os.environ.get("SMTP_USER", ""), os.environ.get("SMTP_PASS", "")),
            )
            LOG.info("email delivered: %s", doc.get("subject"))
        except Exception as exc:  # noqa: BLE001
            LOG.warning("email delivery failed: %s", exc)


def _send_smtp(m, host, port, user, password):
    with smtplib.SMTP(host, port, timeout=15) as server:
        server.starttls()
        if user:
            server.login(user, password)
        server.send_message(m)


async def rollups():
    """Continuous aggregates are replaced by a simple daily token rollup view refresh."""
    try:
        async with pool.connection() as c:
            await c.execute("""
                CREATE MATERIALIZED VIEW IF NOT EXISTS usage_daily AS
                SELECT time_bucket('1 day', requested_at) AS day,
                       account_name, model,
                       SUM(prompt_tokens) AS prompt_tokens,
                       SUM(completion_tokens) AS completion_tokens,
                       SUM(total_tokens) AS total_tokens,
                       COUNT(*) AS requests
                FROM request_history
                GROUP BY 1, 2, 3
                WITH NO DATA
            """)
            await c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_daily ON usage_daily(day, account_name, model)")
            await c.execute("REFRESH MATERIALIZED VIEW usage_daily")
        LOG.info("usage_daily rollup refreshed")
    except Exception as exc:  # noqa: BLE001
        LOG.warning("rollup failed: %s", exc)


async def rollup_loop():
    while True:
        await rollups()
        await asyncio.sleep(900)


async def scheduled_runner():
    """Queue due scheduled tasks as chat messages (parity with legacy scheduler)."""
    try:
        async with pool.connection() as c:
            async with c.cursor() as cur:
                await cur.execute("""
                    UPDATE scheduled_tasks SET status = 'running'
                    WHERE status = 'queued' AND run_at IS NOT NULL AND run_at <= now()
                    RETURNING id, user_id, prompt
                """)
                tasks = await cur.fetchall()
                for tid, user_id, prompt in tasks:
                    # enqueue via Valkey for the gateway-adjacent chat loop
                    await c.execute(
                        "INSERT INTO generated_content(user_id, kind, prompt, status) VALUES (%s, 'task', %s, 'queued')",
                        (user_id, prompt),
                    )
                    await c.execute("UPDATE scheduled_tasks SET status = 'done' WHERE id = %s", (tid,))
        if tasks:
            LOG.info("scheduled tasks dispatched: %d", len(tasks))
    except Exception as exc:  # noqa: BLE001
        LOG.warning("scheduler failed: %s", exc)


async def scheduler_loop():
    while True:
        await scheduled_runner()
        await asyncio.sleep(60)


# ---------------- semantic memory (pgvector) ----------------

async def index_semantic(doc_kind: str, ref_id: str, content: str):
    """384-dim embedding via hashing-based fallback vector (deterministic,
    zero external calls). Real embeddings can be swapped in later without a
    schema change."""
    vec = _hash_embedding(content, 384)
    async with pool.connection() as c:
        await c.execute(
            """
            INSERT INTO semantic_memory(kind, ref_id, content, embedding)
            VALUES (%s, %s, %s, %s::vector)
            """,
            (doc_kind, ref_id, content[:4000], "[" + ",".join(f"{x:.6f}" for x in vec) + "]"),
        )


def _hash_embedding(text: str, dim: int) -> list[float]:
    """Deterministic token-histogram embedding (bag-of-words hashed to dim)."""
    vec = [0.0] * dim
    for token in text.lower().split():
        h = int(hashlib.sha256(token.encode()).hexdigest(), 16)
        vec[h % dim] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


async def semantic_seed():
    """Seed semantic_memory with the provider catalog once."""
    try:
        catalog_path = os.environ.get("PROVIDER_CATALOG", "/config/provider_catalog.json")
        async with pool.connection() as c:
            async with c.cursor() as cur:
                await cur.execute("SELECT COUNT(*) FROM semantic_memory")
                n = (await cur.fetchone())[0]
                if n > 0:
                    return
                await cur.execute("SELECT value FROM app_settings WHERE key = 'provider_catalog'")
                row = await cur.fetchone()
                doc = json.loads(row[0]) if row else {}
                for category, items in (doc or {}).items():
                    if not isinstance(items, list):
                        continue
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        text = f"{item.get('name', '')} {item.get('id', '')} {category} protocol {item.get('protocol', '')}"
                        await index_semantic("provider", str(item.get("id", "")), text)
            LOG.info("semantic memory seeded")
    except Exception as exc:  # noqa: BLE001
        LOG.warning("semantic seed failed: %s", exc)


# ---------------- nightly database backup (pg_dump) ----------------

async def backup_run():
    """Run one pg_dump cycle (gzip-compressed) and prune old backups."""
    backup_dir = os.environ.get("BACKUP_DIR", "/backups")
    try:
        os.makedirs(backup_dir, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        path = os.path.join(backup_dir, f"simhaonline_{stamp}.sql.gz")
        proc = await asyncio.create_subprocess_shell(
            f'pg_dump --no-owner --no-privileges --dbname "$SIMHA_DB" | gzip > "{path}"',
            env={**os.environ, "SIMHA_DB": DB_URL},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            LOG.warning("pg_dump failed: %s", err.decode()[-300:])
            return
        size = os.path.getsize(path)
        LOG.info("backup written: %s (%d bytes)", path, size)
        # prune: keep 7 newest
        backups = sorted(
            f for f in os.listdir(backup_dir) if f.startswith("simhaonline_") and f.endswith(".sql.gz")
        )
        for old in backups[:-7]:
            os.remove(os.path.join(backup_dir, old))
            LOG.info("pruned old backup: %s", old)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("backup failed: %s", exc)


async def backup_loop():
    interval = int(os.environ.get("BACKUP_INTERVAL", "86400"))
    await asyncio.sleep(120)  # let the DB settle after boot
    while True:
        await backup_run()
        await asyncio.sleep(interval)


# ---------------- http surface ----------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = AsyncConnectionPool(DB_URL, min_size=1, max_size=8, open=True)
    tasks = [
        asyncio.create_task(discovery_loop(), name="discovery"),
        asyncio.create_task(status_loop(), name="status"),
        asyncio.create_task(email_worker(), name="email"),
        asyncio.create_task(rollup_loop(), name="rollups"),
        asyncio.create_task(scheduler_loop(), name="scheduler"),
        asyncio.create_task(backup_loop(), name="backup"),
        asyncio.create_task(_seed_delayed(), name="seed"),
    ]
    LOG.info("worker started")
    yield
    for t in tasks:
        t.cancel()
    await pool.close()


async def _seed_delayed():
    await asyncio.sleep(5)
    await semantic_seed()


app = FastAPI(title="Simha Worker", lifespan=lifespan)


@app.get("/healthz")
async def health():
    return {"status": "ok", "service": "simha-worker", "time": int(time.time())}


@app.get("/status/recent")
async def status_recent(limit: int = 15):
    """Public status feed: recent health snapshots (oldest→newest)."""
    limit = max(1, min(limit, 100))
    async with pool.connection() as c:
        async with c.cursor() as cur:
            await cur.execute(
                """
                SELECT checked_at, provider_ok, models_ok
                FROM status_checks
                ORDER BY checked_at DESC LIMIT %s
                """,
                (limit,),
            )
            rows = await cur.fetchall()
    return {
        "checks": [
            {"checked_at": r[0].isoformat(), "provider_ok": r[1], "models_ok": r[2]}
            for r in reversed(rows)
        ]
    }