# HA TP-Link Router Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![GitHub Release](https://img.shields.io/github/release/hepter/ha-tplink-router-card.svg)](https://github.com/hepter/ha-tplink-router-card/releases)
[![License](https://img.shields.io/github/license/hepter/ha-tplink-router-card.svg)](https://github.com/hepter/ha-tplink-router-card/blob/main/LICENSE)

A Lovelace card for Home Assistant focused on TP-Link client monitoring and quick router controls.

![TP-Link Router example](docs/images/tplink_router_card.png)

⭐ Found it useful? Please star the repo to support development and help others discover it.

## ✨ Features

**📊 Rich Data Visualization**
- **Live Client Table:** Real-time mapping directly from router `device_tracker` entities.
- **Smart Formatting:** Human-readable formatting for traffic, link rates, duration, and signal quality.
- **Colorized Metrics:** Optional color scales for TX/RX and Up/Down speeds for quick visual scanning.
- **Advanced Tooltips:** Hover over Up/Down speeds for a detailed utilization bar, bandwidth load percentage, adaptive transfer units, and current/max Mbps.

**🎛️ Interactive Controls & Actions**
- **Router Dashboard:** Header featuring local URL, public IP, CPU/MEM summary, and quick actions.
- **Customizable Actions:** Row-level and header-level actions with flexible rendering modes (`icon`, `name`, `icon_name`).
- **Hold-to-Confirm:** 1-second hold requirement for destructive actions to prevent accidental clicks.
- **Visual State Feedback:** Explicit state coloring for toggle actions.
- **Haptic Feedback:** Built-in vibration feedback on supported mobile/webview environments during interactions.

**🖱️ Advanced Navigation & Shortcuts**
- **Shift + Click Entity Access:** Hold `Shift` and click on metric cells (like speed, traffic, signal) to instantly open the underlying Home Assistant entity's more-info dialog.
- **Name-Cell Navigation:** Click a device name to open its entity more-info (`tplink_router` / `tplink_deco`) or device page (`omada`).
- **Inline Shortcuts:** Quick device shortcut icons directly in the Name column.

**🎨 Flexible & Responsive Layout**
- **Powerful `column_layout`:** Define exact column order, custom headers, and per-column `max_width` (`px`, `%`, `vw`, `clamp()`, etc.).
- **Sticky Columns:** Pin columns to the start or end of the table with elegant edge shadow indicators during horizontal scroll.
- **Responsive Design:** Header and action layouts adapt perfectly across desktop, tablet, and mobile screens.
- **Headless Modes:** Hide the header or filter sections for a compact, table-only dashboard view.

**🔍 Search, Filter & Sort**
- **Fast Search:** Real-time search across name, IP, hostname, and MAC address.
- **Regex Support:** Use `/pattern/` syntax in the search box for advanced filtering.
- **Quick Filters:** Compact dropdowns for Band (2.4G/5G/6G), Connection (WiFi/Wired/IoT/Guest), and Status.
- **Multi-Sort:** `Shift + click` on column headers to sort by multiple columns simultaneously.

**🌍 Global & Developer Features**
- **i18n Support:** Automatic Home Assistant locale selection (English, Turkish, etc.).
- **Diagnostics Export:** Built-in, redacted JSON export for easy bug reporting and troubleshooting.

## Screenshots
`tplink_router`:

![tplink_router](docs/images/tplink_router_card.png)

`tplink_deco`:

![tplink_deco](docs/images/tplink_deco_card.png)

`omada` / `tplink_omada`:

![omada](docs/images/tplink_omada_card.png)

Header variants (`hide_header` / `hide_filter_section` options):

Headless layout: the filter row stays visible while the header is hidden.

![headless](docs/images/tplink_router_card-headless.png)

Headless + no filter layout: both header and filter row are hidden for a compact table-only card.

![headless + no filter](docs/images/tplink_router_card-headless+nofilter.png)

## Compatibility
- Supported integrations:
  - [`home-assistant-tplink-router`](https://github.com/AlexandrErohin/home-assistant-tplink-router) (`tplink_router`)
  - [`ha-tplink-deco`](https://github.com/amosyuen/ha-tplink-deco) (`tplink_deco`)
  - [`ha-omada`](https://github.com/zachcheatham/ha-omada) (`omada`)
  - Home Assistant Core `tplink_omada` (`tplink_omada`)

Support level summary:
- `tplink_router`: full support
- `tplink_deco`: high support
- `omada`: high support
- `tplink_omada`: high support

Detailed matrix: `docs/integration-support.md`

- `tplink_router`:
  - Full client table mapping from router tracker attributes.

- `tplink_deco`:
  - Client/deco table mapping from `device_tracker.*` entities.
  - Supports `connection_type` and `interface` mapping.
  - Upload/download speed values are normalized automatically.

- Omada (`omada` / `tplink_omada`):
  - Device-based row mapping with controller client data.
  - Per-row actions (`actions` column) from matched `switch.*` / `button.*` entities.
  - Header action target selector for infrastructure devices.
  - Metric/entity bridge for Omada-only fields with Shift+click cell info.
  - Extra Omada columns:
    - `downloaded`, `uploaded`, `snr`, `powerSave`
    - `deviceType`, `deviceModel`, `deviceFirmware`, `deviceStatus`

Notes:
- Available actions and sensors depend on model, firmware, and integration-exposed entities.
- If an action cannot be matched safely, it is hidden by design.
- Integration-specific attributes are parsed with safe fallbacks. Missing fields never crash the card and are rendered as `—`.

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

Generic example:
```yaml
type: custom:tplink-router-card
title: My Router
entry_id: <config_entry_id>
speed_unit: MBps
txrx_color: true
updown_color: true
show_hidden_entities: false
header_action_render: icon
row_action_render: icon
shift_click_underline: true
hide_header: false
hide_filter_section: false
default_filters:
  band: all
  connection: all
  status: all
upload_speed_color_max: 1000
download_speed_color_max: 100
column_layout:
  - key: name
    fixed: start
    max_width: 140px
  - key: status
  - key: connection
  - key: band
  - key: ip
  - key: mac
  - key: hostname
  - key: down
  - key: up
```

Cross-integration safe baseline `column_layout`:
```yaml
column_layout:
  - key: name
  - key: status
  - key: connection
  - key: band
  - key: ip
  - key: mac
  - key: hostname
  - key: down
  - key: up
```

Integration-specific extra keys:
```yaml
# tplink_router
- packetsSent
- packetsReceived
- tx
- rx
- online
- traffic
- signal

# omada / tplink_omada
- downloaded
- uploaded
- snr
- powerSave
- actions

# tplink_deco / omada / tplink_omada metadata
- deviceType
- deviceModel
- deviceFirmware
- deviceStatus
```

### Recommended column presets by integration

For YAML users, define the full order with `column_layout`.

`tplink_router` (recommended)
```yaml
type: custom:tplink-router-card
entry_id: <tplink_router_entry_id>
column_layout:
  - key: name
    fixed: start
  - key: status
  - key: connection
  - key: band
  - key: ip
  - key: mac
  - key: hostname
  - key: packetsSent
  - key: packetsReceived
  - key: down
  - key: up
  - key: tx
  - key: rx
  - key: online
  - key: traffic
  - key: signal
```

`tplink_deco` (recommended)
```yaml
type: custom:tplink-router-card
entry_id: <tplink_deco_entry_id>
column_layout:
  - key: name
    fixed: start
  - key: status
  - key: connection
  - key: band
  - key: ip
  - key: mac
  - key: hostname
  - key: down
  - key: up
  - key: deviceType
  - key: deviceModel
  - key: deviceFirmware
  - key: deviceStatus
```

`omada` / `tplink_omada` (recommended)
```yaml
type: custom:tplink-router-card
entry_id: <omada_entry_id>
column_layout:
  - key: name
    fixed: start
  - key: status
  - key: connection
  - key: band
  - key: ip
  - key: mac
  - key: hostname
  - key: down
  - key: up
  - key: online
  - key: downloaded
  - key: uploaded
  - key: traffic
  - key: signal
  - key: snr
  - key: powerSave
  - key: deviceType
  - key: deviceModel
  - key: deviceFirmware
  - key: deviceStatus
  - key: actions
```

Options:
- `title`: Card title.
- `entry_id`: Config entry to use. Selected from editor.
- `speed_unit`: `MBps` (default) or `Mbps` for Up/Down columns.
- `txrx_color`: Enable colorized TX/RX speed levels.
- `updown_color`: Enable colorized upload/download speeds.
- `show_hidden_entities`: Show hidden switch/button entities in action areas. Default `false`.
- `header_action_render`: Header action button style: `icon | name | icon_name`. Default `icon`. Works across all supported integrations when header actions exist.
- `row_action_render`: Row action button style: `icon | name | icon_name`. Default `icon`. Currently effective for Omada row actions (`omada` / `tplink_omada`).
- `shift_click_underline`: Show Shift+click underline hints for entity-clickable cells (currently Omada-only visual behavior).
- `hide_header`: Hide the header area.
- `hide_filter_section`: Hide the filter section.
- `default_filters`: Optional fixed default filters applied on every page load.
  - `band`: `all | 2g | 5g | 6g`
  - `connection`: `all | wifi | wired | iot | guest`
  - `status`: `all | online | offline`
- `upload_speed_color_max`: Upload color scale max in Mbps. Default `1000`.
- `download_speed_color_max`: Download color scale max in Mbps. Default `100`.
- `column_layout`: Primary column definition with order, sticky columns, and optional header override:
  - `key` (required): Column key.
  - `fixed` (optional): `start | end` (default is none, or omit the field).
  - `name` (optional): Header label override.
  - `max_width` (optional): CSS `max-width` value for that column.
    - Number-only values are treated as px (`100` => `100px`).
    - You can use values like `100px`, `35%`, `22vw`, `10vh`, `18rem`, `clamp(180px, 30vw, 420px)`.
  - Example:
    ```yaml
    column_layout:
      - key: name
        fixed: start
        max_width: 160px
      - key: status
      - key: ip
      - key: actions
    ```
  - Header override example:
    ```yaml
    column_layout:
      - key: down
        name: Download
      - key: up
        name: Upload
    ```
- `columns` (deprecated): legacy string-array format, kept only for backward compatibility.

Rules:
- Column order follows `column_layout` order.
- Only columns valid for the selected integration domain are rendered.
- Sticky behavior is applied only to columns marked with `fixed: start|end`.
- Sticky columns use edge shadow indicators during horizontal scroll.
- Non-sticky columns are never width-limited by sticky column rules.
- `column_layout.max_width` is injected directly as each column's `max-width` style.
- Legacy `columns` is still accepted and auto-migrated internally to `column_layout`.
- If `default_filters` is set, it overrides localStorage filter restore on every reload.
- `hide_filter_section` works well with `default_filters` for fixed filtered dashboards.

### Action styling and curation

`header_action_render` applies to header actions for all supported integrations.

`row_action_render` applies to row-level actions, currently available for `omada` / `tplink_omada`.

- Display mode:
  - `header_action_render: icon | name | icon_name`
  - `row_action_render: icon | name | icon_name`
- Label source:
  - In `name` / `icon_name` modes, labels come from entity display names.
  - If you want cleaner labels, rename entities in Home Assistant.
  - Quick path: **Shift + click** an action button to open entity more-info, then edit the display name.
- Hide unwanted actions:
  - Open the target action entity in Home Assistant and set it as hidden (`Visible` off).
  - Keep `show_hidden_entities: false` (default) to exclude hidden actions from the card.
  - Set `show_hidden_entities: true` only if you explicitly want hidden actions to appear.
  - This affects header actions generally, and row actions where row actions are supported.

Editor preview:

![Card editor](docs/images/tplink_card_config.png)

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

## Virtual Modem Lab
For local end-to-end testing with real integration setup flows, a virtual device lab is included:

- `virtual_modems/tplink_router_be230` (for `tplink_router`)
- `virtual_modems/tplink_deco_x50` (for `tplink_deco`)
- `virtual_modems/omada_controller` (shared by `omada` and `tplink_omada`)

See `virtual_modems/README.md` for setup and run commands.

## Troubleshooting
- Missing entries: ensure the integration is installed and the selected `entry_id` is correct.
- Empty table with a valid `entry_id`: check quick filters (`All / 2G / 5G / 6G`, `All / WiFi / Wired / IoT / Guest`, `All / Online / Offline`).
- Missing metadata/tooltips: some routers/integrations do not expose full router details.
- No action icons: action entities may be unsupported, unavailable, or intentionally filtered for safety.

## Contributing
See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License
MIT. See [`LICENSE`](LICENSE).
