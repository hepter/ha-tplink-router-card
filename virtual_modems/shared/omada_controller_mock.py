from __future__ import annotations

import copy
import json
import os
import random
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .request_logging import install_request_logging

VPN_LIST_SLUGS = {
    "client-to-site-vpn-servers",
    "client-to-site-vpn-clients",
    "site-to-site-vpns",
}

WIRELESS_ONLY_KEYS = (
    "apMac",
    "apName",
    "ssid",
    "radioId",
    "channel",
    "wifiMode",
    "rssi",
    "snr",
    "signalLevel",
    "signalRank",
    "powerSave",
)


def _load_fixture() -> dict[str, Any]:
    file_path = Path(__file__).resolve().parents[1] / "data" / "omada_controller.json"
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "-").strip().lower()


def _index_by_mac(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {_normalize_mac(item["mac"]): copy.deepcopy(item) for item in items if "mac" in item}


def _parse_version(value: str) -> tuple[int, int, int, int]:
    parts: list[int] = []
    for chunk in str(value).split("."):
        digits = "".join(char for char in chunk if char.isdigit())
        parts.append(int(digits) if digits else 0)
    parts.extend([0, 0, 0, 0])
    return tuple(parts[:4])  # type: ignore[return-value]


class OmadaControllerMock:
    def __init__(self) -> None:
        self.fixture = _load_fixture()
        self.controller = self.fixture["controller"]
        self.username = os.getenv("VMODEM_OMADA_USERNAME", "admin")
        self.password = os.getenv("VMODEM_OMADA_PASSWORD", "admin")

        override = os.getenv("VMODEM_OMADA_VERSION", "").strip()
        self.version = override or str(self.controller.get("version", "5.15.8"))
        self.version_tuple = _parse_version(self.version)
        # ha-omada switches to /openapi/v2 client listing at 6.0.0, core tplink_omada at 6.2.0.
        self.supports_openapi_v2 = self.version_tuple >= (6, 0, 0, 0)

        self.devices = copy.deepcopy(self.fixture.get("devices", []))
        self.clients = copy.deepcopy(self.fixture.get("clients", []))
        self.known_clients = copy.deepcopy(self.fixture.get("known_clients", []))

        self.gateway_details = _index_by_mac(self.fixture.get("gateway_details", []))
        self.switch_details = _index_by_mac(self.fixture.get("switch_details", []))
        self.ap_details = _index_by_mac(self.fixture.get("ap_details", []))
        self.switch_ports = {
            _normalize_mac(item["mac"]): copy.deepcopy(item.get("ports", []))
            for item in self.fixture.get("switch_ports", [])
            if "mac" in item
        }
        self.port_profiles = copy.deepcopy(self.fixture.get("port_profiles", []))

        self.tokens: set[str] = set()
        self._rand = random.Random()

    def _controller_aliases(self) -> set[str]:
        controller_id = str(self.controller.get("id", "")).strip()
        aliases = {
            controller_id,
            "oc-virtual-001",
            "oc-virtual-controller",
            "oc-default-001",
        }
        return {alias for alias in aliases if alias}

    def _matches_controller(self, controller_id: str) -> bool:
        return controller_id in self._controller_aliases()

    def _site_aliases(self) -> set[str]:
        site_id = str(self.controller.get("site_id", "")).strip()
        site_name = str(self.controller.get("site_name", "")).strip()
        aliases = {site_id, site_name, "Default", "default", "site-main"}
        return {alias for alias in aliases if alias}

    def _site_options(self) -> list[dict[str, str]]:
        # Keep compatibility with both integrations:
        # - ha-omada uses a free text site name field (often "Default")
        # - tplink_omada uses site IDs from this response
        site_id = str(self.controller.get("site_id", "")).strip()
        site_name = str(self.controller.get("site_name", "")).strip() or "Default"
        options = [
            {"name": site_name, "key": site_id},
            {"name": "Default", "key": site_id},
        ]
        deduped: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in options:
            token = (item["name"], item["key"])
            if token in seen:
                continue
            seen.add(token)
            deduped.append(item)
        return deduped

    def _find_device(self, mac: str) -> dict[str, Any] | None:
        norm = _normalize_mac(mac)
        for device in self.devices:
            if _normalize_mac(str(device.get("mac", ""))) == norm:
                return device
        return None

    def _virtual_mac(self, mac: str) -> str:
        cleaned = "".join(char for char in mac if char.isalnum()).upper()
        suffix = cleaned[-4:].rjust(4, "0")
        return f"02:56:4D:03:{suffix[:2]}:{suffix[2:]}"

    def _ensure_client(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        for client in self.clients:
            if _normalize_mac(str(client.get("mac", ""))) == norm:
                return client

        virtual_mac = self._virtual_mac(mac)
        label = f"vm-adhoc-{virtual_mac[-5:].replace(':', '')}".lower()
        fallback = copy.deepcopy(self.clients[0]) if self.clients else {}
        fallback.update(
            {
                "mac": virtual_mac,
                "name": label,
                "hostName": label,
                "active": True,
                "wireless": True,
                "guest": False,
                "connectType": 1,
                "connectDevType": "ap",
                "ip": "192.168.60.250",
                "blocked": False,
                "lastSeen": int(time.time() * 1000),
            }
        )
        self.clients.append(fallback)

        if not any(_normalize_mac(str(item.get("mac", ""))) == norm for item in self.known_clients):
            known = copy.deepcopy(self.known_clients[0]) if self.known_clients else {}
            known.update(
                {
                    "mac": virtual_mac,
                    "name": label,
                    "wireless": True,
                    "guest": False,
                    "block": False,
                    "blocked": False,
                    "lastSeen": int(time.time() * 1000),
                }
            )
            self.known_clients.append(known)

        return fallback

    def _ensure_device_of_type(self, mac: str, dev_type: str) -> dict[str, Any]:
        existing = self._find_device(mac)
        if existing:
            if existing.get("type") != dev_type:
                existing["type"] = dev_type
            return existing

        template = next((item for item in self.devices if item.get("type") == dev_type), None)
        device = copy.deepcopy(template) if template else {}
        virtual_mac = self._virtual_mac(mac)
        device.update(
            {
                "mac": virtual_mac,
                "type": dev_type,
                "name": f"Virtual Adhoc {dev_type.title()} {virtual_mac[-5:]}",
                "model": device.get("model") or f"Virtual-{dev_type.upper()}",
                "showModel": device.get("showModel") or f"Virtual {dev_type.upper()}",
                "compoundModel": device.get("compoundModel") or f"Virtual {dev_type.title()}",
                "firmwareVersion": f"{device.get('firmwareVersion', '1.0.0')}".split(" ")[0] + " (virtual)",
                "ip": device.get("ip") or "192.168.1.250",
                "status": int(device.get("status", 14) or 14),
                "statusCategory": int(device.get("statusCategory", 1) or 1),
                "needUpgrade": bool(device.get("needUpgrade", False)),
            }
        )
        self.devices.append(device)
        return device

    def _build_wlans(self) -> list[dict[str, Any]]:
        # Minimal structure used by ha-omada update_ssids() for controller versions >= 4.4.8.
        wlans: list[dict[str, Any]] = []
        for idx, ap in enumerate(self.ap_details.values(), start=1):
            wlans.append(
                {
                    "id": f"wlan-{idx}",
                    "wlanId": f"wlan-{idx}",
                    "name": f"{ap.get('name', 'Virtual AP')} WLAN",
                }
            )
        return wlans

    def _build_wlan_ssids(self, wlan_id: str) -> list[dict[str, Any]]:
        # Collect SSID names from AP overrides and expose a stable response.
        names: set[str] = set()
        for ap in self.ap_details.values():
            for override in ap.get("ssidOverrides", []):
                name = override.get("globalSsid")
                if isinstance(name, str) and name.strip():
                    names.add(name.strip())

        if not names:
            names = {"MainNet 2.4G", "MainNet 5G", "GuestNet 5G"}

        sorted_names = sorted(names)
        return [{"id": f"{wlan_id}-{idx+1}", "name": ssid} for idx, ssid in enumerate(sorted_names)]

    def _ok(self, result: Any) -> JSONResponse:
        return JSONResponse({"errorCode": 0, "result": result})

    def _message(self, msg: str = "ok") -> JSONResponse:
        return JSONResponse({"errorCode": 0, "msg": msg, "result": {}})

    def _not_found(self, msg: str = "not found") -> JSONResponse:
        return JSONResponse({"errorCode": -30104, "msg": msg}, status_code=404)

    def _require_controller_site(self, controller_id: str, site: str) -> JSONResponse | None:
        if not self._matches_controller(controller_id):
            return self._not_found("controller not found")
        if site not in self._site_aliases():
            return self._not_found("site not found")
        return None

    def _require_openapi_site(self, controller_id: str, site: str) -> JSONResponse | None:
        if not self.supports_openapi_v2:
            return JSONResponse(
                {"errorCode": -44112, "msg": f"openapi v2 unavailable on controller {self.version}"},
                status_code=404,
            )
        return self._require_controller_site(controller_id, site)

    def _page_envelope(self, items: list[dict[str, Any]], page: int, size: int) -> dict[str, Any]:
        page = max(1, page)
        size = max(1, size)
        start = (page - 1) * size
        sliced = items[start : start + size]
        return {
            "data": sliced,
            "currentPage": page,
            # Real controllers echo the effective page size here; the paging loops in both
            # clients divide by it, so returning len(sliced) makes them re-request forever.
            "currentSize": size,
            "totalRows": len(items),
        }

    def _paginate(self, items: list[dict[str, Any]], request: Request) -> dict[str, Any]:
        q = request.query_params
        page = int(q.get("currentPage", q.get("page", "1")) or "1")
        size = int(q.get("currentPageSize", q.get("pageSize", "100")) or "100")
        return self._page_envelope(items, page, size)

    def _paginate_body(self, items: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
        page = int(payload.get("page", 1) or 1)
        size = int(payload.get("pageSize", 100) or 100)
        return self._page_envelope(items, page, size)

    def _is_client_active(self, client: dict[str, Any]) -> bool:
        base_active = bool(client.get("active", False))
        flap = client.get("flap")
        if not isinstance(flap, dict):
            return base_active

        period = int(flap.get("period_seconds", 60) or 60)
        period = max(2, period)
        on_ratio = float(flap.get("on_ratio", 0.5) or 0.5)
        on_ratio = max(0.0, min(on_ratio, 1.0))
        offset = int(flap.get("offset_seconds", 0) or 0)
        phase = ((int(time.time()) + offset) % period) / period
        return base_active and phase < on_ratio

    def _runtime_clients(self) -> list[dict[str, Any]]:
        now_ms = int(time.time() * 1000)
        runtime_clients: list[dict[str, Any]] = []
        for item in self.clients:
            current = copy.deepcopy(item)
            current["active"] = self._is_client_active(item)
            self._randomize_client_metrics(current)
            if current["active"]:
                current["lastSeen"] = now_ms
            runtime_clients.append(current)
        return runtime_clients

    def _runtime_known_clients(self, runtime_clients: list[dict[str, Any]]) -> list[dict[str, Any]]:
        now_ms = int(time.time() * 1000)
        active_by_mac = {
            _normalize_mac(item["mac"]): bool(item.get("active", False))
            for item in runtime_clients
            if "mac" in item
        }

        known_items: list[dict[str, Any]] = []
        for item in self.known_clients:
            current = copy.deepcopy(item)
            norm_mac = _normalize_mac(str(current.get("mac", "")))
            self._randomize_known_client_metrics(current)
            if norm_mac in active_by_mac:
                if active_by_mac[norm_mac]:
                    current["lastSeen"] = now_ms
                else:
                    # Ensure flapping clients are clearly offline even if integration uses disconnect timeout.
                    current["lastSeen"] = now_ms - 15 * 60 * 1000
            known_items.append(current)
        return known_items

    def _runtime_devices(self) -> list[dict[str, Any]]:
        runtime_clients = [item for item in self._runtime_clients() if item.get("active")]
        devices: list[dict[str, Any]] = []

        for device in self.devices:
            current = copy.deepcopy(device)
            norm = _normalize_mac(str(current.get("mac", "")))
            dev_type = current.get("type")

            if dev_type == "ap":
                attached = [c for c in runtime_clients if _normalize_mac(str(c.get("apMac", ""))) == norm]
                current["clientNum"] = len(attached)
                current["clientNum2g"] = sum(1 for c in attached if c.get("radioId") == 0)
                current["clientNum5g"] = sum(1 for c in attached if c.get("radioId") in (1, 2))
                current["clientNum6g"] = sum(1 for c in attached if c.get("radioId") == 3)
                current["guestNum"] = sum(1 for c in attached if c.get("guest"))
                current["userNum"] = current["clientNum"] - current["guestNum"]
            elif dev_type == "switch":
                attached = [c for c in runtime_clients if _normalize_mac(str(c.get("switchMac", ""))) == norm]
                current["clientNum"] = len(attached)
                current["userNum"] = len(attached)
            elif dev_type == "gateway":
                current["clientNum"] = len(runtime_clients)
                current["guestNum"] = sum(1 for c in runtime_clients if c.get("guest"))
                current["userNum"] = current["clientNum"] - current["guestNum"]
                current["clientNum2g"] = sum(1 for c in runtime_clients if c.get("radioId") == 0)
                current["clientNum5g"] = sum(1 for c in runtime_clients if c.get("radioId") in (1, 2))
                current["clientNum6g"] = sum(1 for c in runtime_clients if c.get("radioId") == 3)

            if int(current.get("statusCategory", 0)) == 1:
                current["cpuUtil"] = max(0, min(99, int(current.get("cpuUtil", 10)) + self._rand.randint(-4, 4)))
                current["memUtil"] = max(0, min(99, int(current.get("memUtil", 30)) + self._rand.randint(-3, 3)))
                current["uptimeLong"] = int(current.get("uptimeLong", 0)) + self._rand.randint(1, 30)

            devices.append(current)
        return devices

    def _randomize_client_metrics(self, client: dict[str, Any]) -> None:
        wireless = bool(client.get("wireless", False))
        active = bool(client.get("active", False))

        if wireless:
            radio_id = int(client.get("radioId", 0) or 0)
            ceiling = {0: 574, 1: 1201, 2: 2402, 3: 4324}.get(radio_id, 866)
            rx_rate = self._rand.randint(max(6, ceiling // 8), ceiling)
            tx_rate = max(6, int(rx_rate * self._rand.uniform(0.5, 0.98)))
            rssi = self._rand.randint(-78, -34) if active else self._rand.randint(-94, -76)
            client["rssi"] = rssi
            client["snr"] = self._rand.randint(14, 46) if active else self._rand.randint(3, 14)
            client["signalLevel"] = max(0, min(5, (rssi + 92) // 11))
            client["signalRank"] = max(0, min(3, client["signalLevel"] - 2))
            client["powerSave"] = bool(not active or self._rand.random() > 0.62)
        else:
            rx_rate = int(client.get("rxRate", 1000) or 1000)
            tx_rate = int(client.get("txRate", 1000) or 1000)
            for key in WIRELESS_ONLY_KEYS:
                client.pop(key, None)

        traffic_down = int(client.get("trafficDown") or 0)
        traffic_up = int(client.get("trafficUp") or 0)
        duration = int(client.get("uptime") or 0)
        packet_down = int(client.get("downPacket") or 0)
        packet_up = int(client.get("upPacket") or 0)

        if active:
            traffic_down += self._rand.randint(4_000, 9_800_000)
            traffic_up += self._rand.randint(2_000, 6_200_000)
            duration += self._rand.randint(1, 20)
            packet_down += self._rand.randint(10, 900)
            packet_up += self._rand.randint(10, 700)

        client["rxRate"] = rx_rate
        client["txRate"] = tx_rate
        client["trafficDown"] = max(0, traffic_down)
        client["trafficUp"] = max(0, traffic_up)
        client["uptime"] = max(0, duration)
        client["downPacket"] = max(0, packet_down)
        client["upPacket"] = max(0, packet_up)
        # Omada reports activity as a realtime downlink rate in Byte/s, not a flag.
        client["activity"] = self._rand.randint(0, 2_400_000) if active else 0

    def _randomize_known_client_metrics(self, client: dict[str, Any]) -> None:
        download = int(client.get("download") or 0)
        upload = int(client.get("upload") or 0)
        duration = int(client.get("duration") or 0)
        download += self._rand.randint(0, 3_200_000)
        upload += self._rand.randint(0, 2_400_000)
        duration += self._rand.randint(0, 14)
        client["download"] = max(0, download)
        client["upload"] = max(0, upload)
        client["duration"] = max(0, duration)

    def _match_device(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        for device in self.devices:
            if _normalize_mac(device["mac"]) == norm:
                return device
        raise KeyError(mac)

    def _match_client(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        for client in self.clients:
            if _normalize_mac(client["mac"]) == norm:
                return client
        raise KeyError(mac)

    def _get_gateway_detail(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        if norm in self.gateway_details:
            return self.gateway_details[norm]
        device = self._ensure_device_of_type(mac, "gateway")
        detail = copy.deepcopy(device)
        detail.setdefault("portStats", [])
        detail.setdefault("portConfigs", [])
        self.gateway_details[norm] = detail
        return detail

    def _get_switch_detail(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        if norm in self.switch_details:
            return self.switch_details[norm]
        device = self._ensure_device_of_type(mac, "switch")
        detail = copy.deepcopy(device)
        detail.setdefault("devCap", {"poeSupport": False, "poePortNum": 0, "supportBt": False})
        self.switch_details[norm] = detail
        self.switch_ports.setdefault(norm, [])
        return detail

    def _get_ap_detail(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        if norm in self.ap_details:
            return self.ap_details[norm]
        device = self._ensure_device_of_type(mac, "ap")
        detail = copy.deepcopy(device)
        detail.setdefault("lanPortSettings", [])
        self.ap_details[norm] = detail
        return detail

    def _get_switch_port(self, mac: str, port: int) -> dict[str, Any]:
        ports = self.switch_ports.get(_normalize_mac(mac), [])
        for item in ports:
            if int(item.get("port", -1)) == int(port):
                return item
        raise KeyError(f"{mac}:{port}")

    def _device_firmware(self, mac: str) -> dict[str, Any]:
        device = self._find_device(mac)
        current = str((device or {}).get("firmwareVersion", "1.0.0 (virtual)"))
        base = current.split(" ")[0]
        head, _, tail = base.rpartition(".")
        try:
            latest = f"{head}.{int(tail) + 2}" if head else base
        except ValueError:
            latest = base
        upgradable = bool((device or {}).get("needUpgrade", False))
        return {
            "curFwVer": current,
            "lastFwVer": f"{latest} (virtual)" if upgradable else current,
            "fwReleaseLog": "Virtual firmware changelog for the emulated Omada controller",
        }

    def _build_topology(self) -> dict[str, Any]:
        devices = {_normalize_mac(str(d.get("mac", ""))): d for d in self._runtime_devices()}

        def node(device: dict[str, Any]) -> dict[str, Any]:
            payload = {
                "type": device.get("type"),
                "mac": device.get("mac"),
                "name": device.get("name"),
                "model": device.get("model"),
                "ip": device.get("ip"),
                "status": device.get("status"),
                "statusCategory": device.get("statusCategory"),
                "disconnected": int(device.get("statusCategory", 0)) != 1,
                "clientCount": int(device.get("clientNum", 0)),
                "successors": [],
            }
            uplink = device.get("uplink")
            if isinstance(uplink, str) and uplink:
                payload["wiredUpInfo"] = {
                    "upLinkPort": {"port": "2"},
                    "port": {"port": "1"},
                    "linkSpeed": 3,
                    "duplex": 2,
                }
            if device.get("type") == "gateway":
                gateway = self.gateway_details.get(_normalize_mac(str(device.get("mac", ""))), {})
                payload["wanPorts"] = [
                    {
                        "port": str(port.get("port")),
                        "name": port.get("name"),
                        "status": port.get("status", 0),
                        "linkSpeed": port.get("speed", 0),
                        "duplex": port.get("duplex", 0),
                        "internetState": port.get("internetState", 0),
                        "onlineDetection": port.get("onlineDetection", 0),
                    }
                    for port in gateway.get("portStats", [])
                    if int(port.get("type", -1)) == 0
                ]
            return payload

        nodes = {mac: node(device) for mac, device in devices.items()}
        roots: list[dict[str, Any]] = []
        for mac, device in devices.items():
            uplink = device.get("uplink")
            parent = nodes.get(_normalize_mac(str(uplink))) if uplink else None
            if parent is None:
                roots.append(nodes[mac])
            else:
                parent["successors"].append(nodes[mac])
        return {"topologyArray": roots}

    def create_app(self, title: str) -> FastAPI:
        app = FastAPI(title=title, version="0.1.0")
        install_request_logging(app, "omada_controller")

        @app.get("/")
        async def root():
            return HTMLResponse(
                "<html><body><h1>Virtual Omada Controller</h1>"
                "<p>Use this URL as controller host for both <code>ha-omada</code> and "
                "<code>tplink_omada</code> integrations.</p>"
                "<p>Host field must include protocol: <code>http://&lt;ip&gt;</code></p>"
                f"<p>Controller version: <code>{self.version}</code> "
                f"(openapi v2 client listing: {'on' if self.supports_openapi_v2 else 'off'})</p>"
                f"<p>Username: <code>{self.username}</code> | Password: <code>{self.password}</code></p>"
                "</body></html>"
            )

        @app.get("/api/info")
        async def api_info():
            return self._ok(
                {
                    "controllerVer": self.version,
                    "apiVer": "3" if self.supports_openapi_v2 else "2",
                    "configured": True,
                    "type": 1,
                    "supportApp": True,
                    "omadacId": self.controller["id"],
                    "registeredRoot": True,
                    "omadacCategory": "software",
                    "mspMode": False,
                    "omadaCloudUrl": "",
                }
            )

        @app.post("/{controller_id}/api/v2/login")
        async def login(controller_id: str, request: Request):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            payload = await request.json()
            if payload.get("username") != self.username or payload.get("password") != self.password:
                return JSONResponse({"errorCode": -30109, "msg": "invalid credentials"}, status_code=401)
            token = secrets.token_hex(16)
            self.tokens.add(token)
            response = self._ok({"token": token})
            response.headers["set-cookie"] = f"TPOMADA_SESSIONID={secrets.token_hex(12)}; Path=/; HttpOnly"
            return response

        @app.get("/{controller_id}/api/v2/loginStatus")
        async def login_status(controller_id: str):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            return self._ok({"login": True})

        @app.get("/{controller_id}/api/v2/users/current")
        async def users_current(controller_id: str):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            return self._ok(
                {
                    "privilege": {
                        "sites": self._site_options()
                    }
                }
            )

        @app.get("/{controller_id}/api/v2/maintenance/controllerStatus")
        async def controller_status(controller_id: str):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            return self._ok({"name": self.controller["name"]})

        @app.get("/{controller_id}/api/v2/maintenance/uiInterface")
        async def ui_interface(controller_id: str):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            return self._ok({"controllerName": self.controller["name"]})

        @app.post("/api/v2/login")
        async def login_alias(request: Request):
            return await login(self.controller["id"], request)

        @app.get("/api/v2/loginStatus")
        async def login_status_alias():
            return await login_status(self.controller["id"])

        @app.get("/api/v2/users/current")
        async def users_current_alias():
            return await users_current(self.controller["id"])

        @app.get("/api/v2/maintenance/controllerStatus")
        async def controller_status_alias():
            return await controller_status(self.controller["id"])

        @app.get("/api/v2/maintenance/uiInterface")
        async def ui_interface_alias():
            return await ui_interface(self.controller["id"])

        @app.get("/{controller_id}/api/v2/sites")
        async def list_sites(controller_id: str, request: Request):
            if not self._matches_controller(controller_id):
                return self._not_found("controller not found")
            sites = [
                {"id": option["key"], "key": option["key"], "name": option["name"]}
                for option in self._site_options()
            ]
            return self._ok(self._paginate(sites, request))

        @app.get("/{controller_id}/api/v2/sites/{site}/clients")
        async def list_clients(controller_id: str, site: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err

            filters_active = request.query_params.get("filters.active")
            items = self._runtime_clients()
            if filters_active == "true":
                items = [item for item in items if bool(item.get("active"))]
            return self._ok(self._paginate(items, request))

        @app.get("/{controller_id}/api/v2/sites/{site}/clients/{mac}")
        async def get_client(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            client = self._ensure_client(mac)
            current = copy.deepcopy(client)
            current["active"] = self._is_client_active(client)
            self._randomize_client_metrics(current)
            if current["active"]:
                current["lastSeen"] = int(time.time() * 1000)
            return self._ok(current)

        @app.patch("/{controller_id}/api/v2/sites/{site}/clients/{mac}")
        async def patch_client(controller_id: str, site: str, mac: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            payload = await request.json()
            client = self._ensure_client(mac)
            client.update(payload)
            return self._ok(client)

        @app.get("/{controller_id}/api/v2/sites/{site}/insight/clients")
        async def list_known_clients(controller_id: str, site: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            runtime_clients = self._runtime_clients()
            return self._ok(self._paginate(self._runtime_known_clients(runtime_clients), request))

        @app.get("/{controller_id}/api/v2/sites/{site}/devices")
        async def list_devices(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(self._runtime_devices())

        @app.get("/{controller_id}/api/v2/sites/{site}/topology")
        async def get_topology(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(self._build_topology())

        @app.get("/{controller_id}/api/v2/sites/{site}/gateways/{mac}")
        async def get_gateway(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(copy.deepcopy(self._get_gateway_detail(mac)))

        @app.patch("/{controller_id}/api/v2/sites/{site}/gateways/{mac}")
        async def patch_gateway(controller_id: str, site: str, mac: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            payload = await request.json()
            gateway = self._get_gateway_detail(mac)
            gateway.update(payload)
            return self._ok(copy.deepcopy(gateway))

        @app.get("/{controller_id}/api/v2/sites/{site}/eaps/{mac}")
        async def get_eap(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(copy.deepcopy(self._get_ap_detail(mac)))

        @app.patch("/{controller_id}/api/v2/sites/{site}/eaps/{mac}")
        async def patch_eap(controller_id: str, site: str, mac: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            payload = await request.json()
            ap = self._get_ap_detail(mac)
            ap.update(payload)
            return self._ok(copy.deepcopy(ap))

        @app.get("/{controller_id}/api/v2/sites/{site}/switches/{mac}")
        async def get_switch(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(copy.deepcopy(self._get_switch_detail(mac)))

        @app.patch("/{controller_id}/api/v2/sites/{site}/switches/{mac}")
        async def patch_switch(controller_id: str, site: str, mac: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            payload = await request.json()
            switch = self._get_switch_detail(mac)
            switch.update(payload)
            return self._ok(copy.deepcopy(switch))

        @app.get("/{controller_id}/api/v2/sites/{site}/switches/{mac}/ports")
        async def get_switch_ports(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            self._get_switch_detail(mac)
            ports = self.switch_ports.get(_normalize_mac(mac))
            if ports is None:
                ports = []
                self.switch_ports[_normalize_mac(mac)] = ports
            return self._ok(copy.deepcopy(ports))

        @app.get("/{controller_id}/api/v2/sites/{site}/switches/{mac}/ports/{port_id}")
        async def get_switch_port(controller_id: str, site: str, mac: str, port_id: int):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            try:
                return self._ok(copy.deepcopy(self._get_switch_port(mac, port_id)))
            except KeyError:
                return JSONResponse({"errorCode": -30106, "msg": "switch port not found"}, status_code=404)

        @app.patch("/{controller_id}/api/v2/sites/{site}/switches/{mac}/ports/{port_id}")
        async def patch_switch_port(controller_id: str, site: str, mac: str, port_id: int, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            payload = await request.json()
            try:
                port = self._get_switch_port(mac, port_id)
            except KeyError:
                return JSONResponse({"errorCode": -30106, "msg": "switch port not found"}, status_code=404)

            # Update core writable fields used by Omada client.
            for key in (
                "name",
                "profileId",
                "linkSpeed",
                "duplex",
                "profileOverrideEnable",
                "tagIds",
                "nativeNetworkId",
                "networkTagsSetting",
                "tagNetworkIds",
                "untagNetworkIds",
                "voiceNetworkEnable",
                "voiceNetworkId",
                "operation",
                "bandWidthCtrlType",
                "poe",
                "dot1x",
                "lldpMedEnable",
                "loopbackDetectEnable",
                "spanningTreeEnable",
                "portIsolationEnable",
                "flowControlEnable",
                "eeeEnable",
                "loopbackDetectVlanBasedEnable",
            ):
                if key in payload:
                    port[key] = payload[key]

            return self._ok(copy.deepcopy(port))

        @app.get("/{controller_id}/api/v2/sites/{site}/devices/{mac}/firmware")
        async def get_firmware(controller_id: str, site: str, mac: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok(self._device_firmware(mac))

        @app.get("/{controller_id}/api/v2/sites/{site}/setting/lan/profileSummary")
        async def get_profile_summary(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok({"data": copy.deepcopy(self.port_profiles)})

        @app.get("/{controller_id}/api/v2/sites/{site}/setting/wlans")
        async def get_wlans(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok({"data": self._build_wlans()})

        @app.get("/{controller_id}/api/v2/sites/{site}/setting/wlans/{wlan_id}/ssids")
        async def get_wlan_ssids(controller_id: str, site: str, wlan_id: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok({"data": self._build_wlan_ssids(wlan_id)})

        @app.get("/{controller_id}/api/v2/sites/{site}/rfPlanning")
        async def rf_planning(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok({"scheduleEnable": True})

        @app.get("/{controller_id}/api/v2/sites/{site}/rfPlanning/result")
        async def rf_planning_result(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._ok({"status": 2})

        @app.put("/{controller_id}/api/v2/sites/{site}/rfPlanning/schedule")
        async def rf_planning_schedule(controller_id: str, site: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            _ = await request.json()
            return self._message("rf planning schedule updated")

        @app.post("/{controller_id}/api/v2/sites/{site}/cmd/rfPlanning/optimization")
        async def rf_optimization(controller_id: str, site: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._message("optimization started")

        @app.post("/{controller_id}/api/v2/sites/{site}/cmd/clients/{mac}/{action}")
        async def client_command(controller_id: str, site: str, mac: str, action: str):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            return self._apply_client_command(mac, action)

        @app.post("/{controller_id}/api/v2/sites/{site}/cmd/devices/{mac}/{action}")
        async def device_command(controller_id: str, site: str, mac: str, action: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            _ = await request.body()
            if action in {"reboot", "onlineUpgrade"}:
                _ = self._find_device(mac)
                return self._message(f"device {action}")
            return JSONResponse({"errorCode": -30107, "msg": "unsupported action"}, status_code=400)

        @app.post("/{controller_id}/api/v2/sites/{site}/cmd/gateways/{mac}/{action}")
        async def gateway_command(controller_id: str, site: str, mac: str, action: str, request: Request):
            err = self._require_controller_site(controller_id, site)
            if err:
                return err
            try:
                payload = await request.json()
            except Exception:
                payload = {}

            gateway = self._get_gateway_detail(mac)

            port_number = int(payload.get("portId", 1))
            mode_value = 1 if int(payload.get("operation", 1)) == 1 else 0

            if action not in {"internetState", "ipv6State"}:
                return JSONResponse({"errorCode": -30107, "msg": "unsupported action"}, status_code=400)

            for port in gateway.get("portStats", []):
                if int(port.get("port", -1)) != port_number:
                    continue

                if action == "internetState":
                    port["internetState"] = mode_value
                    result = {
                        "port": port_number,
                        "mode": port.get("mode", 0),
                        "wanConnected": bool(mode_value),
                    }
                else:
                    ipv6 = dict(port.get("wanPortIpv6Config", {}))
                    ipv6["enable"] = 1
                    ipv6["internetState"] = mode_value
                    port["wanPortIpv6Config"] = ipv6
                    result = {
                        "port": port_number,
                        "mode": port.get("mode", 0),
                        "wanConnected": bool(port.get("internetState", 0)),
                        "wanIpv6Enabled": True,
                        "ipv6WanConnected": bool(mode_value),
                    }

                for cfg in gateway.get("portConfigs", []):
                    if int(cfg.get("port", -1)) == port_number:
                        cfg["portStat"] = copy.deepcopy(port)
                return self._ok(result)

            return JSONResponse({"errorCode": -30106, "msg": "gateway port not found"}, status_code=404)

        @app.post("/openapi/v2/{controller_id}/sites/{site}/clients")
        async def openapi_list_clients(controller_id: str, site: str, request: Request):
            err = self._require_openapi_site(controller_id, site)
            if err:
                return err
            try:
                payload = await request.json()
            except Exception:
                payload = {}

            items = self._runtime_clients()
            filters = payload.get("filters") or {}
            if filters.get("active") is True:
                items = [item for item in items if bool(item.get("active"))]
            elif filters.get("active") is False:
                items = [item for item in items if not item.get("active")]
            return self._ok(self._paginate_body(items, payload))

        @app.post("/openapi/v2/{controller_id}/sites/{site}/cmd/clients/{mac}/{action}")
        async def openapi_client_command(controller_id: str, site: str, mac: str, action: str, request: Request):
            err = self._require_openapi_site(controller_id, site)
            if err:
                return err
            _ = await request.body()
            return self._apply_client_command(mac, action)

        @app.get("/openapi/v2/{controller_id}/sites/{site}/lan-profiles")
        async def openapi_lan_profiles(controller_id: str, site: str, request: Request):
            err = self._require_openapi_site(controller_id, site)
            if err:
                return err
            return self._ok(self._paginate(copy.deepcopy(self.port_profiles), request))

        @app.get("/openapi/v2/{controller_id}/sites/{site}/vpn/{slug}")
        async def openapi_vpn_list(controller_id: str, site: str, slug: str, request: Request):
            err = self._require_openapi_site(controller_id, site)
            if err:
                return err
            if slug not in VPN_LIST_SLUGS:
                return self._not_found("vpn collection not found")
            return self._ok(self._paginate([], request))

        @app.patch("/openapi/v1/{controller_id}/sites/{site}/switches/{mac}/ports/{port_id}")
        async def openapi_switch_patch(controller_id: str, site: str, mac: str, port_id: int, request: Request):
            return await patch_switch_port(controller_id, site, mac, port_id, request)

        return app

    def _apply_client_command(self, mac: str, action: str) -> JSONResponse:
        if action not in {"block", "unblock", "reconnect"}:
            return JSONResponse({"errorCode": -30107, "msg": "unsupported action"}, status_code=400)

        client = self._ensure_client(mac)
        norm = _normalize_mac(mac)
        if action in {"block", "unblock"}:
            blocked = action == "block"
            client["blocked"] = blocked
            for known in self.known_clients:
                if _normalize_mac(str(known.get("mac", ""))) == norm:
                    known["block"] = blocked
                    known["blocked"] = blocked
        else:
            client["uptime"] = 0
            client["lastSeen"] = int(time.time() * 1000)
        return self._message(f"client {action}")
