# Virtual Modems

Minimal local test profiles for real Home Assistant integration setup flows.

## Profiles

- `tplink_router_be230` for `tplink_router`
- `tplink_deco_x50` for `tplink_deco`
- `omada_controller` for `omada` and `tplink_omada`
- `lab` = `omada_controller` + `tplink_deco_x50` on one port (their HTTP paths do not overlap; the router and Deco mocks both use `/cgi-bin/luci`, so `tplink_router_be230` cannot join)

Only one modem profile should run at a time (the runner keeps a lock file under the temp directory).

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
```

Default port is `80` (integrations expect the default HTTP port unless the configured host includes one); `--host` and `--port` override it for local development.

Background start/stop scripts use `virtual_modems/.venv` when present and keep logs next to the runner lock file.

Windows (`%TEMP%\virtual_modems`):

```powershell
powershell -ExecutionPolicy Bypass -File virtual_modems\start_lab.ps1            # lab on port 80
powershell -ExecutionPolicy Bypass -File virtual_modems\start_lab.ps1 -Profile omada_controller -Port 8080
powershell -ExecutionPolicy Bypass -File virtual_modems\stop_lab.ps1
```

Linux / macOS (`$TMPDIR` or `/tmp/virtual_modems`; port 80 re-runs the script with `sudo`, pass a port >= 1024 to avoid it):

```bash
chmod +x virtual_modems/start_lab.sh virtual_modems/stop_lab.sh
virtual_modems/start_lab.sh                      # lab on port 80 (sudo)
virtual_modems/start_lab.sh omada_controller 8080
virtual_modems/stop_lab.sh
```

The venv on Linux is created the same way (`python3 -m venv virtual_modems/.venv && virtual_modems/.venv/bin/pip install -r virtual_modems/requirements.txt`).

## Login hints

- `tplink_router_be230`
  - host: `http://<ip>`
  - username: `admin`
  - password: `admin`
  - EasyMesh: 1 main node + 2 satellites (`Virtual RE330 Hall`, `Virtual RE330 Garage`); clients on satellites report the node as `ap_name`, clients on the main node get the `*` prefix. 22 virtual clients, 6 of them IoT. VPN, DHCP server, IPv6 and per-band wireless forms are served for the newer `tplinkrouterc6u` client.
- `tplink_deco_x50`
  - host: `http://<ip>`
  - password: any value (mock)
  - `VMODEM_DECO_CLIENT_MODE=global_fallback` makes the per-node `client_list` query return 503 so the integration's global client list fallback can be exercised (default `per_node`)
- `omada_controller`
  - host: `http://<ip>` (include protocol)
  - username: `admin`
  - password: `admin`
  - override via env: `VMODEM_OMADA_USERNAME`, `VMODEM_OMADA_PASSWORD`
  - `VMODEM_OMADA_VERSION` sets `controllerVer` (default `5.15.8`). With `6.0.1` or newer `ha-omada` switches to the `/openapi/v2` client list and receives at most 100 of the 128 virtual clients per poll, which reproduces the Omada 6.x truncation; on 5.x the openapi paths deliberately return 404.
  - Seed: 6 devices (gateway, 2 switches, 3 access points with status codes 14/15/30/11) and 128 clients (100 wireless, 8 guest, 20 wired, 6 blocked). SSIDs keep their original names (`MainNet 2.4G/5G/6G`, `GuestNet 5G`, `IoTNet 2.4G`) because HA entries filter tracked clients by SSID.

## Debug endpoints

- `GET /_debug/requests?limit=200`
- `POST /_debug/requests/clear`
- `lab` profile: `/_debug/omada/requests` and `/_debug/deco/requests`
