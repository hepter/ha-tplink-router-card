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

## Fixture contract tests
- Contract fixtures live under `fixtures/<integration>/`.
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
