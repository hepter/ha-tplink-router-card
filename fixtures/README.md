# Fixtures

Behavior-based contract fixtures used by adapter tests.

## Naming
- Use behavior-focused names.
- Keep names implementation-agnostic.
- Examples:
  - `entry_scoped_tracker_selection.json`
  - `router_device_preference.json`
  - `diagnostic_export_minimal.json`
  - `client_link_rate_kbps.json`
  - `client_activity_mapping.json`
  - `action_device_dropdown_regression.json`

## Structure
- `fixtures/tplink_router/`: payloads for `tplink_router` adapter contracts (`easymesh_node_trackers.json` mirrors the EasyMesh node trackers of `tplink_router` 2.41+).
- `fixtures/tplink_deco/`: payloads for `tplink_deco` adapter contracts.
- `fixtures/omada/`: payloads for Omada adapter contracts (`omada`, `tplink_omada`, `omada_open_api`; `omada_open_api_entry.json` mirrors the entity, attribute and device registry shapes of `ha-omada-open-api` 1.10.x).

## TP-Link Router minimum shape

```json
{
  "entryId": "config_entry_id",
  "states": {
    "device_tracker.client_name": {
      "entity_id": "device_tracker.client_name",
      "state": "home",
      "attributes": {
        "source_type": "router",
        "ip": "192.168.1.10",
        "mac": "AA-BB-CC-DD-EE-FF",
        "host_name": "client-hostname",
        "connection": "host|wired|guest|iot",
        "band": "2G|5G|6G|null",
        "tx_rate": 65000,
        "rx_rate": 6000,
        "online_time": 75818.65,
        "traffic_usage": 0,
        "signal": -45,
        "ap_name": "AX55 node|*Main router"
      }
    }
  },
  "entityRegistry": [
    {
      "entity_id": "device_tracker.client_name",
      "platform": "tplink_router",
      "config_entry_id": "config_entry_id",
      "device_id": "device-id"
    }
  ]
}
```

`tplink_router` 2.41+ EasyMesh node tracker (satellite):

```json
{
  "entity_id": "device_tracker.node_name",
  "state": "home",
  "attributes": {
    "source_type": "router",
    "ip": "192.168.0.2",
    "mac": "AA-BB-CC-DD-EE-02",
    "host_name": "RE330 Hall",
    "device_type": "RangeExtender",
    "device_model": "RE330",
    "connection_type": "wireless|wire|null",
    "status": "connected|disconnected",
    "role": "main_router|satellite_router",
    "is_main_router": false,
    "parent_mac": "AA-BB-CC-DD-EE-01",
    "client_num": 5,
    "signal_level": 3,
    "mesh_type": "easymesh",
    "vendor": "TP-Link"
  }
}
```

`is_main_router` is published only by node trackers, never by clients. The main router has no `parent_mac` and
no `signal_level`; `signal_level` is a firmware-dependent bar level (1–3 on BE, up to 5 on AX, no dBm) and older AX
firmware omits it.

## TP-Link Deco minimum shape

```json
{
  "state": {
    "entity_id": "device_tracker.client_name",
    "state": "home",
    "attributes": {
      "source_type": "router",
      "device_type": "client",
      "ip": "192.168.68.10",
      "mac": "AA-BB-CC-DD-EE-FF",
      "interface": "main|guest|iot",
      "connection_type": "wired|band2_4|band5",
      "up_kilobytes_per_s": 0.125,
      "down_kilobytes_per_s": 2.75,
      "deco_device": "Living Room",
      "deco_mac": "AA-BB-CC-DD-EE-00",
      "ui_device_name": "client-name"
    }
  }
}
```

Deco node trackers (`device_type: "deco"`) publish `device_model`, `hw_version`, `sw_version`,
`internet_online` (`true|false|null`), `master`, `bssid_band2_4`, `bssid_band5`, `signal_band2_4`,
`signal_band5` and, for satellites only, `deco_device` / `deco_mac`. Do not add `online_time`,
`traffic_usage`, `signal` or `wire_type` to Deco fixtures: the integration never publishes them.

## Omada minimum shapes

HACS `ha-omada` wireless client (falsy attributes such as `guest: false` are never published):

```json
{
  "entity_id": "device_tracker.client_name",
  "state": "home",
  "attributes": {
    "source_type": "router",
    "name": "Client",
    "hostname": "client",
    "ip": "10.0.0.10",
    "mac": "aa:bb:cc:dd:ee:ff",
    "wireless": true,
    "ssid": "Home",
    "ap_mac": "aa:bb:cc:dd:ee:00",
    "ap_name": "EAP670 Hall",
    "channel": 36,
    "radio": "5ghz",
    "wifi_mode": "11axa"
  }
}
```

Disconnected `ha-omada` clients carry only `name`, `mac`, `wireless`, `guest` and `last_seen` (epoch ms).

Core `tplink_omada` client (online):

```json
{
  "entity_id": "device_tracker.client_name",
  "state": "home",
  "attributes": {
    "source_type": "router",
    "tracking_type": "connection",
    "in_zones": [],
    "ip": "10.0.0.10",
    "mac": "aa:bb:cc:dd:ee:ff",
    "host_name": "client"
  }
}
```

Core trackers never publish `wireless`; while offline they also drop `ip` and `host_name`.

## Fixture quality rules
- Keep payloads minimal and deterministic.
- Prefer one scenario per fixture.
- Redact sensitive fields before sharing.
- Use diagnostics export from the card, then trim to scenario-specific data.

## Virtual lab source data
- Virtual integration mocks live in `virtual_modems/`.
- Their seed payloads are in `virtual_modems/data/`.
- For new adapter fixtures, prefer deriving minimal test cases from those seed payloads plus real diagnostics exports.
