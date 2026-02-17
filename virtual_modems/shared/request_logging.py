from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import logging
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


def _preview_body(raw: bytes, limit: int = 700) -> str:
    if not raw:
        return ""
    text = raw.decode("utf-8", errors="replace").replace("\n", "\\n")
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...<truncated {len(text) - limit} chars>"


@dataclass
class RequestLogEntry:
    ts: str
    method: str
    path: str
    query: str
    status: int
    duration_ms: float
    client_ip: str
    body_preview: str
    error: str | None = None


class RequestLogStore:
    def __init__(self, name: str, max_entries: int = 3000) -> None:
        self._entries: deque[RequestLogEntry] = deque(maxlen=max_entries)
        self.logger = logging.getLogger(f"virtual_modems.{name}")
        self.name = name

    def add(self, entry: RequestLogEntry) -> None:
        self._entries.append(entry)
        self.logger.info(
            "[%s] %s %s%s -> %s in %.1fms ip=%s",
            self.name,
            entry.method,
            entry.path,
            f"?{entry.query}" if entry.query else "",
            entry.status,
            entry.duration_ms,
            entry.client_ip,
        )
        if entry.error:
            self.logger.error("[%s] error=%s", self.name, entry.error)

    def list(self, limit: int = 200) -> list[dict[str, Any]]:
        if limit <= 0:
            limit = 1
        values = list(self._entries)[-limit:]
        return [asdict(item) for item in values]

    def clear(self) -> int:
        count = len(self._entries)
        self._entries.clear()
        return count

    def size(self) -> int:
        return len(self._entries)


def install_request_logging(
    app: FastAPI,
    profile_name: str,
    *,
    max_entries: int = 3000,
) -> RequestLogStore:
    store = RequestLogStore(profile_name, max_entries=max_entries)
    app.state.request_log_store = store

    @app.middleware("http")
    async def request_logger(request: Request, call_next):
        started = time.perf_counter()
        raw_body = await request.body()
        body_preview = _preview_body(raw_body)
        client_ip = request.client.host if request.client else "unknown"
        error_message: str | None = None
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception as err:  # pragma: no cover - passthrough for runtime visibility
            error_message = repr(err)
            raise
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            store.add(
                RequestLogEntry(
                    ts=datetime.now(timezone.utc).isoformat(),
                    method=request.method,
                    path=request.url.path,
                    query=request.url.query,
                    status=status_code,
                    duration_ms=duration_ms,
                    client_ip=client_ip,
                    body_preview=body_preview,
                    error=error_message,
                )
            )

    @app.get("/_debug/requests")
    async def debug_requests(limit: int = 200):
        return {"count": store.size(), "items": store.list(limit=limit)}

    @app.post("/_debug/requests/clear")
    async def clear_debug_requests():
        deleted = store.clear()
        return {"deleted": deleted}

    return store
