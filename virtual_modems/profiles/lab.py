from __future__ import annotations

import re
from typing import Any, Awaitable, Callable

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from . import omada_controller, tplink_deco_x50

ASGIApp = Callable[[dict[str, Any], Callable[[], Awaitable[dict]], Callable[[dict], Awaitable[None]]], Awaitable[None]]

# Omada controller paths never overlap with the Deco luci paths, so both can share port 80.
OMADA_PATH = re.compile(r"^/(api/|openapi/|[^/]+/api/v2/)")
DEBUG_OMADA_PREFIX = "/_debug/omada"
DEBUG_DECO_PREFIX = "/_debug/deco"


def _rewrite_path(scope: dict[str, Any], prefix: str, replacement: str) -> dict[str, Any]:
    path = scope["path"].replace(prefix, replacement, 1)
    rewritten = dict(scope)
    rewritten["path"] = path
    rewritten["raw_path"] = path.encode("utf-8")
    return rewritten


def _landing_app() -> FastAPI:
    app = FastAPI(title="Virtual TP-Link Lab (Omada + Deco)", version="0.1.0")

    @app.get("/")
    async def root():
        return HTMLResponse(
            "<html><body><h1>Virtual TP-Link Lab</h1>"
            "<p>Two virtual devices share this host:</p>"
            "<ul>"
            "<li><b>Omada Controller</b> for <code>omada</code> / <code>tplink_omada</code>: "
            "use <code>http://&lt;ip&gt;</code> as controller URL (paths <code>/api/...</code>).</li>"
            "<li><b>Omada Open API</b> for <code>omada_open_api</code>: controller type Self-Hosted, "
            "URL <code>http://&lt;ip&gt;</code>, Omada ID <code>oc-virtual-001</code>, client id "
            "<code>virtual-open-api</code>, client secret <code>virtual-open-api-secret</code>.</li>"
            "<li><b>Deco X50</b> for <code>tplink_deco</code>: use <code>http://&lt;ip&gt;</code> as host "
            "(paths <code>/cgi-bin/luci/...</code>).</li>"
            "</ul>"
            "<p>Debug request logs: <code>/_debug/omada/requests</code>, <code>/_debug/deco/requests</code>.</p>"
            "<p>All virtual MACs use the <code>02:56:4D</code> prefix; names start with "
            "<code>Virtual</code> / <code>vm-</code>.</p>"
            "</body></html>"
        )

    return app


def create_app() -> ASGIApp:
    omada_app = omada_controller.create_app()
    deco_app = tplink_deco_x50.create_app()
    landing = _landing_app()

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
            return
        if scope["type"] != "http":
            await deco_app(scope, receive, send)
            return

        path = scope.get("path") or "/"
        if path == "/":
            await landing(scope, receive, send)
            return
        if path.startswith(DEBUG_OMADA_PREFIX):
            await omada_app(_rewrite_path(scope, DEBUG_OMADA_PREFIX, "/_debug"), receive, send)
            return
        if path.startswith(DEBUG_DECO_PREFIX):
            await deco_app(_rewrite_path(scope, DEBUG_DECO_PREFIX, "/_debug"), receive, send)
            return
        if OMADA_PATH.match(path):
            await omada_app(scope, receive, send)
            return
        await deco_app(scope, receive, send)

    return app


app = create_app()
