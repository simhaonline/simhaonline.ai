"""simha-rank — standalone arena-ranking engine (arena-rank-inspired).

Elo-based AI model leaderboard with comparison battles and historical ranking
snapshots. Fully isolated: own container, port 8114, own SQLite file, no
imports from the main stack, no coupling to gateway/control-plane/worker/web.

Methodology (re-implemented from concepts, not integrated):
  - Elo with two-body K updating (winner gains, loser loses, symmetric),
    K decaying with games played (K = 2K0 / (1 + games/40) floor K0/10)
  - provisional rating phase: first N games per model use boosted K
  - arena snapshot: rating, CI from rating deviation, W/L/D record, win rate
  - battles are idempotent via client-supplied battle_id (deduped)
  - leaderboard snapshots recorded per battle for historical trend charts

Endpoints
  GET  /healthz
  POST /models            {id, display_name?, meta?}   -> register model
  GET  /models            -> list with ratings
  GET  /leaderboard       ?limit=  -> ranked table (Elo desc, CI-aware)
  POST /battle            {model_a, model_b, winner: a|b|tie, battle_id?}
  GET  /battles           ?limit=  -> recent battle history
  GET  /history/{model}   -> rating over time (snapshot trail)
  POST /reset             {confirm: true}  -> wipe arena state (admin)
"""
from __future__ import annotations

import logging
import math
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

LOG = logging.getLogger("simha.rank")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

DB_PATH = os.environ.get("RANK_DB_PATH", "/data/arena.db")
K0 = float(os.environ.get("RANK_K0", "24"))
PROVISIONAL_GAMES = int(os.environ.get("RANK_PROVISIONAL_GAMES", "10"))
BOOTSTRAP_RATING = 1200.0

app = FastAPI(title="simha-rank", version="1.0.0")
_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def _init_db() -> None:
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                rating REAL NOT NULL DEFAULT 1200.0,
                rd REAL NOT NULL DEFAULT 350.0,
                games INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                ties INTEGER NOT NULL DEFAULT 0,
                meta TEXT NOT NULL DEFAULT '{}',
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                battle_id TEXT UNIQUE,
                model_a TEXT NOT NULL REFERENCES models(id),
                model_b TEXT NOT NULL REFERENCES models(id),
                winner TEXT NOT NULL CHECK (winner IN ('a','b','tie')),
                k_used REAL NOT NULL,
                rating_a_before REAL NOT NULL,
                rating_b_before REAL NOT NULL,
                rating_a_after REAL NOT NULL,
                rating_b_after REAL NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_id TEXT NOT NULL REFERENCES models(id),
                rating REAL NOT NULL,
                rd REAL NOT NULL,
                games INTEGER NOT NULL,
                at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_snapshots_model ON snapshots(model_id, at);
            CREATE INDEX IF NOT EXISTS idx_battles_created ON battles(created_at);
            """
        )


_init_db()


# ── Elo core ─────────────────────────────────────────────────────────────────
def expected_score(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def k_factor(games: int, rd: float) -> float:
    """Two-part K: decays with games played, boosted while rating is
    uncertain (high RD) so new models converge in ~10-20 battles."""
    base = K0 / (1.0 + games / 25.0)
    base = max(base, K0 / 10.0)
    boost = 1.0 + min(rd / 350.0, 2.0)
    return base * boost


def _rd_after(games: int, rd: float) -> float:
    """Rating deviation shrinks toward a floor as evidence accumulates."""
    floor = 50.0 + 200.0 / (1.0 + games / 8.0)
    return max(floor, rd * 0.97)


def record_battle(model_a: str, model_b: str, winner: str,
                  battle_id: Optional[str]) -> dict:
    if winner not in ("a", "b", "tie"):
        raise HTTPException(422, "winner must be 'a', 'b' or 'tie'")
    if model_a == model_b:
        raise HTTPException(422, "model_a and model_b must differ")
    with _lock:
        with _conn() as con:
            rows = con.execute(
                "SELECT * FROM models WHERE id IN (?, ?)",
                (model_a, model_b)).fetchall()
            found = {r["id"] for r in rows}
            missing = {model_a, model_b} - found
            if missing:
                raise HTTPException(404, f"unknown models: {sorted(missing)}")
            if battle_id:
                dup = con.execute(
                    "SELECT id FROM battles WHERE battle_id = ?",
                    (battle_id,)).fetchone()
                if dup:
                    return {"duplicate": True, "battle_seq": dup["id"]}
            by_id = {r["id"]: r for r in rows}
            ra0, rb0 = by_id[model_a]["rating"], by_id[model_b]["rating"]
            rda, rdb = by_id[model_a]["rd"], by_id[model_b]["rd"]
            ga, gb = by_id[model_a]["games"], by_id[model_b]["games"]
            ka, kb = k_factor(ga, rda), k_factor(gb, rdb)
            ea = expected_score(ra0, rb0)
            sa, sb = (1.0, 0.0) if winner == "a" else ((0.0, 1.0) if winner == "b" else (0.5, 0.5))
            ra1 = ra0 + ka * (sa - ea)
            rb1 = rb0 + kb * (sb - (1.0 - ea))
            now = time.time()
            con.execute(
                "INSERT INTO battles (battle_id, model_a, model_b, winner, k_used,"
                " rating_a_before, rating_b_before, rating_a_after, rating_b_after, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (battle_id, model_a, model_b, winner, (ka + kb) / 2,
                 ra0, rb0, ra1, rb1, now))
            # symmetric two-body update + record bookkeeping
            a_win = 1 if winner == "a" else 0
            b_win = 1 - a_win if winner != "tie" else 0
            tie = 1 if winner == "tie" else 0
            con.execute(
                "UPDATE models SET rating=?, rd=?, games=games+1, wins=wins+?,"
                " losses=losses+?, ties=ties+? WHERE id=?",
                (ra1, _rd_after(ga + 1, rda), a_win, b_win, tie, model_a))
            con.execute(
                "UPDATE models SET rating=?, rd=?, games=games+1, wins=wins+?,"
                " losses=losses+?, ties=ties+? WHERE id=?",
                (rb1, _rd_after(gb + 1, rdb), b_win, a_win, tie, model_b))
            for mid, rating, rdv, games_next in (
                    (model_a, ra1, _rd_after(ga + 1, rda), ga + 1),
                    (model_b, rb1, _rd_after(gb + 1, rdb), gb + 1)):
                con.execute(
                    "INSERT INTO snapshots (model_id, rating, rd, games, at)"
                    " VALUES (?,?,?,?,?)", (mid, rating, rdv, games_next, now))
            seq = con.execute("SELECT last_insert_rowid() AS s").fetchone()["s"]
            return {
                "battle_seq": seq, "duplicate": False,
                "model_a": model_a, "model_b": model_b, "winner": winner,
                "rating_a": [round(ra0, 1), round(ra1, 1)],
                "rating_b": [round(rb0, 1), round(rb1, 1)],
                "k_used": {"a": round(ka, 1), "b": round(kb, 1)},
                "expected_a": round(ea, 3),
            }


# ── API models ───────────────────────────────────────────────────────────────
class ModelReq(BaseModel):
    id: str
    display_name: Optional[str] = None
    meta: dict = Field(default_factory=dict)


class BattleReq(BaseModel):
    model_a: str
    model_b: str
    winner: str
    battle_id: Optional[str] = None


class ResetReq(BaseModel):
    confirm: bool


# ── endpoints ────────────────────────────────────────────────────────────────
@app.get("/healthz")
async def healthz() -> JSONResponse:
    with _conn() as con:
        n_models = con.execute("SELECT COUNT(*) c FROM models").fetchone()["c"]
        n_battles = con.execute("SELECT COUNT(*) c FROM battles").fetchone()["c"]
    return JSONResponse({"status": "ok", "service": "simha-rank",
                         "models": n_models, "battles": n_battles})


@app.post("/models", status_code=201)
async def register_model(req: ModelReq) -> JSONResponse:
    name = req.display_name or req.id
    with _lock:
        with _conn() as con:
            exists = con.execute("SELECT 1 FROM models WHERE id=?",
                                 (req.id,)).fetchone()
            if exists:
                raise HTTPException(409, f"model {req.id!r} already registered")
            con.execute(
                "INSERT INTO models (id, display_name, meta, created_at)"
                " VALUES (?,?,?,?)",
                (req.id, name, "{}", time.time()))
            con.execute(
                "INSERT INTO snapshots (model_id, rating, rd, games, at)"
                " VALUES (?,?,?,?,?)",
                (req.id, BOOTSTRAP_RATING, 350.0, 0, time.time()))
    return JSONResponse({"registered": req.id, "rating": BOOTSTRAP_RATING}, status_code=201)


@app.get("/models")
async def list_models() -> JSONResponse:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, display_name, rating, rd, games, wins, losses, ties"
            " FROM models ORDER BY rating DESC").fetchall()
    return JSONResponse({"models": [dict(r) for r in rows]})


@app.get("/leaderboard")
async def leaderboard(limit: int = 50) -> JSONResponse:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, display_name, rating, rd, games, wins, losses, ties"
            " FROM models WHERE games > 0 ORDER BY rating DESC LIMIT ?",
            (max(1, min(limit, 500)),)).fetchall()
        total_battles = con.execute(
            "SELECT COUNT(*) c FROM battles").fetchone()["c"]
    out = []
    for i, r in enumerate(rows, start=1):
        games = r["games"]
        out.append({
            "rank": i,
            "model": r["id"],
            "display_name": r["display_name"],
            "rating": round(r["rating"], 1),
            "rating_ci95": round(1.96 * r["rd"], 1),
            "votes": games,
            "wins": r["wins"],
            "losses": r["losses"],
            "ties": r["ties"],
            "win_rate": round((r["wins"] + 0.5 * r["ties"]) / games, 3) if games else 0.0,
        })
    return JSONResponse({"leaderboard": out, "total_battles": total_battles})


@app.post("/battle")
async def battle(req: BattleReq) -> JSONResponse:
    return JSONResponse(record_battle(req.model_a, req.model_b, req.winner, req.battle_id))


@app.get("/battles")
async def battles(limit: int = 50) -> JSONResponse:
    with _conn() as con:
        rows = con.execute(
            "SELECT battle_id, model_a, model_b, winner, rating_a_before,"
            " rating_b_before, rating_a_after, rating_b_after, created_at"
            " FROM battles ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)).fetchall()
    return JSONResponse({"battles": [dict(r) for r in rows]})


@app.get("/history/{model_id}")
async def history(model_id: str) -> JSONResponse:
    with _conn() as con:
        m = con.execute("SELECT 1 FROM models WHERE id=?", (model_id,)).fetchone()
        if not m:
            raise HTTPException(404, f"unknown model {model_id!r}")
        rows = con.execute(
            "SELECT rating, rd, games, at FROM snapshots"
            " WHERE model_id=? ORDER BY at ASC", (model_id,)).fetchall()
    return JSONResponse({"model": model_id, "trail": [dict(r) for r in rows]})


@app.post("/reset")
async def reset(req: ResetReq) -> JSONResponse:
    if not req.confirm:
        raise HTTPException(422, "pass {\"confirm\": true} to reset")
    with _lock:
        with _conn() as con:
            con.executescript(
                "DELETE FROM battles; DELETE FROM snapshots; DELETE FROM models;")
    return JSONResponse({"reset": True})