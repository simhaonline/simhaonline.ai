"""Platform contract helpers for Simha engines (Phase 1).

Each engine vendors this file into its own image (no cross-engine imports).
Provides: feature-flag guard, optional ENGINE_API_TOKEN guard, request
metrics, and /health/live + /health/ready + /metrics endpoints wired onto
the engine's FastAPI app.

Usage:
    from engine_contract import install_contract
    READY_CHECKS = {"state_dir_writable": lambda: os.access("/data", os.W_OK)}
    install_contract(app, engine="rank", flag_env="RANK_ENABLED", ready_checks=READY_CHECKS)
"""
from __future__ import annotations

import os
import time
from typing import Callable, Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

START_TIME = time.time()
REQUEST_COUNTS: dict[str, int] = {}
ERROR_COUNTS: dict[str, int] = {}


def install_contract(
    app: FastAPI,
    *,
    engine: str,
    flag_env: str,
    ready_checks: Optional[dict[str, Callable[[], bool]]] = None,
) -> None:
    def flag_enabled() -> bool:
        return os.environ.get(flag_env, "true").strip().lower() in ("1", "true", "yes", "on")

    @app.middleware("http")
    async def contract_guard(request: Request, call_next):
        path = request.url.path
        is_contract = path in ("/healthz", "/health/live", "/health/ready", "/metrics")
        if not is_contract:
            token = os.environ.get("ENGINE_API_TOKEN", "").strip()
            if token and request.headers.get("X-Engine-Token") != token:
                return JSONResponse({"error": "engine token required"}, status_code=401)
            if not flag_enabled():
                return JSONResponse(
                    {"error": "engine disabled by feature flag", "flag": flag_env},
                    status_code=503)
        resp = await call_next(request)
        key = f"{request.method} {path}"
        REQUEST_COUNTS[key] = REQUEST_COUNTS.get(key, 0) + 1
        if resp.status_code >= 500:
            ERROR_COUNTS[key] = ERROR_COUNTS.get(key, 0) + 1
        return resp

    @app.get("/health/live")
    async def live() -> JSONResponse:
        return JSONResponse({"status": "live", "service": f"simha-{engine}"})

    @app.get("/health/ready")
    async def ready() -> JSONResponse:
        checks = {name: bool(fn()) for name, fn in (ready_checks or {}).items()}
        ok = all(checks.values())
        return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks},
                            status_code=200 if ok else 503)

    @app.get("/metrics")
    async def metrics() -> Response:
        up = time.time() - START_TIME
        lines = [
            "# TYPE simha_engine_uptime_seconds gauge",
            f'simha_engine_uptime_seconds{{engine="{engine}"}} {up:.1f}',
            "# TYPE simha_engine_requests_total counter",
        ]
        for key in sorted(REQUEST_COUNTS):
            lines.append(
                f'simha_engine_requests_total{{engine="{engine}",route="{key}"}} {REQUEST_COUNTS[key]}')
        lines.append("# TYPE simha_engine_errors_total counter")
        for key in sorted(ERROR_COUNTS):
            lines.append(
                f'simha_engine_errors_total{{engine="{engine}",route="{key}"}} {ERROR_COUNTS[key]}')
        return Response("\n".join(lines) + "\n", media_type="text/plain")