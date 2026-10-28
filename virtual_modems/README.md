# Virtual Modems

Minimal local test profiles for real Home Assistant integration setup flows.

## Profiles

- `tplink_router_be230` for `tplink_router` (follows `home-assistant-tplink-router` v2.44.x with `tplinkrouterc6u` 5.37.x)
- `tplink_deco_x50` for `tplink_deco`
- `omada_controller` for `omada`, `tplink_omada` and `omada_open_api` (the legacy web API and the Omada Open API are served by the same app and share one state)
- `lab` = `omada_controller` + `tplink_deco_x50` on one port (their HTTP paths do not overlap; the router and Deco mocks both use `/cgi-bin/luci`, so `tplink_router_be230` cannot join and runs on its own port instead)

One runner per port: the runner keeps a lock file per port (`active_modem_<port>.json`) under the temp directory and refuses to start a second runner on a port that is already in use. Different profiles, for example `lab` on `80` and `tplink_router_be230` on `8081`, run side by side.

## Virtual device markers

Every virtual device is recognisable, so Home Assistant test data can be found and removed in bulk:

- MAC prefix `02:56:4D` (locally administered); the 4th octet identifies the profile: `01` BE230, `02` Deco, `03` Omada.
- Device / node / controller names start with `Virtual`, client names and hostnames start with `vm-`.
- Firmware strings end with `(virtual)`.

`virtual_modems/tools/ha_virtual_cleanup.py` uses these markers plus the lab host to list, enable, disable or delete the matching config entries (entities and devices are removed with their entry):

```bash
export HA_URL=https://your-ha HA_TOKEN=<long-lived token>
python -m virtual_modems.tools.ha_virtual_cleanup list
python -m virtual_modems.tools.ha_virtual_cleanup devices
python -m virtual_modems.tools.ha_virtual_cleanup disable
python -m virtual_modems.tools.ha_virtual_cleanup enable
python -m virtual_modems.tools.ha_virtual_cleanup prune --apply   # remove stale entities/devices after a seed change
python -m virtual_modems.tools.ha_virtual_cleanup delete --apply
```

Keep SSID names stable across seed changes: `ha-omada` config entries filter tracked wireless clients by SSID name (`ssid_filter`), so renaming a virtual SSID silently drops every wireless client tracker.

## Setup

```bash
cd virtual_modems
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m virtual_modems.run tplink_router_be230
python -m virtual_modems.run tplink_deco_x50
python -m virtual_modems.run omada_controller
python -m virtual_modems.run lab
python -m virtual_modems.run tplink_router_be230 --port 8081   # next to the lab on port 80
```

Default port is `80` (integrations expect the default HTTP port unless the configured host includes one); `--host` and `--port` override it.

Background start/stop scripts use `virtual_modems/.venv` when present and keep logs (`<profile>-<port>.log`) next to the runner lock files. The stop scripts stop the runner on the given port, or every runner when no port is given.

Windows (`%TEMP%\virtual_modems`):

```powershell
powershell -ExecutionPolicy Bypass -File virtual_modems\start_lab.ps1            # lab on port 80
powershell -ExecutionPolicy Bypass -File virtual_modems\start_lab.ps1 -Profile tplink_router_be230 -Port 8081
powershell -ExecutionPolicy Bypass -File virtual_modems\stop_lab.ps1 -Port 8081  # only the BE230 runner
powershell -ExecutionPolicy Bypass -File virtual_modems\stop_lab.ps1             # every runner
```

Linux / macOS (`$TMPDIR` or `/tmp/virtual_modems`; port 80 re-runs the script with `sudo`, pass a port >= 1024 to avoid it):

```bash
chmod +x virtual_modems/start_lab.sh virtual_modems/stop_lab.sh
virtual_modems/start_lab.sh                      # lab on port 80 (sudo)
virtual_modems/start_lab.sh tplink_router_be230 8081
virtual_modems/stop_lab.sh 8081                  # only the BE230 runner
virtual_modems/stop_lab.sh                       # every runner
```

The venv on Linux is created the same way (`python3 -m venv virtual_modems/.venv && virtual_modems/.venv/bin/pip install -r virtual_modems/requirements.txt`).

## Login hints

- `tplink_router_be230`
  - host: `http://<ip>` on port 80, `http://<ip>:8081` when the runner uses port 8081
  - username: `admin`
  - password: `admin`
  - verify SSL: off
  - keep `support_tracker` on: mesh nodes are `device_tracker` entities of the same config entry
  - the provider selects `TplinkRouterV1_11`; the config entry unique ID is the mock LAN MAC `02-56-4d-01-00-01`, so the mock can be added as a second `tplink_router` entry next to a real router. Both router devices are named `TP-Link Router`, so the second entry's switch, sensor and button entity IDs get a `_2` suffix.
  - EasyMesh (`get_mesh_device_list_all`), one node tracker per node:
    - `Virtual Archer BE230`: `main_router`, `WirelessRouter`, `connected`
    - `Virtual RE330 Hall`: `satellite_router`, `RangeExtender`, `connect_type: wireless` to the main router, `signal_strength: 2` (bar level, exposed as `signal_level`), `connected`
    - `Virtual RE330 Garage`: `satellite_router`, `connect_type: wire`, parent `Virtual RE330 Hall` (two hops), `connected`
    - `Virtual RE330 Attic`: `satellite_router`, `connect_type: wireless` to the main router, `status: disconnected`, no clients (tracker state `not_home`)
    - satellites report `parent_mac`, `mesh_type: easymesh` and `support_reboot`; every node reports `model`, `vendor: TP-Link`, `location` and `client_num` (the node's clients that are online in that poll)
  - clients on satellites report the node as `ap_name` and keep their dBm `signal`; clients on the main node get the `*` prefix. 22 virtual clients, 6 of them IoT.
  - status reports `wan_ipv4_conntype: dhcp`, so the integration reads `admin/network?form=wan_ipv4_dynamic` and creates the `E-WAN connect` switch; release and renew switch `conn_status` between `disconnected` and `connected`.
  - DHCP reservations: `tplink_router.add_reservation` and `tplink_router.delete_reservation` change the in-memory list; a restart restores the seed.
  - VPN, DHCP server, IPv6 and per-band wireless forms are served as well.
- `tplink_deco_x50`
  - host: `http://<ip>`
  - password: any value (mock)
  - `VMODEM_DECO_CLIENT_MODE=global_fallback` makes the per-node `client_list` query return 503 so the integration's global client list fallback can be exercised (default `per_node`)
- `omada_controller`
  - host: `http://<ip>` (include protocol)
  - username: `admin`
  - password: `admin`
  - override via env: `VMODEM_OMADA_USERNAME`, `VMODEM_OMADA_PASSWORD`
  - Controller MAC `02-56-4D-03-00-FF`, model `OC300`; core `tplink_omada` (Home Assistant 2026.10+) reads both from `maintenance/controllerStatus` during setup and names the controller device `OC300 - Virtual Omada Controller: Main Campus`.
  - `VMODEM_OMADA_CONTROLLER_UPDATE=1` makes `controller/notification/updateInfo` report a software update (one patch above the configured version, e.g. 5.15.8 → 5.15.9), so the core controller `Firmware` update entity turns on. Default: no update.
  - `VMODEM_OMADA_VERSION` sets `controllerVer` (default `5.15.8`). With `6.0.1` or newer `ha-omada` switches to the `/openapi/v2` client list and receives at most 100 of the 128 virtual clients per poll, which reproduces the Omada 6.x truncation; on 5.x the openapi paths deliberately return 404.
  - Seed: 6 devices (gateway, 2 switches, 3 access points with status codes 14/15/30/11) and 128 clients (108 wireless, 20 wired, 8 guest, 13 flapping between online and offline). Six clients (`vm-wifi-001`, `-024`, `-047`, `-070`, `-093`, `vm-wired-008`) start blocked, so the Open API `scope=3` list and the `Network access` switches have something to show from the first poll. SSIDs keep their original names (`MainNet 2.4G/5G/6G`, `GuestNet 5G`, `IoTNet 2.4G`) because HA entries filter tracked clients by SSID. `vm-wifi-050` is the only client whose `hostName` (`vm-host-050`) differs from its name.
  - Cumulative client counters (traffic, packets, uptime) grow with wall-clock time at a per-client pace, so Home Assistant `total_increasing` sensors never decrease between polls.
- `omada_open_api` (served by the `omada_controller` and `lab` profiles)
  - the token endpoint accepts form-encoded and JSON bodies (the integration sends the refresh_token grant form-encoded since 1.11.0)
  - auto-discovery (integration 1.12.0+) excludes private MACs by default; every virtual MAC (`02:56:4D`) is locally administered, so turn that filter off to get auto-discovered trackers from the lab
  - controller type: `Self-Hosted (Local Controller)`
  - api url: `http://<ip>` (include protocol; leave `verify_ssl` off for plain HTTP)
  - omada id: `oc-virtual-001`
  - client id: `virtual-open-api`, client secret: `virtual-open-api-secret`
  - override via env: `VMODEM_OAPI_CLIENT_ID`, `VMODEM_OAPI_CLIENT_SECRET`
  - site: `Main Campus` (`site-main`); a wrong Omada ID answers `errorCode -7131`, a wrong secret `-44106`, an unknown access token `-44112` so the token refresh path is exercised
  - the config flow lists only the first 200 clients and creates entities only for the clients selected in that step; the `ssid_filter` step narrows that list to the chosen SSIDs, so keep the SSID names unchanged
  - the Open API is always available regardless of `VMODEM_OMADA_VERSION`; requests carrying an `Authorization: AccessToken=...` header take the Open API branch, everything else keeps the legacy behaviour
  - block, unblock, LED, PoE, radio and SSID writes mutate the same state the legacy API serves, so a client blocked here shows up as blocked in `ha-omada` too
  - the DPI application list, VPN stats and threat heatmap are served as empty pages; per-client DPI traffic and VPN peer lists answer 404, which the integration treats as unavailable data

## Debug endpoints

- `GET /_debug/requests?limit=200`
- `POST /_debug/requests/clear`
- `lab` profile: `/_debug/omada/requests` and `/_debug/deco/requests`
