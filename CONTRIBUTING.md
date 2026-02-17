# Contributing

Thanks for helping improve the TP-Link Router Lovelace card.

## Local setup
1. Install dependencies:
   - `npm install`
2. Build once:
   - `npm run build`

## Development
- Build on changes (watch): `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Format code: `npm run format`
- Run tests: `npm run test`
- Full local check: `npm run check`

## Virtual integration lab
- Virtual modem/controller profiles are under `virtual_modems/`.
- Use these to validate real integration onboarding flows locally:
  - `python -m virtual_modems.run tplink_router_be230`
  - `python -m virtual_modems.run tplink_deco_x50`
  - `python -m virtual_modems.run omada_controller` (shared for `omada` and `tplink_omada`)
- Full details: `virtual_modems/README.md`.

## Fixture contract tests
- Contract fixtures live under `fixtures/<integration>/`.
- Current integration fixture folders:
  - `fixtures/tplink_router/`
  - `fixtures/tplink_deco/`
  - `fixtures/omada/`
- Use behavior-focused fixture names.
  - Example: `entry_scoped_tracker_selection.json`, `router_device_preference.json`, `client_activity_mapping.json`
- Contract tests live in `src/*-adapter.contract.test.ts`.
- Fixture export can be generated from card UI diagnostics export (double-click card title to toggle download icon), then trimmed into minimal reproducible fixtures.

## Release / HACS
- The build output must be a single file in `dist/ha-tplink-router-card.js`.
- Update `README.md` if config or UX changes.

## Manual HA deploy (local)
1. Copy build output:
   - `scp dist/ha-tplink-router-card.js home-assistant:/config/www/ha-tplink-router-card/`
2. Add/refresh the resource in Home Assistant:
   - `/local/ha-tplink-router-card/ha-tplink-router-card.js`
