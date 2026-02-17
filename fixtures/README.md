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

## Structure
- `fixtures/tplink_router/`: payloads for `tplink_router` adapter contracts.
- `fixtures/tplink_deco/`: payloads for `tplink_deco` adapter contracts.
- `fixtures/omada/`: payloads for Omada adapter contracts.

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
        "signal": -45
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
      "down_kilobytes_per_s": 2.75
    }
  }
}
```

## Fixture quality rules
- Keep payloads minimal and deterministic.
- Prefer one scenario per fixture.
- Redact sensitive fields before sharing.
- Use diagnostics export from the card, then trim to scenario-specific data.

## Virtual lab source data
- Virtual integration mocks live in `virtual_modems/`.
- Their seed payloads are in `virtual_modems/data/`.
- For new adapter fixtures, prefer deriving minimal test cases from those seed payloads plus real diagnostics exports.
