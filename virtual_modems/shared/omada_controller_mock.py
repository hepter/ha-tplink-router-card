from __future__ import annotations

import copy
import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .request_logging import install_request_logging


def _load_fixture() -> dict[str, Any]:
    file_path = Path(__file__).resolve().parents[1] / "data" / "omada_controller.json"
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "-").strip().lower()


def _index_by_mac(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {_normalize_mac(item["mac"]): copy.deepcopy(item) for item in items if "mac" in item}


class OmadaControllerMock:
    def __init__(self) -> None:
        self.fixture = _load_fixture()
        self.controller = self.fixture["controller"]
        self.username = os.getenv("VMODEM_OMADA_USERNAME", "admin")
        self.password = os.getenv("VMODEM_OMADA_PASSWORD", "admin")

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

    def _find_device(self, mac: str) -> dict[str, Any] | None:
        norm = _normalize_mac(mac)
        for device in self.devices:
            if _normalize_mac(str(device.get("mac", ""))) == norm:
                return device
        return None

    def _ensure_client(self, mac: str) -> dict[str, Any]:
        norm = _normalize_mac(mac)
        for client in self.clients:
            if _normalize_mac(str(client.get("mac", ""))) == norm:
                return client

        fallback = copy.deepcopy(self.clients[0]) if self.clients else {}
        fallback.update(
            {
                "mac": mac.upper(),
                "name": fallback.get("name") or f"client-{mac[-5:]}",
                "hostName": fallback.get("hostName") or f"client-{mac[-5:]}",
                "active": True,
                "wireless": True,
                "guest": False,
                "connectType": "wireless_user",
                "connectDevType": "ap",
                "ip": fallback.get("ip") or "10.50.0.250",
                "lastSeen": int(time.time() * 1000),
            }
        )
        self.clients.append(fallback)

        if not any(_normalize_mac(str(item.get("mac", ""))) == norm for item in self.known_clients):
            known = copy.deepcopy(self.known_clients[0]) if self.known_clients else {}
            known.update(
                {
                    "mac": mac.upper(),
                    "name": fallback.get("name"),
                    "wireless": bool(fallback.get("wireless", True)),
                    "guest": bool(fallback.get("guest", False)),
                    "block": False,
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
        device.update(
            {
                "mac": mac.upper(),
                "type": dev_type,
                "name": device.get("name") or f"Virtual {dev_type.title()}",
                "model": device.get("model") or f"Virtual-{dev_type.upper()}",
                "showModel": device.get("showModel") or f"Virtual-{dev_type.upper()}",
                "compoundModel": device.get("compoundModel") or f"Virtual {dev_type.title()}",
                "ip": device.get("ip") or "10.50.0.250",
                "status": int(device.get("status", 1) or 1),
                "statusCategory": int(device.get("statusCategory", 0) or 0),
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
                    "name": f"{ap.get('name', 'AP')} WLAN",
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
            names = {"Main-2.4G", "Main-5G", "Guest-5G"}

        sorted_names = sorted(names)
        return [{"id": f"{wlan_id}-{idx+1}", "name": ssid} for idx, ssid in enumerate(sorted_names)]

    def _ok(self, result: Any) -> JSONResponse:
        return JSONResponse({"errorCode": 0, "result": result})

    def _message(self, msg: str = "ok") -> JSONResponse:
        return JSONResponse({"errorCode": 0, "msg": msg, "result": {}})

    def _not_found(self, msg: str = "not found") -> JSONResponse:
        return JSONResponse({"errorCode": -30104, "msg": msg}, status_code=404)

    def _require_controller_site(self, controller_id: str, site: str) -> JSONResponse | None:
        if controller_id != self.controller["id"]:
            return self._not_found("controller not found")
        if site != self.controller["site_id"]:
            return self._not_found("site not found")
        return None

    def _paginate(self, items: list[dict[str, Any]], request: Request) -> dict[str, Any]:
        q = request.query_params
        page = int(q.get("currentPage", "1") or "1")
        size = int(q.get("currentPageSize", "100") or "100")
        start = max(0, (page - 1) * size)
        end = start + size
        sliced = items[start:end]
        return {
            "data": sliced,
            "currentPage": page,
            "currentSize": len(sliced),
            "totalRows": len(items),
        }

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
            if norm_mac in active_by_mac:
                if active_by_mac[norm_mac]:
                    current["lastSeen"] = now_ms
                else:
                    # Ensure flapping clients are clearly offline even if integration uses disconnect timeout.
                    current["lastSeen"] = now_ms - 15 * 60 * 1000
            known_items.append(current)
        return known_items

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
                f"<p>Username: <code>{self.username}</code> | Password: <code>{self.password}</code></p>"
                "</body></html>"
            )

        @app.get("/api/info")
        async def api_info():
            return self._ok(
                {
                    "controllerVer": self.controller["version"],
                    "omadacId": self.controller["id"],
                }
            )

        @app.post("/{controller_id}/api/v2/login")
        async def login(controller_id: str, request: Request):
            if controller_id != self.controller["id"]:
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
            if controller_id != self.controller["id"]:
                return self._not_found("controller not found")
            return self._ok({"login": True})

        @app.get("/{controller_id}/api/v2/users/current")
        async def users_current(controller_id: str):
            if controller_id != self.controller["id"]:
                return self._not_found("controller not found")
            return self._ok(
                {
                    "privilege": {
                        "sites": [
                            {
                                "name": self.controller["site_name"],
                                "key": self.controller["site_id"],
                            }
                        ]
                    }
                }
            )

        @app.get("/{controller_id}/api/v2/maintenance/controllerStatus")
        async def controller_status(controller_id: str):
            if controller_id != self.controller["id"]:
                return self._not_found("controller not found")
            return self._ok({"name": self.controller["name"]})

        @app.get("/{controller_id}/api/v2/maintenance/uiInterface")
        async def ui_interface(controller_id: str):
            if controller_id != self.controller["id"]:
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
            return self._ok(copy.deepcopy(self.devices))

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
            return self._ok({"curFwVer": "1.0.10", "lastFwVer": "1.0.12", "fwReleaseLog": "Virtual firmware changelog"})

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
            if action in {"block", "unblock", "reconnect"}:
                client = self._ensure_client(mac)
                if action == "block":
                    client["blocked"] = True
                if action == "unblock":
                    client["blocked"] = False
                return self._message(f"client {action}")
            return JSONResponse({"errorCode": -30107, "msg": "unsupported action"}, status_code=400)

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

        @app.patch("/openapi/v1/{controller_id}/sites/{site}/switches/{mac}/ports/{port_id}")
        async def openapi_switch_patch(controller_id: str, site: str, mac: str, port_id: int, request: Request):
            return await patch_switch_port(controller_id, site, mac, port_id, request)

        return app
