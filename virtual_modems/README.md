# Virtual Modems

Minimal local test profiles for real Home Assistant integration setup flows.

## Profiles

- `tplink_router_be230` for `tplink_router`
- `tplink_deco_x50` for `tplink_deco`
- `omada_controller` for `omada` and `tplink_omada`

Only one modem profile should run at a time.

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
```

Port is fixed to `80`.

## Login hints

- `tplink_router_be230`
  - host: `http://<ip>`
  - username: `admin`
  - password: `admin`
- `tplink_deco_x50`
  - host: `http://<ip>`
  - password: any value (mock)
- `omada_controller`
  - host: `http://<ip>` (include protocol)
  - username: `admin`
  - password: `admin`
  - override via env: `VMODEM_OMADA_USERNAME`, `VMODEM_OMADA_PASSWORD`

## Debug endpoints

- `GET /_debug/requests?limit=200`
- `POST /_debug/requests/clear`
