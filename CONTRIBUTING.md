# Contributing

Thanks for helping improve the TP-Link Router Lovelace card.

## Local setup
1. Install dependencies:
   - `npm install`
2. Build once:
   - `npm run build`

## Development
- Build on changes (watch): `npm run dev`
- Format code: `npm run format`
- Run tests: `npm run test`

## Release / HACS
- The build output must be a single file in `dist/ha-tplink-router-card.js`.
- Update `README.md` if config or UX changes.

## Manual HA deploy (local)
1. Copy build output:
   - `scp dist/ha-tplink-router-card.js home-assistant:/config/www/ha-tplink-router-card/`
2. Add/refresh the resource in Home Assistant:
   - `/local/ha-tplink-router-card/ha-tplink-router-card.js`
