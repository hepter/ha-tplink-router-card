# Integration Support Matrix

## Integrations

- `tplink_router` (`home-assistant-tplink-router`)
- `tplink_deco` (`ha-tplink-deco`)
- `omada` (`ha-omada`)
- `tplink_omada` (Home Assistant Core)

## Current card support

### tplink_router
- Support level: **Full**
- Adapter: `src/adapters/tplink.ts`
- Action matching: reboot, Wi-Fi/Guest/IoT toggles, data fetching (integration dependent)
- Coverage focus: client metrics, link rates, online duration, traffic, signal

### tplink_deco
- Support level: **High**
- Adapter: `src/adapters/tplink.ts` (deco-aware mapping/fallback)
- Action matching: only if matching `switch.*`/`button.*` entities are present
- Coverage focus: tracker fields, `connection_type`/`interface`, KB/s fallbacks
- Notes: current upstream integration does not expose packet counters, TX/RX link rates, online duration, traffic usage, or generic RSSI per client.

### omada / tplink_omada
- Support level: **Partial**
- Adapter: `src/adapters/omada.ts`
- Action matching: reconnect + WLAN optimization (if entities are exposed)
- Coverage focus: client list + client activity sensors where available
- Notes: upstream Omada trackers generally do not expose per-client TX/RX link-rate attributes. The card maps TX/RX only when explicit link-rate attributes exist.

## Column strategy

- Base columns are integration-agnostic and safe (`name`, `status`, `connection`, `band`, `ip`, `mac`, `hostname`, packet/rate/speed/online/traffic/signal).
- Missing fields are rendered as `—`.
- Integration metadata columns (`deviceType`, `deviceModel`, `deviceFirmware`, `deviceStatus`) are enabled for Omada domains and Deco domain.

## Virtual integration lab

See `virtual_modems/README.md` for mock controller/router profiles used in local end-to-end tests.
- Omada tests use a single controller profile: `omada_controller` (for both `omada` and `tplink_omada`).
