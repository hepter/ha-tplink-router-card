# HA TP-Link Router Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![GitHub Release](https://img.shields.io/github/release/hepter/ha-tplink-router-card.svg)](https://github.com/hepter/ha-tplink-router-card/releases)
[![License](https://img.shields.io/github/license/hepter/ha-tplink-router-card.svg)](https://github.com/hepter/ha-tplink-router-card/blob/main/LICENSE)

A Lovelace card for Home Assistant focused on TP-Link client monitoring and quick router controls.

![Card preview](card.png)

⭐ Found it useful? Please star the repo to support development and help others discover it.

## Highlights
- Live client table from router `device_tracker` entities.
- Fast search (name, IP, hostname, MAC) and compact quick filters.
- Multi-sort (Shift + click), with empty values always kept at the bottom.
- Strong formatting for traffic, link rates, duration, and signal quality.
- Router header with local URL, public IP, CPU/MEM summary, and quick actions.
- Hold-to-confirm safety for destructive actions (1 second).
- Built-in diagnostics export (redacted only).
- i18n support with automatic Home Assistant locale selection.
- Optional colorization for TX/RX and Up/Down speeds.
- Up/Down hover tooltip with utilization bar, Bandwidth Load, adaptive transfer unit, and current/max Mbps.

## Compatibility
- Primary integration: [`home-assistant-tplink-router`](https://github.com/AlexandrErohin/home-assistant-tplink-router)
- Router model support follows the upstream integration support list.
- In practice this typically includes TP-Link families such as Archer, Deco, TL-MR/TL-WA and supported Mercusys models from the upstream project.
- Partial Omada action support is available when matching entities exist:
  - Reconnect
  - Start WLAN Optimization

Notes:
- Available actions and sensors depend on model, firmware, and integration-exposed entities.
- If an action cannot be matched safely, it is hidden by design.

## Installation

### 1. Add directly to HACS (recommended)

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=hepter&repository=ha-tplink-router-card&category=plugin)

### 2. HACS (manual path)
1. Open HACS.
2. Add this repository as a **Dashboard** custom repository.
3. Install **HA TP-Link Router Card**.
4. Verify resource exists:
   - `/hacsfiles/ha-tplink-router-card/ha-tplink-router-card.js`
   - Type: `JavaScript Module`

### 3. Manual
Download the latest release asset and place it under:
- `/config/www/ha-tplink-router-card/ha-tplink-router-card.js`

CLI example:
```bash
mkdir -p /config/www/ha-tplink-router-card
wget -O /config/www/ha-tplink-router-card/ha-tplink-router-card.js \
  https://github.com/hepter/ha-tplink-router-card/releases/latest/download/ha-tplink-router-card.js
```

Add resource (YAML):
```yaml
resources:
  - url: /local/ha-tplink-router-card/ha-tplink-router-card.js?v=1
    type: module
```

UI path:
- Settings → Dashboards → Resources → Add Resource

## Configuration
Minimal:
```yaml
type: custom:tplink-router-card
```

Example:
```yaml
type: custom:tplink-router-card
title: My Router
entry_id: <config_entry_id>
speed_unit: MBps
txrx_color: true
updown_color: true
upload_speed_color_max: 1000
download_speed_color_max: 100
columns:
  - status
  - connection
  - band
  - ip
  - mac
  - hostname
  - packetsSent
  - packetsReceived
  - down
  - up
  - tx
  - rx
  - online
  - traffic
  - signal
```

Options:
- `title`: Card title.
- `entry_id`: Config entry to use. Selected from editor.
- `speed_unit`: `MBps` (default) or `Mbps` for Up/Down columns.
- `txrx_color`: Enable colorized TX/RX speed levels.
- `updown_color`: Enable colorized upload/download speeds.
- `upload_speed_color_max`: Upload color scale max in Mbps. Default `1000`.
- `download_speed_color_max`: Download color scale max in Mbps. Default `100`.
- `columns`: Optional column set and order.

Rules:
- `name` is always visible and cannot be removed.
- Column order follows `columns` order.

Speed data model:
- `up_speed` / `down_speed` from `tplink_router` are treated as transfer rates in `bytes/s`.
- `speed_unit` selects how Up/Down values are displayed (`MB/s` or `Mbps`).
- `tx_rate` / `rx_rate` are mapped as link-rate fields with separate formatting logic.

Tooltip semantics (Up/Down):
- `Bandwidth Load`: current speed as percentage of the configured color scale max.
- `Transfer`: adaptive transfer value (`B/s`, `KB/s`, `MB/s`, `GB/s`).
- `Mbps`: current Mbps and scale max shown as `current/max`.

Editor preview:

![Card editor](card-config.png)

## Diagnostics Export
When reporting a bug, attach a diagnostics dump:
1. Open the card.
2. Double-click the card title.
3. Click the download icon.
4. Attach the JSON file to your issue.

Export behavior:
- Output is redacted only.
- Sensitive values are masked (IP/MAC/URL/token-like values and sensitive keys).
- Includes card UI state (search text, filters, sorts) to reproduce behavior.
- Includes size/depth protection and truncation markers for very large payloads.
- For your security, review the file before attaching it to a public issue.

## Troubleshooting
- Missing entries: ensure the integration is installed and the selected `entry_id` is correct.
- Missing metadata/tooltips: some routers/integrations do not expose full router details.
- No action icons: action entities may be unsupported, unavailable, or intentionally filtered for safety.

## Contributing
See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License
MIT. See [`LICENSE`](LICENSE).
