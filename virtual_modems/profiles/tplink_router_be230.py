from __future__ import annotations

import copy
import json
import secrets
import time
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from ..shared.rsa_session import RsaKeyPair, parse_form_body
from ..shared.request_logging import install_request_logging


def _load_fixture() -> dict[str, Any]:
    file_path = Path(__file__).resolve().parents[1] / "data" / "tplink_router_be230.json"
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


class TplinkRouterBe230Mock:
    def __init__(self) -> None:
        self.fixture = _load_fixture()
        self.keys = RsaKeyPair.generate(2048)
        self.stok = "be230-stok"
        self._known_stoks: set[str] = {self.stok}
        self.sysauth = secrets.token_hex(16)

    def make_success(self, data: Any) -> JSONResponse:
        return JSONResponse({"success": True, "data": data})

    @staticmethod
    def _normalize_mac(value: str) -> str:
        return value.replace(":", "-").lower().strip()

    def _is_online(self, item: dict[str, Any]) -> bool:
        flap = item.get("flap")
        if not isinstance(flap, dict):
            return True

        period = int(flap.get("period_seconds", 120) or 120)
        period = max(2, period)
        on_ratio = float(flap.get("on_ratio", 0.5) or 0.5)
        on_ratio = max(0.0, min(on_ratio, 1.0))
        offset = int(flap.get("offset_seconds", 0) or 0)
        phase = ((int(time.time()) + offset) % period) / period
        return phase < on_ratio

    def _runtime_smart_network(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for entry in self.fixture["clients"]["smart_network"]:
            if not self._is_online(entry):
                continue
            cloned = copy.deepcopy(entry)
            cloned.pop("flap", None)
            items.append(cloned)
        return items

    def _runtime_access_clients(
        self,
        entries: list[dict[str, Any]],
        online_macs: set[str],
    ) -> list[dict[str, Any]]:
        if not online_macs:
            return [copy.deepcopy(entry) for entry in entries]

        result: list[dict[str, Any]] = []
        for entry in entries:
            mac = self._normalize_mac(str(entry.get("macaddr", "")))
            if mac in online_macs:
                result.append(copy.deepcopy(entry))
        return result

    def _runtime_wireless_stats(self, online_macs: set[str]) -> list[dict[str, Any]]:
        if not online_macs:
            return [copy.deepcopy(item) for item in self.fixture["clients"]["wireless_stats"]]

        result: list[dict[str, Any]] = []
        for item in self.fixture["clients"]["wireless_stats"]:
            mac = self._normalize_mac(str(item.get("mac", "")))
            if mac in online_macs:
                result.append(copy.deepcopy(item))
        return result

    def handle_keys(self) -> JSONResponse:
        # "data" key intentionally used so TplinkRouterV1_11 is selected by provider.
        return JSONResponse(
            {
                "success": True,
                "data": {
                    "password": [self.keys.n_hex, self.keys.e_hex],
                },
            }
        )

    def handle_auth(self) -> JSONResponse:
        return JSONResponse(
            {
                "success": True,
                "data": {
                    "seq": 1000,
                    "key": [self.keys.n_hex, self.keys.e_hex],
                },
            }
        )

    def handle_login(self) -> JSONResponse:
        # Rotate stok to emulate real routers and keep old values valid for stability.
        self.stok = f"be230-{secrets.token_hex(6)}"
        self._known_stoks.add(self.stok)
        self.sysauth = secrets.token_hex(16)
        response = JSONResponse(
            {
                "success": True,
                "data": {
                    "stok": self.stok,
                    "errorcode": 0,
                },
            }
        )
        response.headers["set-cookie"] = f"sysauth={self.sysauth}; Path=/; HttpOnly"
        return response

    def handle_status_all(self) -> JSONResponse:
        router = self.fixture["router"]
        status = self.fixture["status"]
        clients = self.fixture["clients"]
        smart_network = self._runtime_smart_network()
        online_macs = {
            self._normalize_mac(str(item.get("mac", ""))) for item in smart_network
        }
        wired = self._runtime_access_clients(clients["wired"], online_macs)
        host = self._runtime_access_clients(clients["host"], online_macs)
        guest = self._runtime_access_clients(clients["guest"], online_macs)
        payload = {
            "wan_macaddr": router["wan_macaddr"],
            "lan_macaddr": router["lan_macaddr"],
            "wan_ipv4_ipaddr": router["wan_ipv4_ipaddr"],
            "lan_ipv4_ipaddr": router["lan_ipv4_ipaddr"],
            "wan_ipv4_gateway": router["wan_ipv4_gateway"],
            "wan_ipv4_uptime": 175000,
            "access_devices_wired": wired,
            "access_devices_wireless_host": host,
            "access_devices_wireless_guest": guest,
            **status,
        }
        return self.make_success(payload)

    def handle_status_perf(self) -> JSONResponse:
        return self.make_success(
            {
                "cpu_usage": self.fixture["status"]["cpu_usage"],
                "mem_usage": self.fixture["status"]["mem_usage"],
            }
        )

    def handle_wireless_statistics(self) -> JSONResponse:
        smart_network = self._runtime_smart_network()
        online_macs = {
            self._normalize_mac(str(item.get("mac", ""))) for item in smart_network
        }
        return self.make_success(self._runtime_wireless_stats(online_macs))

    def handle_smart_network(self) -> JSONResponse:
        return self.make_success(self._runtime_smart_network())

    def handle_firmware(self) -> JSONResponse:
        router = self.fixture["router"]
        return self.make_success(
            {
                "hardware_version": router["hardware_version"],
                "model": router["model"],
                "firmware_version": router["firmware_version"],
            }
        )

    def handle_network_ipv4(self) -> JSONResponse:
        router = self.fixture["router"]
        return self.make_success(
            {
                "wan_macaddr": router["wan_macaddr"],
                "wan_ipv4_ipaddr": router["wan_ipv4_ipaddr"],
                "wan_ipv4_gateway": router["wan_ipv4_gateway"],
                "wan_ipv4_conntype": "dhcp",
                "wan_ipv4_netmask": "255.255.255.0",
                "wan_ipv4_pridns": "1.1.1.1",
                "wan_ipv4_snddns": "8.8.8.8",
                "lan_macaddr": router["lan_macaddr"],
                "lan_ipv4_ipaddr": router["lan_ipv4_ipaddr"],
                "lan_ipv4_dhcp_enable": "on",
                "lan_ipv4_netmask": "255.255.255.0",
            }
        )

    def handle_wifi_toggle(self, form_name: str, body: dict[str, str]) -> JSONResponse:
        key = f"{form_name}_enable"
        enable_raw = body.get(key)
        if enable_raw in {"on", "off"}:
            self.fixture["status"][key] = enable_raw
        return self.make_success({"updated": True})

    def handle_reboot(self) -> JSONResponse:
        return self.make_success({"reboot": "ok"})

    @staticmethod
    def extract_endpoint(path: str) -> str | None:
        # Accept any stok value (including stale) to keep mock sessions resilient.
        match = re.match(r"^/cgi-bin/luci/;stok=[^/]+/(.+)$", path)
        if not match:
            return None
        return match.group(1)


def create_app() -> FastAPI:
    mock = TplinkRouterBe230Mock()
    app = FastAPI(title="Virtual TP-Link Router BE230", version="0.1.0")
    install_request_logging(app, "tplink_router_be230")

    @app.get("/")
    async def root() -> HTMLResponse:
        return HTMLResponse("<html><body><h1>Archer BE230 Virtual Router</h1></body></html>")

    @app.get("/webpages/index.html")
    async def web_index() -> HTMLResponse:
        return HTMLResponse("<html><body>Archer BE230 Admin</body></html>")

    @app.get("/login.htm")
    async def login_h_tm() -> HTMLResponse:
        return HTMLResponse("<html><body>Router Login</body></html>")

    @app.get("/js/lib.js")
    async def lib_js() -> HTMLResponse:
        return HTMLResponse("console.log('virtual router');")

    @app.post("/{full_path:path}")
    async def post_any(full_path: str, request: Request):
        body_raw = await request.body()
        body = parse_form_body(body_raw)
        query = parse_qs(request.url.query)

        path = f"/{full_path}"

        if path == "/cgi-bin/luci/;stok=/login":
            form_name = (query.get("form") or [""])[0]
            if form_name == "keys":
                return mock.handle_keys()
            if form_name == "auth":
                return mock.handle_auth()
            if form_name == "login":
                return mock.handle_login()

        if path == "/cgi-bin/luci/;stok=/device_config":
            return JSONResponse({"data": {"certification": ["NONE"]}})

        endpoint = mock.extract_endpoint(path)
        if endpoint is not None:

            if endpoint.startswith("admin/status") and "form=all" in request.url.query:
                return mock.handle_status_all()
            if endpoint.startswith("admin/status") and "form=perf" in request.url.query:
                return mock.handle_status_perf()
            if endpoint.startswith("admin/firmware"):
                return mock.handle_firmware()
            if endpoint.startswith("admin/network"):
                return mock.handle_network_ipv4()
            if endpoint.startswith("admin/wireless") and "form=statistics" in request.url.query:
                return mock.handle_wireless_statistics()
            if endpoint.startswith("admin/smart_network"):
                return mock.handle_smart_network()
            if endpoint.startswith("admin/system") and "form=reboot" in request.url.query:
                return mock.handle_reboot()
            if endpoint.startswith("admin/system") and "form=logout" in request.url.query:
                return mock.make_success({"logout": "ok"})
            if endpoint.startswith("admin/wireless") and body.get("operation") == "write":
                form_names = query.get("form") or []
                if form_names:
                    form_name = form_names[-1]
                    return mock.handle_wifi_toggle(form_name, body)
                # Some firmwares post write operations without a named form.
                return mock.make_success({"updated": True})

            if endpoint.startswith("admin/openvpn") or endpoint.startswith("admin/pptpd"):
                return mock.make_success({"enabled": "off"})
            if endpoint.startswith("admin/vpnconn"):
                return mock.make_success([])

        return JSONResponse({"success": False, "data": {}, "error": "unsupported"}, status_code=404)

    return app


app = create_app()
