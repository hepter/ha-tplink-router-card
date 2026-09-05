from __future__ import annotations

import base64
import json
import os
import re
import random
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..shared.rsa_session import AesCbcContext, RsaKeyPair, parse_sign_payload
from ..shared.request_logging import install_request_logging


GLOBAL_CLIENT_MAC = "default"


def _load_fixture() -> dict[str, Any]:
    file_path = Path(__file__).resolve().parents[1] / "data" / "tplink_deco_x50.json"
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _per_node_clients_enabled() -> bool:
    return os.getenv("VMODEM_DECO_CLIENT_MODE", "per_node").strip().lower() != "global_fallback"


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
        self._rand = random.Random()
        self._clients_catalog = self._build_client_catalog()
        self._client_runtime: dict[str, dict[str, Any]] = self._build_client_runtime()
        self._last_client_tick = time.monotonic()

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

    def _deco_macs(self) -> list[str]:
        return [str(deco["mac"]) for deco in self.fixture["decos"]]

    def _device_list(self) -> list[dict[str, Any]]:
        devices: list[dict[str, Any]] = []
        for deco in self.fixture["decos"]:
            name = str(deco.get("name") or deco.get("device_model") or "Deco").strip()
            custom_nickname = deco.get("custom_nickname")
            entry: dict[str, Any] = {
                "mac": deco["mac"],
                "nickname": name.lower().replace(" ", "_"),
                "custom_nickname": (
                    self._encode_client_name(str(custom_nickname))
                    if custom_nickname
                    else None
                ),
                "role": deco.get("role", "slave"),
                "device_model": deco.get("device_model", "Deco"),
                "hardware_ver": deco.get("hardware_ver", "1.0"),
                "software_ver": deco.get("software_ver", "1.0.0"),
                "device_ip": deco.get("ip_address", "10.68.0.1"),
                "group_status": "connected" if deco.get("online", True) else "disconnected",
                "connection_type": deco.get("connection_type", "wired"),
                "bssid_2g": deco.get("bssid_band2_4"),
                "bssid_5g": deco.get("bssid_band5"),
                "signal_level": {
                    "band2_4": deco.get("signal_band2_4"),
                    "band5": deco.get("signal_band5"),
                },
                # ha-tplink-deco reads the firmware's "backhual" misspelling; aliases are extra.
                "backhual_speed": deco.get("backhaul_speed"),
                "backhual_max_speed": deco.get("backhaul_max_speed"),
                "backhaul_speed": deco.get("backhaul_speed"),
                "backhaul_max_speed": deco.get("backhaul_max_speed"),
            }

            if "inet_status" in deco:
                # A null inet_status means the firmware omits the key entirely.
                if deco["inet_status"] is not None:
                    entry["inet_status"] = deco["inet_status"]
            else:
                entry["inet_status"] = "online" if deco.get("internet_online", True) else "offline"

            devices.append(entry)
        return devices

    def _encode_client_name(self, value: str) -> str:
        return base64.b64encode(value.encode("utf-8")).decode("ascii")

    def _ensure_encoded_name(self, value: Any) -> Any:
        if not isinstance(value, str) or not value:
            return value
        try:
            decoded = base64.b64decode(value, validate=True).decode("utf-8")
        except Exception:
            return self._encode_client_name(value)
        return value if decoded.startswith("vm-") else self._encode_client_name(value)

    def _build_generated_clients(self) -> list[dict[str, Any]]:
        groups = [
            ("wired-desktop", 8, "wired", "wired", "main"),
            ("wifi-5g", 14, "wireless", "band5", "main"),
            ("wifi-6g", 8, "wireless", "band6", "main"),
            ("iot-sensor", 10, "wireless", "band2_4", "iot"),
            ("guest-phone", 8, "wireless", "band5", "guest"),
            ("guest-2g", 4, "wireless", "band2_4", "guest"),
        ]
        deco_macs = self._deco_macs()
        generated: list[dict[str, Any]] = []
        ip_octet = 61
        mac_octet = 0x20
        spread = 0
        for prefix, count, wire_type, connection_type, interface in groups:
            for idx in range(1, count + 1):
                plain_name = f"vm-{prefix}-{idx:02d}"
                mac = f"02:56:4D:02:{mac_octet:02X}:{idx:02X}"
                generated.append(
                    {
                        "name": self._encode_client_name(plain_name),
                        "mac": mac,
                        "ip": f"10.68.1.{ip_octet}",
                        "online": True,
                        "wire_type": wire_type,
                        "connection_type": connection_type,
                        "interface": interface,
                        "deco_mac": deco_macs[spread % len(deco_macs)],
                    }
                )
                ip_octet += 1
                spread += 1
            mac_octet += 1
        return generated

    def _build_client_catalog(self) -> list[dict[str, Any]]:
        default_deco_mac = self._deco_macs()[0]
        fixture_clients: list[dict[str, Any]] = []
        for client in self.fixture["clients"]:
            entry = dict(client)
            entry["name"] = self._ensure_encoded_name(entry.get("name"))
            entry["deco_mac"] = entry.get("deco_mac") or default_deco_mac
            fixture_clients.append(entry)
        return fixture_clients + self._build_generated_clients()

    def _profile_for_client(self, client: dict[str, Any]) -> str:
        wire_type = str(client.get("wire_type", "wireless")).lower()
        interface = str(client.get("interface", "main")).lower()
        band = str(client.get("connection_type", "")).lower()
        if wire_type == "wired":
            return "wired"
        if interface == "guest":
            return "guest"
        if interface == "iot":
            return "iot"
        if "band6" in band:
            return "wifi6"
        if "band5" in band:
            return "wifi5"
        return "wifi24"

    def _rate_bounds(self, profile: str) -> tuple[int, int, int, int]:
        if profile == "wired":
            return (6_000, 120_000, 4_000, 95_000)
        if profile == "wifi6":
            return (2_000, 95_000, 1_200, 62_000)
        if profile == "wifi5":
            return (400, 65_000, 220, 42_000)
        if profile == "iot":
            return (5, 1_400, 3, 800)
        if profile == "guest":
            return (60, 19_000, 35, 11_500)
        return (30, 7_500, 18, 4_000)

    def _next_online_state(self, profile: str, current_online: bool) -> bool:
        disconnect_prob = {
            "wired": 0.004,
            "wifi6": 0.015,
            "wifi5": 0.02,
            "wifi24": 0.025,
            "iot": 0.01,
            "guest": 0.03,
        }.get(profile, 0.02)
        reconnect_prob = {
            "wired": 0.35,
            "wifi6": 0.28,
            "wifi5": 0.25,
            "wifi24": 0.22,
            "iot": 0.18,
            "guest": 0.24,
        }.get(profile, 0.22)
        if current_online:
            return self._rand.random() >= disconnect_prob
        return self._rand.random() < reconnect_prob

    def _next_rate(self, current: int, min_value: int, max_value: int) -> int:
        if current <= 0:
            return self._rand.randint(min_value, max_value)
        jittered = int(current * self._rand.uniform(0.72, 1.33))
        return max(min_value, min(max_value, jittered))

    def _build_client_runtime(self) -> dict[str, dict[str, Any]]:
        runtime: dict[str, dict[str, Any]] = {}
        for client in self._clients_catalog:
            profile = self._profile_for_client(client)
            down_min, down_max, up_min, up_max = self._rate_bounds(profile)
            seed_down = int(client.get("down_kilobytes_per_s") or 0)
            seed_up = int(client.get("up_kilobytes_per_s") or 0)
            if seed_down <= 0:
                seed_down = self._rand.randint(down_min, down_max)
            if seed_up <= 0:
                seed_up = self._rand.randint(up_min, up_max)
            runtime[client["mac"]] = {
                "profile": profile,
                "online": bool(client.get("online", True)),
                "down_kb": seed_down,
                "up_kb": seed_up,
                "traffic_down": self._rand.randint(250_000_000, 18_000_000_000),
                "traffic_up": self._rand.randint(180_000_000, 9_000_000_000),
            }
        return runtime

    def _advance_client_runtime(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_client_tick
        # Per-node polling issues one request per deco back to back; only the first advances time.
        if elapsed < 0.25:
            return
        delta_seconds = max(0.3, min(4.0, elapsed))
        self._last_client_tick = now
        for runtime in self._client_runtime.values():
            profile = str(runtime["profile"])
            is_online = self._next_online_state(profile, bool(runtime["online"]))
            runtime["online"] = is_online
            down_min, down_max, up_min, up_max = self._rate_bounds(profile)
            if is_online:
                runtime["down_kb"] = self._next_rate(int(runtime["down_kb"]), down_min, down_max)
                runtime["up_kb"] = self._next_rate(int(runtime["up_kb"]), up_min, up_max)
            else:
                runtime["down_kb"] = 0
                runtime["up_kb"] = 0

            runtime["traffic_down"] = int(runtime["traffic_down"]) + int(
                int(runtime["down_kb"]) * 1_000 * delta_seconds
            )
            runtime["traffic_up"] = int(runtime["traffic_up"]) + int(
                int(runtime["up_kb"]) * 1_000 * delta_seconds
            )

    def _client_list(self, deco_mac: str | None = None) -> list[dict[str, Any]]:
        self._advance_client_runtime()
        wanted = None
        if deco_mac and deco_mac != GLOBAL_CLIENT_MAC:
            wanted = deco_mac.replace("-", ":").upper()

        clients: list[dict[str, Any]] = []
        for client in self._clients_catalog:
            runtime = self._client_runtime.get(client["mac"])
            if runtime is None:
                continue
            if wanted is not None:
                owner = str(client.get("deco_mac") or "").replace("-", ":").upper()
                if owner != wanted:
                    continue

            down_kb = int(runtime["down_kb"])
            up_kb = int(runtime["up_kb"])
            clients.append(
                {
                    "name": client.get("name"),
                    "mac": client.get("mac"),
                    "ip": client.get("ip"),
                    "online": bool(runtime["online"]),
                    "wire_type": client.get("wire_type", "wireless"),
                    "connection_type": client.get("connection_type", "band5"),
                    "interface": client.get("interface", "main"),
                    # ha-tplink-deco expects these keys and converts them internally.
                    "down_speed": down_kb,
                    "up_speed": up_kb,
                    # Extra counters for richer diagnostics (ignored by ha-tplink-deco if unsupported).
                    "traffic_down": int(runtime["traffic_down"]),
                    "traffic_up": int(runtime["traffic_up"]),
                    "traffic_usage": int(runtime["traffic_down"]) + int(runtime["traffic_up"]),
                    "deco_mac": client.get("deco_mac"),
                }
            )
        return clients

    def _runtime_performance(self) -> dict[str, Any]:
        perf = dict(self.fixture["performance"])
        # ha-tplink-deco multiplies these by 100, so they must stay 0..1 ratios.
        cpu = float(perf.get("cpu_usage") or 0.12)
        mem = float(perf.get("mem_usage") or 0.24)
        perf["cpu_usage"] = round(max(0.02, min(0.95, cpu * self._rand.uniform(0.7, 1.45))), 4)
        perf["mem_usage"] = round(max(0.05, min(0.95, mem * self._rand.uniform(0.75, 1.35))), 4)
        return perf

    def _reboot_decos(self, mac_list: list[dict[str, Any]] | None) -> list[str]:
        wanted = {
            str(item.get("mac") or "").replace("-", ":").upper()
            for item in (mac_list or [])
            if isinstance(item, dict)
        }
        rebooted: list[str] = []
        for deco in self.fixture["decos"]:
            if str(deco["mac"]).upper() in wanted:
                rebooted.append(str(deco["mac"]))
        return rebooted


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
                {"error_code": 0, "result": mock._runtime_performance()},
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
            params = payload.get("params") or {}
            deco_mac = params.get("device_mac") or GLOBAL_CLIENT_MAC
            if deco_mac != GLOBAL_CLIENT_MAC and not _per_node_clients_enabled():
                # Reproduces the firmwares that 5xx per-node queries and force the global fallback.
                return JSONResponse(
                    {"error_code": -1, "msg": "per-node client_list unavailable"},
                    status_code=503,
                )
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": {"client_list": mock._client_list(deco_mac)}},
            )

        if endpoint == "admin/device" and form == "system":
            params = payload.get("params") or {}
            rebooted = mock._reboot_decos(params.get("mac_list"))
            return mock._json_encrypted(
                session,
                {"error_code": 0, "result": {"reboot": "ok", "mac_list": rebooted}},
            )

        if endpoint == "admin/system" and form == "logout":
            return mock._json_encrypted(session, {"error_code": 0, "result": {"logout": True}})

        return JSONResponse({"error_code": 404, "msg": f"unsupported endpoint {endpoint}::{form}"}, status_code=404)

    return app


app = create_app()
