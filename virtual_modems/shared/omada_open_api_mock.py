from __future__ import annotations

import os
import secrets
import time
from typing import TYPE_CHECKING, Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from .omada_controller_mock import OmadaControllerMock

ACCESS_TOKEN_LIFETIME = 7200
REFRESH_TOKEN_LIFETIME = 1_209_600

ERROR_AUTH_FAILED = -44106
ERROR_TOKEN_INVALID = -44112
ERROR_CONTROLLER_NOT_FOUND = -7131
ERROR_SITE_NOT_FOUND = -33000
ERROR_NOT_FOUND = -33005
ERROR_BAD_REQUEST = -33002

RADIO_BAND_KEYS = {"wp2g": "2g", "wp5g": "5g", "wp5g2": "5g2", "wp6g": "6g"}
RADIO_BAND_BY_ID = {0: "2g", 1: "5g", 2: "5g2", 3: "6g"}
BAND_DEFAULT_CHANNEL = {"2g": 11, "5g": 44, "5g2": 149, "6g": 37}
BAND_TRAFFIC_RATE = {"2g": 42_000, "5g": 180_000, "5g2": 96_000, "6g": 240_000}

DEVICE_JOB_DETAIL_STATUS = {"reboot": 13, "upgrade": 12}
DEVICE_JOB_SECONDS = {"reboot": 25.0, "upgrade": 45.0}

CLIENT_ACTIONS = {"block", "unblock", "reconnect"}
DEVICE_ACTIONS = {"reboot", "locate", "start-online-upgrade"}


def _normalize_mac(mac: str) -> str:
    return mac.replace(":", "-").strip().lower()


def _open_api_mac(mac: str) -> str:
    return mac.replace(":", "-").strip().upper()


def _signal_percent(rssi: int) -> int:
    return max(0, min(100, 2 * (int(rssi) + 100)))


def _as_int(value: Any, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class OmadaOpenApiMock:
    """Omada Open API surface sharing the legacy mock's state."""

    def __init__(self, controller: OmadaControllerMock) -> None:
        self.controller = controller
        self.client_id = os.getenv("VMODEM_OAPI_CLIENT_ID", "virtual-open-api")
        self.client_secret = os.getenv("VMODEM_OAPI_CLIENT_SECRET", "virtual-open-api-secret")

        extras = controller.fixture.get("open_api") or {}
        self.site_extra: dict[str, Any] = extras.get("site") or {}
        self.wlan_extra: dict[str, Any] = extras.get("wlan") or {}
        self.ssid_extras: list[dict[str, Any]] = list(extras.get("ssids") or [])
        self.device_extras: dict[str, dict[str, Any]] = {
            _normalize_mac(mac): value for mac, value in (extras.get("devices") or {}).items()
        }

        self.site_led_enabled = True
        self._access_tokens: dict[str, float] = {}
        self._refresh_tokens: dict[str, float] = {}
        self._ssid_broadcast: dict[str, bool] = {}
        self._device_jobs: dict[str, tuple[str, float]] = {}
        self._rf_started: float | None = None
        self._speed_test_started: float | None = None
        self._started = time.time()


    def _ok(self, result: Any) -> JSONResponse:
        return JSONResponse({"errorCode": 0, "msg": "Success", "result": result})

    def _fail(self, code: int, msg: str, status_code: int = 200) -> JSONResponse:
        return JSONResponse({"errorCode": code, "msg": msg, "result": {}}, status_code=status_code)

    def _page(self, items: list[Any], page: int, page_size: int) -> dict[str, Any]:
        page = max(1, page)
        page_size = max(1, page_size)
        start = (page - 1) * page_size
        sliced = items[start : start + page_size]
        return {
            "totalRows": len(items),
            "currentPage": page,
            "currentSize": len(sliced),
            "data": sliced,
        }

    def _query_page(self, request: Request, default_size: int = 100) -> tuple[int, int]:
        params = request.query_params
        try:
            page = int(params.get("page", "1") or "1")
        except ValueError:
            page = 1
        try:
            page_size = int(params.get("pageSize", str(default_size)) or default_size)
        except ValueError:
            page_size = default_size
        return page, page_size


    def owns_request(self, request: Request) -> bool:
        header = request.headers.get("authorization", "")
        return header.strip().lower().startswith("accesstoken=")

    def _issue_tokens(self) -> dict[str, Any]:
        now = time.time()
        self._access_tokens = {
            token: expiry for token, expiry in self._access_tokens.items() if expiry > now
        }
        self._refresh_tokens = {
            token: expiry for token, expiry in self._refresh_tokens.items() if expiry > now
        }
        access_token = secrets.token_hex(24)
        refresh_token = secrets.token_hex(24)
        self._access_tokens[access_token] = now + ACCESS_TOKEN_LIFETIME
        self._refresh_tokens[refresh_token] = now + REFRESH_TOKEN_LIFETIME
        return {
            "accessToken": access_token,
            "tokenType": "bearer",
            "expiresIn": ACCESS_TOKEN_LIFETIME,
            "refreshToken": refresh_token,
        }

    def _check_token(self, request: Request) -> JSONResponse | None:
        header = request.headers.get("authorization", "").strip()
        if not header.lower().startswith("accesstoken="):
            return self._fail(ERROR_TOKEN_INVALID, "Invalid access token")
        token = header.split("=", 1)[1].strip()
        expiry = self._access_tokens.get(token)
        if expiry is None or expiry <= time.time():
            self._access_tokens.pop(token, None)
            return self._fail(ERROR_TOKEN_INVALID, "Access token expired or invalid")
        return None

    def _guard(self, request: Request, omadac_id: str, site_id: str | None = None) -> JSONResponse | None:
        denied = self._check_token(request)
        if denied is not None:
            return denied
        if not self.controller._matches_controller(omadac_id):
            return self._fail(ERROR_CONTROLLER_NOT_FOUND, "Controller ID does not exist")
        if site_id is not None and site_id not in self.controller._site_aliases():
            return self._fail(ERROR_SITE_NOT_FOUND, "Site does not exist")
        return None


    @property
    def site_id(self) -> str:
        return str(self.controller.controller.get("site_id", "site-main"))

    @property
    def site_name(self) -> str:
        return str(self.controller.controller.get("site_name", "Default"))

    @property
    def wlan_id(self) -> str:
        return str(self.wlan_extra.get("id") or "vm-wlan-1")

    @property
    def wlan_name(self) -> str:
        return str(self.wlan_extra.get("name") or "Virtual WLAN Group")

    def _find_device(self, mac: str) -> dict[str, Any] | None:
        return self.controller._find_device(mac)

    def _switch_port_names(self) -> dict[tuple[str, int], str]:
        names: dict[tuple[str, int], str] = {}
        for mac, ports in self.controller.switch_ports.items():
            for port in ports:
                names[(mac, int(port.get("port", 0)))] = str(port.get("name") or f"Port{port.get('port')}")
        return names

    def _expire_device_jobs(self) -> None:
        now = time.time()
        for mac, (kind, until) in list(self._device_jobs.items()):
            if until > now:
                continue
            del self._device_jobs[mac]
            if kind != "upgrade":
                continue
            device = self.controller._find_device(mac)
            if device is None:
                continue
            firmware = self.controller._device_firmware(mac)
            device["firmwareVersion"] = firmware["lastFwVer"]
            device["needUpgrade"] = False


    def _uplink_of(self, device: dict[str, Any]) -> tuple[str | None, int | None]:
        norm = _normalize_mac(str(device.get("mac", "")))
        if device.get("type") == "switch":
            uplink = self.controller.switch_details.get(norm, {}).get("uplink")
        elif device.get("type") == "ap":
            uplink = self.controller.ap_details.get(norm, {}).get("wiredUplink")
        else:
            uplink = None

        if isinstance(uplink, dict) and uplink.get("mac"):
            return str(uplink["mac"]), uplink.get("port")

        fallback = device.get("uplink")
        if isinstance(fallback, str) and fallback:
            return fallback, None
        return None, None

    def _devices(self) -> list[dict[str, Any]]:
        self._expire_device_jobs()
        runtime = self.controller._runtime_devices()
        names_by_mac = {
            _normalize_mac(str(item.get("mac", ""))): str(item.get("name", "")) for item in runtime
        }
        now_ms = int(time.time() * 1000)
        gateway_ip = self._gateway_public_ip()

        payload: list[dict[str, Any]] = []
        for device in runtime:
            norm = _normalize_mac(str(device.get("mac", "")))
            extra = self.device_extras.get(norm, {})
            uplink_mac, uplink_port = self._uplink_of(device)
            job = self._device_jobs.get(norm)
            status = int(device.get("status", 0) or 0)
            detail_status = DEVICE_JOB_DETAIL_STATUS[job[0]] if job else status
            device_type = str(device.get("type", "unknown"))

            payload.append(
                {
                    "mac": _open_api_mac(str(device.get("mac", ""))),
                    "name": device.get("name"),
                    "model": device.get("model"),
                    "modelName": device.get("showModel"),
                    "modelVersion": device.get("compoundModel"),
                    "type": device_type,
                    "subtype": "",
                    "deviceSeriesType": "",
                    "status": detail_status,
                    "statusCategory": int(device.get("statusCategory", 0) or 0),
                    "detailStatus": detail_status,
                    "lastSeen": now_ms,
                    "ip": device.get("ip"),
                    "publicIp": gateway_ip if device_type == "gateway" else None,
                    "ipv6": [],
                    "uptime": int(device.get("uptimeLong", 0) or 0),
                    "cpuUtil": int(device.get("cpuUtil", 0) or 0),
                    "memUtil": int(device.get("memUtil", 0) or 0),
                    "firmwareVersion": device.get("firmwareVersion"),
                    "compatible": 0,
                    "active": int(device.get("statusCategory", 0) or 0) == 1,
                    "clientNum": int(device.get("clientNum", 0) or 0),
                    "uplinkDeviceMac": _open_api_mac(uplink_mac) if uplink_mac else None,
                    "uplinkDeviceName": names_by_mac.get(_normalize_mac(uplink_mac)) if uplink_mac else None,
                    "uplinkDevicePort": uplink_port,
                    "linkSpeed": 3 if uplink_mac else 0,
                    "duplex": bool(uplink_mac),
                    "tagName": None,
                    "licenseStatus": 0,
                    "inWhiteList": False,
                    "switchConsistent": True,
                    "ledSetting": _as_int(device.get("ledSetting"), 2),
                    "sn": extra.get("sn"),
                    "site": self.site_id,
                }
            )
        return payload

    def _gateway_public_ip(self) -> str | None:
        for detail in self.controller.gateway_details.values():
            for port in detail.get("portStats", []):
                if int(port.get("type", -1)) == 0 and port.get("ip"):
                    return str(port["ip"])
        return None


    def _clients(self) -> list[dict[str, Any]]:
        port_names = self._switch_port_names()
        rand = self.controller._rand
        payload: list[dict[str, Any]] = []

        for client in self.controller._runtime_clients():
            blocked = bool(client.get("blocked", False))
            # A blocked client loses its association on a real controller.
            active = bool(client.get("active", False)) and not blocked
            wireless = bool(client.get("wireless", False))
            activity = int(client.get("activity", 0) or 0) if active else 0
            upload_activity = int(activity * rand.uniform(0.15, 0.6)) if active else 0

            entry: dict[str, Any] = {
                "mac": _open_api_mac(str(client.get("mac", ""))),
                "name": client.get("name"),
                "hostName": client.get("hostName"),
                "ip": client.get("ip"),
                "ipv6List": [],
                "vendor": client.get("vendor"),
                "deviceType": client.get("deviceType"),
                "deviceCategory": client.get("deviceCategory"),
                "osName": client.get("osName"),
                "model": None,
                "active": active,
                "wireless": wireless,
                "connectDevType": client.get("connectDevType"),
                "connectType": int(client.get("connectType", 0) or 0),
                "networkName": client.get("networkName"),
                "vid": int(client.get("vid", 0) or 0),
                "rxRate": int(client.get("rxRate", 0) or 0),
                "txRate": int(client.get("txRate", 0) or 0),
                "activity": activity,
                "uploadActivity": upload_activity,
                "trafficDown": int(client.get("trafficDown", 0) or 0),
                "trafficUp": int(client.get("trafficUp", 0) or 0),
                "downPacket": int(client.get("downPacket", 0) or 0),
                "upPacket": int(client.get("upPacket", 0) or 0),
                "uptime": int(client.get("uptime", 0) or 0),
                "lastSeen": int(client.get("lastSeen", 0) or 0),
                "blocked": blocked,
                "guest": bool(client.get("guest", False)),
                "authStatus": int(client.get("authStatus", 0) or 0),
            }

            if wireless:
                rssi = int(client.get("rssi", -70) or -70)
                signal_percent = _signal_percent(rssi)
                entry.update(
                    {
                        "apMac": _open_api_mac(str(client.get("apMac", ""))),
                        "apName": client.get("apName"),
                        "ssid": client.get("ssid"),
                        "radioId": int(client.get("radioId", 0) or 0),
                        "channel": int(client.get("channel", 0) or 0),
                        "wifiMode": int(client.get("wifiMode", 0) or 0),
                        "rssi": rssi,
                        "snr": int(client.get("snr", 0) or 0),
                        # Open API reports signalLevel as a percentage, the legacy API as a 0-5 rank.
                        "signalLevel": signal_percent,
                        "signalRank": int(client.get("signalRank", 0) or 0),
                        "powerSave": bool(client.get("powerSave", False)),
                        "healthScore": max(1, min(100, signal_percent - 5)),
                    }
                )
            elif client.get("connectDevType") == "switch":
                switch_mac = str(client.get("switchMac", ""))
                port = int(client.get("port", client.get("switchPort", 0)) or 0)
                entry.update(
                    {
                        "switchMac": _open_api_mac(switch_mac),
                        "switchName": client.get("switchName"),
                        "port": port,
                        "portName": port_names.get((_normalize_mac(switch_mac), port), f"Port{port}"),
                    }
                )
            elif client.get("connectDevType") == "gateway":
                entry.update(
                    {
                        "gatewayMac": _open_api_mac(str(client.get("gatewayMac", ""))),
                        "gatewayName": client.get("gatewayName"),
                        "port": int(client.get("port", client.get("switchPort", 0)) or 0),
                    }
                )

            payload.append(entry)
        return payload

    def _scoped_clients(self, scope: int) -> list[dict[str, Any]]:
        clients = self._clients()
        if scope == 1:
            return [item for item in clients if item["active"]]
        if scope == 2:
            return [item for item in clients if not item["active"]]
        if scope == 3:
            return [item for item in clients if item["blocked"]]
        return clients


    def _ssid_catalog(self) -> list[dict[str, Any]]:
        extras = {str(item.get("name")): item for item in self.ssid_extras if item.get("name")}
        ordered: list[str] = []
        for ap in self.controller.ap_details.values():
            for override in ap.get("ssidOverrides", []):
                name = str(override.get("globalSsid") or "").strip()
                if name and name not in ordered:
                    ordered.append(name)

        catalog: list[dict[str, Any]] = []
        for index, name in enumerate(ordered, start=1):
            extra = extras.get(name, {})
            ssid_id = str(extra.get("id") or f"vm-ssid-{index}")
            broadcast = self._ssid_broadcast.setdefault(ssid_id, bool(extra.get("broadcast", True)))
            catalog.append(
                {
                    "ssidId": ssid_id,
                    "ssidEntryId": index,
                    "name": name,
                    "ssidName": name,
                    "wlanId": self.wlan_id,
                    "wlanName": self.wlan_name,
                    "band": int(extra.get("band", 1)),
                    "broadcast": broadcast,
                    "security": int(extra.get("security", 3)),
                    "guestNetEnable": bool(extra.get("guestNetEnable", False)),
                    "vlanSetting": {"mode": 0},
                    "wlanSchedule": {"scheduleEnable": False},
                }
            )
        return catalog

    def _ssid_detail(self, ssid_id: str) -> dict[str, Any] | None:
        for ssid in self._ssid_catalog():
            if ssid["ssidId"] != ssid_id:
                continue
            detail = dict(ssid)
            detail.update(
                {
                    "createTime": 1_700_000_000,
                    "updateTime": int(time.time()),
                    "vlanId": 1,
                    "macFilterEnable": False,
                    "rateLimit": {"upLimitEnable": False, "downLimitEnable": False},
                }
            )
            return detail
        return None

    def _ap_overrides(self, ap_mac: str) -> dict[str, Any] | None:
        detail = self.controller.ap_details.get(_normalize_mac(ap_mac))
        if detail is None:
            return None
        catalog = {item["name"]: item for item in self._ssid_catalog()}
        overrides: list[dict[str, Any]] = []
        for override in detail.get("ssidOverrides", []):
            name = str(override.get("globalSsid") or "").strip()
            ssid = catalog.get(name)
            if ssid is None:
                continue
            overrides.append(
                {
                    "ssidId": ssid["ssidId"],
                    "ssidEntryId": ssid["ssidEntryId"],
                    "ssidName": name,
                    "ssidEnable": bool(override.get("ssidEnable", True)),
                    "overrideSsidEnable": bool(override.get("overrideSsidEnable", False)),
                    "overrideVlanEnable": bool(override.get("overrideVlanEnable", False)),
                    "band": [0, 1],
                    "security": ssid["security"],
                }
            )
        return {"ssidOverrides": overrides}

    def _apply_ap_overrides(self, ap_mac: str, payload: list[dict[str, Any]]) -> bool:
        detail = self.controller.ap_details.get(_normalize_mac(ap_mac))
        if detail is None:
            return False
        catalog = {item["ssidEntryId"]: item["name"] for item in self._ssid_catalog()}
        wanted = {
            catalog.get(int(item.get("ssidEntryId", -1))): item
            for item in payload
            if item.get("ssidEntryId") is not None
        }
        for override in detail.get("ssidOverrides", []):
            update = wanted.get(str(override.get("globalSsid") or "").strip())
            if update is None:
                continue
            if "ssidEnable" in update:
                override["ssidEnable"] = bool(update["ssidEnable"])
            if "overrideSsidEnable" in update:
                override["overrideSsidEnable"] = bool(update["overrideSsidEnable"])
            if "overrideVlanEnable" in update:
                override["overrideVlanEnable"] = bool(update["overrideVlanEnable"])
        return True


    def _poe_port_rows(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for device in self.controller.devices:
            if device.get("type") != "switch":
                continue
            norm = _normalize_mac(str(device.get("mac", "")))
            cap = self.controller.switch_details.get(norm, {}).get("devCap", {})
            switch_supports = 1 if cap.get("poeSupport") else 0
            for index, port in enumerate(self.controller.switch_ports.get(norm, [])):
                number = int(port.get("port", index + 1))
                poe_on = int(port.get("poe", 0) or 0) == 1
                power = round(4.2 + (index % 5) * 2.4, 1) if poe_on else 0.0
                voltage = 53.4 if poe_on else 0.0
                current = round(power / voltage * 1000, 1) if poe_on else 0.0
                link_status = int((port.get("portStatus") or {}).get("linkStatus", 0) or 0)
                rows.append(
                    {
                        "port": number,
                        "switchMac": _open_api_mac(str(device.get("mac", ""))),
                        "switchName": device.get("name"),
                        "portName": port.get("name") or f"Port{number}",
                        "supportPoe": bool(port.get("supportPoe", False)),
                        "switchSupportPoe": switch_supports,
                        "poe": 1 if poe_on else 0,
                        "power": power,
                        "voltage": voltage,
                        "current": current,
                        "poeStatus": 1.0 if poe_on else 0.0,
                        "pdClass": "Class 4" if poe_on else "",
                        "poeDisplayType": 4 if port.get("supportPoe") else -1,
                        "connectedStatus": 0 if link_status == 1 else 1,
                    }
                )
        return rows

    def _poe_usage(self) -> list[dict[str, Any]]:
        rows = self._poe_port_rows()
        usage: list[dict[str, Any]] = []
        for device in self.controller.devices:
            if device.get("type") != "switch":
                continue
            mac = _open_api_mac(str(device.get("mac", "")))
            ports = [row for row in rows if row["switchMac"] == mac]
            used = round(sum(row["power"] for row in ports), 1)
            extra = self.device_extras.get(_normalize_mac(str(device.get("mac", ""))), {})
            budget = float(extra.get("poeBudget", 0) or 0)
            usage.append(
                {
                    "mac": mac,
                    "name": device.get("name"),
                    "portNum": len(ports),
                    "totalPower": budget,
                    "totalPowerUsed": used,
                    "totalPercentUsed": round(used / budget * 100, 2) if budget else 0.0,
                }
            )
        return usage

    def _switch_details(self) -> list[dict[str, Any]]:
        details: list[dict[str, Any]] = []
        for device in self.controller.devices:
            if device.get("type") != "switch":
                continue
            norm = _normalize_mac(str(device.get("mac", "")))
            details.append(
                {
                    "mac": _open_api_mac(str(device.get("mac", ""))),
                    "name": device.get("name"),
                    "portNum": len(self.controller.switch_ports.get(norm, [])),
                }
            )
        return details

    def _set_port_poe(self, switch_mac: str, ports: list[int], poe_mode: int) -> bool:
        norm = _normalize_mac(switch_mac)
        known = self.controller.switch_ports.get(norm)
        if known is None:
            return False
        wanted = {int(port) for port in ports}
        for port in known:
            if int(port.get("port", -1)) in wanted:
                port["poe"] = 1 if poe_mode else 0
                status = port.setdefault("portStatus", {})
                status["poe"] = bool(poe_mode)
        return True

    def _set_port_profile_override(self, switch_mac: str, ports: list[int], enable: bool) -> bool:
        norm = _normalize_mac(switch_mac)
        known = self.controller.switch_ports.get(norm)
        if known is None:
            return False
        wanted = {int(port) for port in ports}
        for port in known:
            if int(port.get("port", -1)) in wanted:
                port["profileOverrideEnable"] = bool(enable)
        return True


    def _ap_radios(self, ap_mac: str) -> dict[str, Any] | None:
        device = self._find_device(ap_mac)
        if device is None or device.get("type") != "ap":
            return None

        norm = _normalize_mac(ap_mac)
        channels: dict[str, int] = {}
        for client in self.controller.clients:
            if _normalize_mac(str(client.get("apMac", ""))) != norm:
                continue
            band = RADIO_BAND_BY_ID.get(int(client.get("radioId", 0) or 0))
            if band and band not in channels:
                channels[band] = int(client.get("channel", 0) or 0)

        elapsed = int(time.time() - self._started)
        base_rx = int(device.get("download", 0) or 0)
        base_tx = int(device.get("upload", 0) or 0)

        payload: dict[str, Any] = {}
        bands = [key for key in RADIO_BAND_KEYS if isinstance(device.get(key), dict)]
        for key in bands:
            suffix = RADIO_BAND_KEYS[key]
            radio = device[key]
            tx_util = int(radio.get("txUtil", 0) or 0)
            rx_util = int(radio.get("rxUtil", 0) or 0)
            inter_util = int(radio.get("interUtil", 0) or 0)
            rate = BAND_TRAFFIC_RATE.get(suffix, 60_000)
            payload[key] = {
                "txUtil": tx_util,
                "rxUtil": rx_util,
                "interUtil": inter_util,
                "busyUtil": min(100, tx_util + rx_util + inter_util),
                "actualChannel": channels.get(suffix, BAND_DEFAULT_CHANNEL.get(suffix, 0)),
                "txPower": _as_int(radio.get("txPower"), 20),
                "bandWidth": radio.get("bandWidth", "20MHz"),
            }
            payload[f"radioTraffic{suffix}"] = {
                "rx": base_rx // max(1, len(bands)) + elapsed * rate,
                "tx": base_tx // max(1, len(bands)) + elapsed * (rate // 3),
            }
        return payload

    def _ap_radio_config(self, ap_mac: str) -> dict[str, Any] | None:
        device = self._find_device(ap_mac)
        if device is None or device.get("type") != "ap":
            return None
        misc = device.get("deviceMisc", {})
        config: dict[str, Any] = {}
        for band, supported in (
            ("2g", True),
            ("5g", bool(misc.get("support5g", True))),
            ("5g2", bool(misc.get("support5g2", False))),
            ("6g", bool(misc.get("support6g", False))),
        ):
            key = f"radioSetting{band}"
            setting = device.get(key)
            if not supported or not isinstance(setting, dict):
                continue
            config[key] = {"radioEnable": bool(setting.get("radioEnable", True))}
        return config

    def _set_ap_radio_config(self, ap_mac: str, payload: dict[str, Any]) -> bool:
        device = self._find_device(ap_mac)
        if device is None or device.get("type") != "ap":
            return False
        norm = _normalize_mac(ap_mac)
        detail = self.controller.ap_details.get(norm)
        for key, value in payload.items():
            if not key.startswith("radioSetting") or not isinstance(value, dict):
                continue
            if "radioEnable" not in value:
                continue
            enabled = bool(value["radioEnable"])
            device.setdefault(key, {})["radioEnable"] = enabled
            if detail is not None and isinstance(detail.get(key), dict):
                detail[key]["radioEnable"] = enabled
        return True


    def _wan_status(self, gateway_mac: str) -> list[dict[str, Any]] | None:
        detail = self.controller.gateway_details.get(_normalize_mac(gateway_mac))
        if detail is None:
            return None
        rand = self.controller._rand
        ports: list[dict[str, Any]] = []
        for port in detail.get("portStats", []):
            if int(port.get("type", -1)) != 0:
                continue
            connected = int(port.get("internetState", 0) or 0) == 1
            ports.append(
                {
                    "portName": port.get("name"),
                    "name": port.get("name"),
                    "mode": int(port.get("mode", 0) or 0),
                    "status": int(port.get("status", 0) or 0),
                    "internetState": int(port.get("internetState", 0) or 0),
                    "ip": port.get("ip", ""),
                    "rxRate": round(float(port.get("rxRate", 0) or 0) * rand.uniform(0.7, 1.3), 1),
                    "txRate": round(float(port.get("txRate", 0) or 0) * rand.uniform(0.7, 1.3), 1),
                    "rx": int(port.get("rx", 0) or 0),
                    "tx": int(port.get("tx", 0) or 0),
                    "latency": rand.randint(8, 28) if connected else 0,
                    "loss": round(rand.uniform(0.0, 0.8), 2) if connected else 0.0,
                    "speed": int(port.get("speed", 0) or 0),
                    "wanPortIpv6Config": port.get("wanPortIpv6Config", {"enable": 0}),
                }
            )
        return ports

    def _wan_ports(self, gateway_mac: str) -> list[dict[str, Any]] | None:
        detail = self.controller.gateway_details.get(_normalize_mac(gateway_mac))
        if detail is None:
            return None
        ports: list[dict[str, Any]] = []
        for port in detail.get("portStats", []):
            if int(port.get("type", -1)) != 0:
                continue
            number = _as_int(port.get("port"), len(ports) + 1)
            ports.append(
                {
                    "port": number,
                    "portUuid": f"{number}_vm-wan{number}",
                    "name": port.get("name") or f"WAN{number}",
                    "portName": port.get("name") or f"WAN{number}",
                }
            )
        return ports

    def _speed_test_results(self, gateway_mac: str) -> list[dict[str, Any]]:
        ports = self._wan_ports(gateway_mac) or []
        running = self._speed_test_started is not None and time.time() - self._speed_test_started < 45
        finished_at = int(self._speed_test_started or (time.time() - 3600))
        return [
            {
                "portId": port["port"],
                "portUuid": port["portUuid"],
                "portName": port["portName"],
                "status": 2 if running else 0,
                "down": 0 if running else 938_000_000,
                "up": 0 if running else 214_000_000,
                "latency": 0 if running else 12,
                "time": finished_at,
            }
            for port in ports
        ]

    def _gateway_info(self, gateway_mac: str) -> dict[str, Any] | None:
        detail = self.controller.gateway_details.get(_normalize_mac(gateway_mac))
        if detail is None:
            return None
        extra = self.device_extras.get(_normalize_mac(gateway_mac), {})
        return {
            "mac": _open_api_mac(gateway_mac),
            "name": detail.get("name"),
            "temp": extra.get("temp"),
        }


    def _client_stat_devices(self, macs: list[str]) -> list[dict[str, Any]]:
        wanted = {_normalize_mac(mac) for mac in macs}
        rows: list[dict[str, Any]] = []
        for device in self.controller._runtime_devices():
            norm = _normalize_mac(str(device.get("mac", "")))
            if norm not in wanted:
                continue
            rows.append(
                {
                    "mac": _open_api_mac(str(device.get("mac", ""))),
                    "clientNum": int(device.get("clientNum", 0) or 0),
                    "clientNum2g": int(device.get("clientNum2g", 0) or 0),
                    "clientNum5g": int(device.get("clientNum5g", 0) or 0),
                    "clientNum5g2": 0,
                    "clientNum6g": int(device.get("clientNum6g", 0) or 0),
                }
            )
        return rows

    def _uplink_info(self, macs: list[str]) -> list[dict[str, Any]]:
        wanted = {_normalize_mac(mac) for mac in macs}
        devices = {_normalize_mac(str(d.get("mac", ""))): d for d in self.controller.devices}
        rows: list[dict[str, Any]] = []
        for norm, device in devices.items():
            if norm not in wanted:
                continue
            uplink_mac, uplink_port = self._uplink_of(device)
            if not uplink_mac:
                continue
            uplink_device = devices.get(_normalize_mac(uplink_mac), {})
            rows.append(
                {
                    "deviceMac": _open_api_mac(str(device.get("mac", ""))),
                    "uplinkDeviceMac": _open_api_mac(uplink_mac),
                    "uplinkDeviceName": uplink_device.get("name"),
                    "uplinkDevicePort": uplink_port,
                    "linkSpeed": 3,
                    "duplex": True,
                }
            )
        return rows

    def _device_stats(self, device_mac: str, start: int, end: int) -> list[dict[str, Any]]:
        device = self._find_device(device_mac)
        if device is None:
            return []
        buckets = max(1, min(24, (max(end - start, 3600)) // 3600))
        rx = int(device.get("download", 0) or 0)
        tx = int(device.get("upload", 0) or 0)
        return [
            {
                "time": start + index * 3600,
                "ports": [{"port": 1, "rx": rx // buckets, "tx": tx // buckets}],
            }
            for index in range(buckets)
        ]


    def install(self, app: FastAPI) -> None:
        @app.post("/openapi/authorize/token")
        async def authorize_token(request: Request):
            grant_type = request.query_params.get("grant_type", "")
            try:
                payload = await request.json()
            except Exception:
                payload = {}

            if payload.get("client_id") != self.client_id or payload.get("client_secret") != self.client_secret:
                return self._fail(ERROR_AUTH_FAILED, "Invalid client credentials")

            if grant_type == "client_credentials":
                omadac_id = str(payload.get("omadacId", ""))
                if not self.controller._matches_controller(omadac_id):
                    return self._fail(ERROR_CONTROLLER_NOT_FOUND, "Controller ID does not exist")
                return self._ok(self._issue_tokens())

            if grant_type == "refresh_token":
                refresh_token = str(payload.get("refresh_token", ""))
                expiry = self._refresh_tokens.get(refresh_token)
                if expiry is None or expiry <= time.time():
                    return self._fail(ERROR_AUTH_FAILED, "Refresh token expired or invalid")
                self._refresh_tokens.pop(refresh_token, None)
                return self._ok(self._issue_tokens())

            return self._fail(ERROR_BAD_REQUEST, f"Unsupported grant_type {grant_type!r}")

        @app.get("/openapi/v1/{omadac_id}/sites")
        async def list_sites(omadac_id: str, request: Request):
            denied = self._guard(request, omadac_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request)
            site = {
                "siteId": self.site_id,
                "name": self.site_name,
                "region": self.site_extra.get("region", "Virtual Lab"),
                "type": int(self.site_extra.get("type", 0) or 0),
                "timeZone": self.site_extra.get("timeZone", "UTC"),
                "scenario": self.site_extra.get("scenario", "Office"),
                "deviceAccount": {"username": self.controller.username},
            }
            return self._ok(self._page([site], page, page_size))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/devices")
        async def list_devices(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request)
            return self._ok(self._page(self._devices(), page, page_size))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/clients")
        async def list_clients_v1(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request)
            return self._ok(self._page(self._scoped_clients(0), page, page_size))

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/devices/uplink-info")
        async def device_uplink_info(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            return self._ok(self._uplink_info(list(payload.get("deviceMacs") or [])))

        @app.post("/openapi/v1/{omadac_id}/clients/stat/devices")
        async def client_stat_devices(omadac_id: str, request: Request):
            denied = self._guard(request, omadac_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            macs = [str(item.get("mac", "")) for item in (payload.get("devices") or [])]
            return self._ok(self._client_stat_devices(macs))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/dashboard/poe-usage")
        async def poe_usage(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            return self._ok(self._poe_usage())

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/switches/ports/poe-info")
        async def poe_info(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request, default_size=1000)
            return self._ok(self._page(self._poe_port_rows(), page, page_size))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/switches/ports/switch-detail")
        async def switch_detail(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            return self._ok(self._switch_details())

        @app.put("/openapi/v1/{omadac_id}/sites/{site_id}/switches/{switch_mac}/multi-ports/profile-override")
        async def multi_ports_profile_override(omadac_id: str, site_id: str, switch_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            ports = [int(port) for port in (payload.get("portList") or [])]
            if not self._set_port_profile_override(switch_mac, ports, bool(payload.get("profileOverrideEnable"))):
                return self._fail(ERROR_NOT_FOUND, "Switch not found")
            return self._ok({})

        @app.put("/openapi/v1/{omadac_id}/sites/{site_id}/switches/{switch_mac}/multi-ports/poe-mode")
        async def multi_ports_poe_mode(omadac_id: str, site_id: str, switch_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            ports = [int(port) for port in (payload.get("portList") or [])]
            if not self._set_port_poe(switch_mac, ports, int(payload.get("poeMode", 0) or 0)):
                return self._fail(ERROR_NOT_FOUND, "Switch not found")
            return self._ok({})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/led")
        async def get_site_led(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            return self._ok({"enable": self.site_led_enabled})

        @app.put("/openapi/v1/{omadac_id}/sites/{site_id}/led")
        async def set_site_led(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            self.site_led_enabled = bool(payload.get("enable", self.site_led_enabled))
            return self._ok({"enable": self.site_led_enabled})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/aps/{ap_mac}/general-config")
        async def get_ap_general_config(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            device = self._find_device(ap_mac)
            if device is None or device.get("type") != "ap":
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok({"ledSetting": _as_int(device.get("ledSetting"), 2)})

        @app.patch("/openapi/v1/{omadac_id}/sites/{site_id}/aps/{ap_mac}/general-config")
        async def set_ap_general_config(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            device = self._find_device(ap_mac)
            if device is None or device.get("type") != "ap":
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            if "ledSetting" in payload:
                led_setting = int(payload["ledSetting"])
                device["ledSetting"] = led_setting
                detail = self.controller.ap_details.get(_normalize_mac(ap_mac))
                if detail is not None:
                    detail["ledSetting"] = led_setting
            return self._ok({"ledSetting": _as_int(device.get("ledSetting"), 2)})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/aps/{ap_mac}/radio-config")
        async def get_ap_radio_config(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            config = self._ap_radio_config(ap_mac)
            if config is None:
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok(config)

        @app.patch("/openapi/v1/{omadac_id}/sites/{site_id}/aps/{ap_mac}/radio-config")
        async def set_ap_radio_config(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            if not self._set_ap_radio_config(ap_mac, payload):
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok(self._ap_radio_config(ap_mac) or {})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/aps/{ap_mac}/radios")
        async def get_ap_radios(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            radios = self._ap_radios(ap_mac)
            if radios is None:
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok(radios)

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/gateways/{gateway_mac}")
        async def get_gateway(omadac_id: str, site_id: str, gateway_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            info = self._gateway_info(gateway_mac)
            if info is None:
                return self._fail(ERROR_NOT_FOUND, "Gateway not found")
            return self._ok(info)

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/gateways/{gateway_mac}/wan-status")
        async def get_wan_status(omadac_id: str, site_id: str, gateway_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            ports = self._wan_status(gateway_mac)
            if ports is None:
                return self._fail(ERROR_NOT_FOUND, "Gateway not found")
            return self._ok(ports)

        @app.get("/openapi/v2/{omadac_id}/sites/{site_id}/dashboard/gateway/isp/load")
        async def gateway_isp_load(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            gateways = [
                {
                    "mac": _open_api_mac(str(detail.get("mac", ""))),
                    "name": detail.get("name"),
                    "ispInfo": {"ispArr": self._wan_ports(str(detail.get("mac", ""))) or []},
                }
                for detail in self.controller.gateway_details.values()
            ]
            return self._ok({"data": gateways})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/gateways/{gateway_mac}/speedTestResult")
        async def speed_test_result(omadac_id: str, site_id: str, gateway_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if self._wan_ports(gateway_mac) is None:
                return self._fail(ERROR_NOT_FOUND, "Gateway not found")
            results = self._speed_test_results(gateway_mac)
            return self._ok({"status": results[0]["status"] if results else 0, "portSpeedResults": results})

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/gateways/{gateway_mac}/speedTestResult/dateList")
        async def speed_test_history(omadac_id: str, site_id: str, gateway_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            port_uuid = str(payload.get("portUuid", ""))
            rows = [row for row in self._speed_test_results(gateway_mac) if row["portUuid"] == port_uuid]
            return self._ok({"totalRows": len(rows), "data": rows[:1]})

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/gateways/{gateway_mac}/speedTest")
        async def speed_test_start(omadac_id: str, site_id: str, gateway_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if self._wan_ports(gateway_mac) is None:
                return self._fail(ERROR_NOT_FOUND, "Gateway not found")
            self._speed_test_started = time.time()
            return self._ok({})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/wireless-network/wlans")
        async def list_wlans(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            return self._ok([{"wlanId": self.wlan_id, "id": self.wlan_id, "name": self.wlan_name}])

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/wireless-network/wlans/{wlan_id}/ssids")
        async def list_wlan_ssids(omadac_id: str, site_id: str, wlan_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if wlan_id != self.wlan_id:
                return self._fail(ERROR_NOT_FOUND, "WLAN group not found")
            page, page_size = self._query_page(request)
            return self._ok(self._page(self._ssid_catalog(), page, page_size))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/wireless-network/wlans/{wlan_id}/ssids/{ssid_id}")
        async def get_wlan_ssid(omadac_id: str, site_id: str, wlan_id: str, ssid_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            detail = self._ssid_detail(ssid_id)
            if detail is None:
                return self._fail(ERROR_NOT_FOUND, "SSID not found")
            return self._ok(detail)

        @app.patch("/openapi/v1/{omadac_id}/sites/{site_id}/wireless-network/wlans/{wlan_id}/ssids/{ssid_id}/update-basic-config")
        async def update_wlan_ssid(omadac_id: str, site_id: str, wlan_id: str, ssid_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if self._ssid_detail(ssid_id) is None:
                return self._fail(ERROR_NOT_FOUND, "SSID not found")
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            if "broadcast" in payload:
                self._ssid_broadcast[ssid_id] = bool(payload["broadcast"])
            return self._ok({})

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/clients/{client_mac}/{action}")
        async def client_command(omadac_id: str, site_id: str, client_mac: str, action: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if action not in CLIENT_ACTIONS:
                return self._fail(ERROR_BAD_REQUEST, f"Unsupported client action {action!r}")
            self.controller._apply_client_command(client_mac, action)
            return self._ok({})

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/devices/{device_mac}/{action}")
        async def device_command(omadac_id: str, site_id: str, device_mac: str, action: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if action not in DEVICE_ACTIONS:
                return self._fail(ERROR_BAD_REQUEST, f"Unsupported device action {action!r}")
            device = self._find_device(device_mac)
            if device is None:
                return self._fail(ERROR_NOT_FOUND, "Device not found")
            if action == "reboot":
                self._device_jobs[_normalize_mac(device_mac)] = ("reboot", time.time() + DEVICE_JOB_SECONDS["reboot"])
            elif action == "start-online-upgrade":
                self._device_jobs[_normalize_mac(device_mac)] = (
                    "upgrade",
                    time.time() + DEVICE_JOB_SECONDS["upgrade"],
                )
            return self._ok({})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/devices/{device_mac}/latest-firmware-info")
        async def latest_firmware_info(omadac_id: str, site_id: str, device_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if self._find_device(device_mac) is None:
                return self._fail(ERROR_NOT_FOUND, "Device not found")
            return self._ok(self.controller._device_firmware(device_mac))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/radio-frequency-planning/result")
        async def rf_planning_result(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            if self._rf_started is None:
                return self._ok({"status": 1, "beforeIndex": 0, "afterIndex": 0})
            if time.time() - self._rf_started < 90:
                return self._ok({"status": 2, "beforeIndex": 55, "afterIndex": 0})
            return self._ok({"status": 0, "beforeIndex": 55, "afterIndex": 82})

        @app.post("/openapi/v1/{omadac_id}/sites/{site_id}/cmd/rfPlanning/rrmOptimization")
        async def rf_planning_start(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            self._rf_started = time.time()
            return self._ok({})

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/applicationControl/applications")
        async def list_applications(omadac_id: str, site_id: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request, default_size=1000)
            return self._ok(self._page([], page, page_size))

        @app.get("/openapi/v1/{omadac_id}/sites/{site_id}/setting/vpn/stats/{kind}")
        async def list_vpn_stats(omadac_id: str, site_id: str, kind: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request)
            return self._ok(self._page([], page, page_size))

        @app.get("/openapi/v1/{omadac_id}/security/threat-management")
        async def list_threats(omadac_id: str, request: Request):
            denied = self._guard(request, omadac_id)
            if denied is not None:
                return denied
            page, page_size = self._query_page(request)
            return self._ok(self._page([], page, page_size))

        @app.get("/openapi/v2/{omadac_id}/sites/{site_id}/aps/{ap_mac}/override")
        async def get_ap_override(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            overrides = self._ap_overrides(ap_mac)
            if overrides is None:
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok(overrides)

        @app.patch("/openapi/v2/{omadac_id}/sites/{site_id}/aps/{ap_mac}/override")
        async def patch_ap_override(omadac_id: str, site_id: str, ap_mac: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            if not self._apply_ap_overrides(ap_mac, list(payload.get("ssidOverrides") or [])):
                return self._fail(ERROR_NOT_FOUND, "AP not found")
            return self._ok({})

        @app.post("/openapi/v2/{omadac_id}/sites/{site_id}/stat/{device_mac}/{interval}")
        async def device_stats(omadac_id: str, site_id: str, device_mac: str, interval: str, request: Request):
            denied = self._guard(request, omadac_id, site_id)
            if denied is not None:
                return denied
            try:
                payload = await request.json()
            except Exception:
                payload = {}
            start = int(payload.get("start", 0) or 0)
            end = int(payload.get("end", start) or start)
            return self._ok(self._device_stats(device_mac, start, end))

    async def list_clients_v2(self, omadac_id: str, site_id: str, request: Request) -> JSONResponse:
        denied = self._guard(request, omadac_id, site_id)
        if denied is not None:
            return denied
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        page = int(payload.get("page", 1) or 1)
        page_size = int(payload.get("pageSize", 100) or 100)
        raw_scope = payload.get("scope", 1)
        scope = int(raw_scope) if raw_scope is not None else 1
        return self._ok(self._page(self._scoped_clients(scope), page, page_size))


def install_open_api(app: FastAPI, controller: OmadaControllerMock) -> OmadaOpenApiMock:
    open_api = OmadaOpenApiMock(controller)
    open_api.install(app)
    return open_api
