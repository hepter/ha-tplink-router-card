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
  - `python -m virtual_modems.run omada_controller` (shared for `omada`, `tplink_omada` and `omada_open_api`; the Omada Open API is served on the same port)
  - `python -m virtual_modems.run lab` (Omada controller and Deco X50 on one port)
- Full details: `virtual_modems/README.md`.

## Fixture contract tests
- Contract fixtures live under `fixtures/<integration>/`.
- Current integration fixture folders:
  - `fixtures/tplink_router/`
  - `fixtures/tplink_deco/`
  - `fixtures/omada/` (`omada`, `tplink_omada`, `omada_open_api`)
- Use behavior-focused fixture names.
  - Example: `entry_scoped_tracker_selection.json`, `router_device_preference.json`, `client_activity_mapping.json`
- Contract tests live in `src/adapters/*.contract.test.ts`; unit tests sit next to their module (`src/utils/*.test.ts`).
- Fixture export can be generated from card UI diagnostics export (double-click card title to toggle download icon), then trimmed into minimal reproducible fixtures.

## Release / HACS
- The build output must be a single file in `dist/ha-tplink-router-card.js`.
- Update `README.md` if config or UX changes.
- A release starts from a GitHub release: set `package.json` to the version, add a `## x.y.z` section to `CHANGELOG.md`, then publish a release with the tag `vx.y.z`. The release workflow checks that tag, `package.json` and the `CHANGELOG.md` heading match, builds the bundle with the tag as version and attaches it to the release.
- Pre-releases use tags like `vx.y.z-beta.n`; `package.json` may carry the full or the base version, the `CHANGELOG.md` heading stays `## x.y.z`, and the release is marked as pre-release (HACS shows it with "Show beta versions").

## Manual HA deploy (local)
1. Build with a version stamp so the browser console shows which build is loaded:
   - `VITE_CARD_VERSION=$(date -u +%Y%m%d-%H%M%S) npm run build`
2. Copy build output:
   - `scp dist/ha-tplink-router-card.js home-assistant:/config/www/ha-tplink-router-card/`
3. Add/refresh the resource in Home Assistant:
   - `/local/ha-tplink-router-card/ha-tplink-router-card.js`
4. HACS installs load `/config/www/community/ha-tplink-router-card/ha-tplink-router-card.js`; copy the build there too and regenerate `ha-tplink-router-card.js.gz` next to it.
