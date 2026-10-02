# Integration Support Matrix

## Integrations

- `tplink_router` (`home-assistant-tplink-router`)
- `tplink_deco` (`ha-tplink-deco`)
- `omada` (`ha-omada`, HACS)
- `omada_open_api` (`ha-omada-open-api`, HACS)
- `tplink_omada` (Home Assistant Core)

Last upstream sync: 2026-09-18 (`tplink_router` v2.38.0, `ha-tplink-deco` v3.10.1, `ha-omada` 0.10.0, `ha-omada-open-api` 1.10.1, core `tplink_omada` with `tplink-omada-api` 1.5.9).

## Current card support

### tplink_router
- Support level: **Full**
- Adapter: `src/adapters/tplink.ts`
- Action matching: reboot, Wi-Fi/Guest/IoT toggles, data fetching, VPN server/client switches, LAN DHCP server switch (integration dependent)
- Coverage focus: client metrics, link rates, online duration, traffic, signal, EasyMesh node (`ap_name`)
- Notes:
  - `ap_name` is published since integration v2.33.0; clients on the main node carry a `*` prefix that the card converts into a badge.
  - Integration option `support_tracker=false` (v2.36.0+) removes all trackers; the table is empty by design.
  - Trackers are `RestoreEntity` since v2.28.1: after a Home Assistant restart the first render may show restored attributes until the next poll.

### tplink_deco
- Support level: **High**
- Adapter: `src/adapters/tplink.ts` (deco-aware mapping/fallback)
- Action matching: only if matching `switch.*`/`button.*` entities are present
- Coverage focus: tracker fields, `connection_type`/`interface`, KB/s fallbacks, parent Deco (`deco_device`), raw client name (`ui_device_name`), mesh role (`master`)
- Notes:
  - Upstream still does not expose packet counters, TX/RX link rates, online duration, traffic usage, or generic RSSI per client.
  - Node trackers may publish `connection_type` as a list; the card joins it before mapping.
  - `internet_online` can be `null` (node not reachable); shown as `Unknown`.
  - Backhaul, CPU and memory sensors exist upstream but are disabled by default and are not joined into rows.

### omada (HACS `ha-omada`)
- Support level: **High**
- Adapter: `src/adapters/omada.ts`
- Action matching:
  - Header-level infrastructure actions (for selected target device)
  - Row-level `actions` column for per-device controls; the unnamed client block switch is detected through its device and always requires a hold
- Coverage focus:
  - device-based rows
  - controller client aggregation
  - Omada metrics and metadata columns, `ap_name`, `channel`, `wifi_mode`, `last_seen`
  - opt-in detail columns: `ssid`, `connectedTo` (`ap_name` / `switch_name`), device `cpu` / `memory` sensors; a pending `update` entity adds a badge to `deviceFirmware`
  - device `status` / `status_category` codes mapped to labels; access point rows list supported radios in `band`
- Notes:
  - Per-client TX/RX link-rate values are shown only when explicit link-rate entities are exposed by the integration (the current integration does not publish them).
  - Falsy attributes (`wireless: false`, `guest: false`, `status: 0`) are not published by the integration; the card treats their absence as `false`/disconnected.
  - Omada Controller 6.x: the integration fetches at most 100 clients per poll and the Reconnect button is broken until upstream PR #164 is merged.

### omada_open_api (HACS `ha-omada-open-api`)
- Support level: **High**
- Adapter: `src/adapters/omada.ts` (shared with `omada`; attribute aliases `connected_ap`, `connected_switch`, `connection_type`, `device_type`, `detail_status`)
- Action matching:
  - Row-level `actions` column: the client `Network access` switch is the block action (`src/utils/action-role.ts`, inverted polarity: the switch is on while the client is allowed, the card flips it so "on" means blocked like the other Omada integrations), plus the client `Reconnect` button.
  - Header actions: AP radio switches (`2.4 GHz radio`, `5 GHz radio`, `6 GHz radio`) in `wifi`; per-AP SSID switches by SSID name (`wifi` / `guest` / `iot`); device `Reboot` buttons; site `WLAN optimization` button in `controller`. LED, locate, PoE and SSID broadcast switches stay row-level or hidden.
- Coverage focus:
  - client rows from the tracker (`ssid`, `connected_ap`, `connected_switch`, `connection_type`, `ip`, `mac`, `host_name`) joined with the per-client sensors on the same device: `Downloaded`/`Uploaded` (MB), `RX activity`/`TX activity` (MB/s), `RSSI`, `SNR`, `Uptime` (timestamp) and the `Power save` binary sensor
  - infrastructure rows from the device trackers of access points, switches and gateways (`device_type`, `model`, `firmware_version`, `detail_status`)
  - `signalStrength` (default column): the `Signal strength` percentage sensor, the controller's normalised signal quality (`signalLevel`), rendered as a coloured bar; `signal` keeps the RSSI in dBm
  - opt-in detail columns: `ssid`, `connectedTo` (`connected_ap`, `connected_switch` or the `Connected to` sensor for gateway-attached clients), `vendor` (device registry manufacturer), `clients` (`Connected clients` sensor), `cpu` / `memory` (`CPU utilization` / `Memory utilization`), `uplink` (`Uplink device` / `Uplink port`); the `update` entity adds a pending-firmware badge to `deviceFirmware`
- Notes:
  - Every entity uses `has_entity_name` with the client name as entity name, so Home Assistant renders trackers as `<name> <name>`; the card collapses that to the device name.
  - `Signal strength` is a percentage sensor and is ignored; `RSSI` feeds the `signal` column.
  - The site pseudo device (model `Omada Site`) carries only site-wide entities and is never rendered as a row.
  - The integration creates client entities only for the clients selected in its config flow (first 200 clients are offered).
  - `channel`, `wifi_mode`, `last_seen`, packet counters, negotiated link rates and VLAN are parsed by the integration but not exposed as attributes or entities, so the corresponding columns (`channel`, `wifiMode`, `lastSeen`, `packetsSent`, `packetsReceived`, `tx`, `rx`) are not offered.

### tplink_omada (Home Assistant Core)
- Support level: **Basic**
- Adapter: `src/adapters/omada.ts` with `assumeWirelessClients`
- Action matching:
  - Row-level "Reconnect client" action backed by the `tplink_omada.reconnect_client` service (hold to confirm)
  - Header actions: none (core has no button platform; port PoE / WAN switches are not client actions)
- Coverage focus:
  - client rows from core scanner entities: name, `host_name`, `ip`, `mac`, status (all clients are wireless)
  - device rows from the device registry: `deviceType`, `deviceModel`, `deviceFirmware`, `deviceStatus`
- Notes:
  - Core publishes no `ap_name`, RSSI, link rate, traffic or power-save attributes and its `ScannerEntity.state_attributes` is final upstream, so these columns stay hidden by default.
  - `ip` and `host_name` disappear while a client is disconnected.
  - Core allows several config entries for the same controller (one per site); pick the site entry in the card editor.

## Column strategy

- Base columns are integration-agnostic and safe (`name`, `status`, `connection`, `band`, `apName`, `ip`, `mac`, `hostname`, packet/rate/speed/online/traffic/signal).
- `apName`, `channel`, `wifiMode`, `lastSeen`, `ssid`, `connectedTo`, `vendor`, `clients`, `cpu`, `memory`, `uplink` are opt-in (`OPT_IN_COLUMN_KEYS`): allowed for their domains, never in the default layout. `signalStrength` is allowed for `omada_open_api` only and is part of its default layout.
- Per-band client counters (`Clients 5 GHz`, `Wired clients`, ...) and radio utilisation percentages are ignored; only the total client count and the CPU / memory percentages feed the `clients`, `cpu`, `memory` columns.
- Header actions are grouped (`src/utils/action-matcher.ts` `HeaderActionGroup`); `header_action_groups` selects the rendered groups, default `wifi, guest, reboot, scanning, controller`. An empty list keeps the defaults, `none` hides every group, `all` shows every group.
- Rows come from device groups; a group without a device and without a tracker (site-level switches and buttons) is never a row.
- Missing fields are rendered as `—`.
- Sorting: `ip` orders IPv4 by octet value and IPv6 after IPv4 (`src/utils/ip-sort.ts`); `—` cells (offline rows, wired rows for the radio columns, `0.0.0.0`) sort as empty and stay at the end in both directions.
- Adapters emit stable English labels for connection, device type, device status and power save; the card translates the known ones (`src/i18n/index.ts` `localizeLabel`).
- Integration metadata columns (`deviceType`, `deviceModel`, `deviceFirmware`, `deviceStatus`) are enabled for Omada domains and Deco domain.
- `tplink_omada` uses its own profile without `apName` and without the HACS-only metric columns.
- `omada_open_api` uses its own profile: `apName`, `snr`, `powerSave`, `downloaded`, `uploaded`, `actions` and the metadata columns, without `channel`, `wifiMode`, `lastSeen`, `packetsSent`, `packetsReceived`, `tx`, `rx`.
- `isOmadaIntegrationDomain` (`src/adapters/integration-profile.ts`) is the single place that decides which config entry domains use the Omada adapter.
- Online detection: any tracker state other than `not_home`, `unavailable`, `unknown` (or empty) counts as online, so zone-associated scanner trackers (core 2026.6+) are handled.

## Virtual integration lab

See `virtual_modems/README.md` for mock controller/router profiles used in local end-to-end tests.
- Omada tests use a single controller profile: `omada_controller` (for `omada`, `tplink_omada` and `omada_open_api`; the Open API routes share the same seed and state).
