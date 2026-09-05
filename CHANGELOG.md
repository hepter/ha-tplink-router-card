# Changelog

## 0.5.0-beta.1

### Added

- `apName` column: shows the access point / mesh node each client is attached to (#14).
  - `tplink_router`: EasyMesh `ap_name` (integration v2.33.0+); clients on the main router get a badge instead of the raw `*` marker.
  - `tplink_deco`: parent Deco of each client and of satellite nodes.
  - `omada`: `ap_name` of wireless clients.
  - Opt-in: never part of the default layout, add it to `column_layout` when needed.
- `omada` opt-in columns `channel`, `wifiMode` (WiFi 4/5/6/7 from `wifi_mode`) and `lastSeen` (for disconnected clients, formatted with the Home Assistant language).
- `header_action_groups` option: header actions are grouped (`wifi`, `guest`, `iot`, `reboot`, `scanning`, `controller`, `vpn`, `dhcp`, `wan`) and only the configured groups are rendered; the default hides `iot`, `vpn`, `dhcp` and `wan` because they can cut your own access. Each group is its own cluster in the header, also selectable in the card editor.
- `tplink_deco`: the integration's `Polling` switch is offered in the `scanning` group.
- `tplink_omada`: gateway `WAN connect` switches are offered in the hidden `wan` group.
- `omada` access point rows show their supported radios (`2.4G/5G/6G`) in the `band` column.
- `omada`: a notice when exactly 100 clients are received, because Omada Controller 6.x integrations return at most 100 clients per poll.
- `tplink_omada`: "Reconnect client" row action backed by the `tplink_omada.reconnect_client` service (hold to confirm).
- `tplink_router`: VPN server/client and LAN DHCP server switches are matched as header actions in the `vpn` and `dhcp` groups (hidden by default, hold to confirm).
- Port PoE and WAN connect switches require a hold wherever they appear.
- `tplink_router`: an empty-table hint when the entry exposes no `device_tracker` entities (integration option `support_tracker` disabled).
- `tplink_deco`: node rows expose the mesh role in `deviceType` (`Deco (Master)` / `Deco (Satellite)`).
- Connection, device type, device status and power-save labels are translated (English, Turkish).
- Release workflow verifies that the tag matches `package.json` and that `CHANGELOG.md` has a section for it.
- Virtual lab: `lab` profile serves the Omada controller and Deco X50 mocks on one port, all virtual devices carry the `02:56:4D` MAC prefix and `Virtual` / `vm-` names, `virtual_modems/tools/ha_virtual_cleanup.py` lists, enables, disables or deletes the matching Home Assistant config entries, and `start_lab.ps1` / `stop_lab.ps1` run the lab in the background on Windows. The mocks were realigned with `tplinkrouterc6u` 5.32.x (EasyMesh), `ha-tplink-deco` 3.10.x and `ha-omada` 0.10.x / `tplink-omada-api` 1.5.x.

### Fixed

- Mobile: a sticky (`fixed: start|end`) column could take about 70% of the screen. Sticky columns are now capped at 50% of the table width (container units with a viewport fallback), configured `max_width` values are clamped to the same limit, and overflowing content is ellipsized instead of scrolling inside the cell.
- Sorting by the `actions` column crashed the card (the action map was read before it was initialised); the sort now also counts service-backed actions.
- Clients whose tracker is associated with a custom Home Assistant zone (core 2026.6+) were shown as offline; any state other than `not_home` / `unavailable` / `unknown` now counts as online.
- `omada`: the client block switch (published without a name by `ha-omada`) was rendered as a plain toggle without hold-to-confirm; it is now detected as a block action when it sits on a tracked client device and carries the client name.
- `tplink_omada`: all clients were labelled `Wired`; core only tracks wireless clients, so they are now `WiFi`.
- `tplink_deco`: clients without a hostname showed the parent Deco name in the `hostname` column; the raw client name (`ui_device_name`) is used instead.
- `tplink_deco`: `internet_online: null` is shown as `Unknown` instead of an empty status.
- `omada`: numeric device `status` / `status_category` codes are mapped to labels (`Connected`, `Heartbeat Missed`, `Configuring`, ...).
- `ap_name` is no longer used as an Omada tracker heuristic, so EasyMesh clients cannot leak into an Omada table when the entity registry is unavailable.

### Changed

- `tplink_omada` (core) now has its own column profile: `apName`, `channel`, `wifiMode`, `lastSeen`, `snr`, `powerSave`, `downloaded`, `uploaded` are hidden by default because core never publishes them. Explicit `column_layout` keys are still honoured.
- The `*` main-node marker is only interpreted for `tplink_router`; Deco and Omada names are used verbatim.
- Contract fixtures were realigned with the attributes the integrations really publish (`tplink_deco`, `tplink_omada`).

### Known limitations

- `tplink_router` trackers restored after a Home Assistant restart may show stale attributes until the first poll; the card cannot detect this.
- Grouping rows by access point is not implemented yet; sort by the `apName` column instead.
