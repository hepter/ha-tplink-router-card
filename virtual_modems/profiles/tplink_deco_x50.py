from __future__ import annotations

import json
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..shared.rsa_session import AesCbcContext, RsaKeyPair, parse_sign_payload
from ..shared.request_logging import install_request_logging


def _load_fixture() -> dict[str, Any]:
    file_path = Path(__file__).resolve().parents[1] / "data" / "tplink_deco_x50.json"
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


@dataclass
class DecoSession:
    sysauth: str
    stok: str
    aes: AesCbcContext


class TplinkDecoX50Mock:
    def __init__(self) -> None:
        self.fixture = _load_fixture()
        self.keys = RsaKeyPair.generate(1024)
        self.seq = 1000
        self.sessions: dict[str, DecoSession] = {}

    def _extract_kv(self, text: str) -> dict[str, str]:
        return {key: value for key, value in re.findall(r"([a-zA-Z0-9_]+)=([^&]+)", text)}

    def _decrypt_payload(self, aes: AesCbcContext, encrypted: str) -> dict[str, Any]:
        raw = aes.decrypt_b64(encrypted)
        return json.loads(raw)

    def _encrypt_payload(self, aes: AesCbcContext, payload: dict[str, Any]) -> str:
        return aes.encrypt_b64(json.dumps(payload, separators=(",", ":")))

    def _json_encrypted(self, session: DecoSession, payload: dict[str, Any]) -> JSONResponse:
        return JSONResponse({"error_code": 0, "data": self._encrypt_payload(session.aes, payload)})

    def _json_plain(self, payload: dict[str, Any]) -> JSONResponse:
        return JSONResponse(payload)

    def handle_login(self, sign_hex: str | None, data_b64: str | None) -> JSONResponse:
        if not sign_hex or not data_b64:
            return JSONResponse({"error_code": -1, "msg": "missing sign/data"}, status_code=400)

        try:
            sign_text = self.keys.decrypt_sign_chunks(sign_hex)
            sign_values = self._extract_kv(sign_text)
            key = sign_values.get("k")
            iv = sign_values.get("i")
        except Exception as err:
            return JSONResponse(
                {"error_code": -2, "msg": f"invalid sign payload: {err}"},
                status_code=400,
            )

        if not key or not iv:
            return JSONResponse({"error_code": -2, "msg": "invalid sign"}, status_code=400)

        try:
            aes = AesCbcContext.from_ascii(key, iv)
            payload = self._decrypt_payload(aes, data_b64)
        except Exception as err:
            return JSONResponse(
                {"error_code": -3, "msg": f"invalid encrypted payload: {err}"},
                status_code=400,
            )

        if payload.get("operation") != "login":
            return JSONResponse({"error_code": -4, "msg": "invalid operation"}, status_code=400)

        sysauth = secrets.token_hex(16)
        stok = f"deco-{secrets.token_hex(8)}"
        session = DecoSession(sysauth=sysauth, stok=stok, aes=aes)
        self.sessions[sysauth] = session

        response_payload = {"error_code": 0, "result": {"stok": stok}}
        response = JSONResponse({"error_code": 0, "data": self._encrypt_payload(aes, response_payload)})
        response.headers["set-cookie"] = f"sysauth={sysauth}; Path=/; HttpOnly"
        return response

    def _session_from_request(self, request: Request) -> DecoSession | None:
        cookie = request.headers.get("cookie", "")
        match = re.search(r"sysauth=([a-f0-9]+)", cookie)
        if not match:
            return None
        return self.sessions.get(match.group(1))

    def _read_request_payload(self, session: DecoSession, raw_body: bytes) -> dict[str, Any]:
        _, data_b64 = parse_sign_payload(raw_body)
        if not data_b64:
            return {}
        return self._decrypt_payload(session.aes, data_b64)

    def _device_list(self) -> list[dict[str, Any]]:
        devices: list[dict[str, Any]] = []
        for deco in self.fixture["decos"]:
            name = str(deco.get("name") or deco.get("device_model") or "Deco").strip()
            devices.append(
                {
                    "mac": deco["mac"],
                    "nickname": name.lower().replace(" ", "_"),
                    "custom_nickname": deco.get("custom_nickname"),
                    "role": deco.get("role", "slave"),
                    "device_model": deco.get("device_model", "Deco"),
                    "hardware_ver": deco.get("hardware_ver", "1.0"),
                    "software_ver": deco.get("software_ver", "1.0.0"),
                    "device_ip": deco.get("ip_address", "10.68.0.1"),
                    "group_status": "connected" if deco.get("online", True) else "disconnected",
                    "inet_status": "online" if deco.get("internet_online", True) else "offline",
                    "connection_type": deco.get("connection_type", "wired"),
                    "bssid_2g": deco.get("bssid_band2_4"),
                    "bssid_5g": deco.get("bssid_band5"),
                    "signal_level": {
                        "band2_4": deco.get("signal_band2_4"),
                        "band5": deco.get("signal_band5"),
                    },
                }
            )
        return devices

    def _client_list(self) -> list[dict[str, Any]]:
        clients: list[dict[str, Any]] = []
        for client in self.fixture["clients"]:
            clients.append(
                {
                    "name": client.get("name"),
                    "mac": client.get("mac"),
                    "ip": client.get("ip"),
                    "online": bool(client.get("online", True)),
                    "wire_type": client.get("wire_type", "wireless"),
                    "connection_type": client.get("connection_type", "band5"),
                    "interface": client.get("interface", "main"),
                    # ha-tplink-deco expects these keys and converts them internally.
                    "down_speed": client.get("down_speed", client.get("down_kilobytes_per_s", 0)),
                    "up_speed": client.get("up_speed", client.get("up_kilobytes_per_s", 0)),
                }
            )
        return clients


def create_app() -> FastAPI:
    mock = TplinkDecoX50Mock()
    app = FastAPI(title="Virtual TP-Link Deco X50", version="0.1.0")
    install_request_logging(app, "tplink_deco_x50")

    @app.get("/")
    async def root():
        return HTMLResponse(
            "<html><body><h1>Virtual TP-Link Deco X50</h1>"
            "<p>Use this URL as host in <code>ha-tplink-deco</code> integration.</p>"
            "</body></html>"
        )

    @app.post("/{full_path:path}")
    async def post_any(full_path: str, request: Request):
        query = parse_qs(request.url.query)
        form = (query.get("form") or [""])[0]
        path = f"/{full_path}"
        raw_body = await request.body()

        if path == "/cgi-bin/luci/;stok=/login":
            if form == "keys":
                return JSONResponse(
                    {
                        "error_code": 0,
                        "result": {
                            "password": [mock.keys.n_hex, mock.keys.e_hex],
                        },
                    }
                )
            if form == "auth":
                return JSONResponse(
                    {
                        "error_code": 0,
                        "result": {
                            "seq": mock.seq,
                            "key": [mock.keys.n_hex, mock.keys.e_hex],
                        },
                    }
                )
            if form == "login":
                sign_hex, data_b64 = parse_sign_payload(raw_body)
                return mock.handle_login(sign_hex, data_b64)

        session = mock._session_from_request(request)
        if session is None:
            return JSONResponse({"error_code": 403, "msg": "unauthorized"}, status_code=403)

        if not path.startswith(f"/cgi-bin/luci/;stok={session.stok}/"):
            return JSONResponse({"error_code": 404, "msg": "bad stok"}, status_code=404)

        endpoint = path.replace(f"/cgi-bin/luci/;stok={session.stok}/", "")
        payload = mock._read_request_payload(session, raw_body)

        if endpoint == "admin/device" and form == "device_list":
            return mock._json_encrypted(session, {"error_code": 0, "result": {"device_list": mock._device_list()}})

        if endpoint == "admin/network" and form == "wan_ipv4":
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": mock.fixture["network"]},
            )

        if endpoint == "admin/network" and form == "performance":
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": mock.fixture["performance"]},
            )

        if endpoint == "admin/wireless" and form == "wlan":
            if payload.get("operation") == "write":
                params = payload.get("params", {})
                for band_key, value in params.items():
                    if band_key in mock.fixture["wireless"] and isinstance(value, dict):
                        for group_name, group_payload in value.items():
                            if (
                                group_name in mock.fixture["wireless"][band_key]
                                and isinstance(group_payload, dict)
                                and "enable" in group_payload
                            ):
                                mock.fixture["wireless"][band_key][group_name]["enable"] = bool(
                                    group_payload["enable"]
                                )
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": mock.fixture["wireless"]},
            )

        if endpoint == "admin/client" and form == "client_list":
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": {"client_list": mock._client_list()}},
            )

        if endpoint == "admin/device" and form == "system":
            return mock._json_encrypted(session, {"error_code": 0, "result": {"reboot": "ok"}})

        if endpoint == "admin/system" and form == "logout":
            return mock._json_encrypted(session, {"error_code": 0, "result": {"logout": True}})

        return JSONResponse({"error_code": 404, "msg": f"unsupported endpoint {endpoint}::{form}"}, status_code=404)

    return app


app = create_app()
