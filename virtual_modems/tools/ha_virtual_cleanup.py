"""Find, enable, disable or delete the Home Assistant config entries that point at the virtual lab.

Virtual devices are recognised by three markers that every lab profile applies:
- config entry title or host that contains the lab host (default 192.168.1.110) or the word "Virtual"
- device/entity names starting with "Virtual" / "vm-"
- MAC addresses with the locally administered prefix 02:56:4D

Usage (HA_URL and HA_TOKEN from environment or --url/--token):
  python -m virtual_modems.tools.ha_virtual_cleanup list
  python -m virtual_modems.tools.ha_virtual_cleanup devices
  python -m virtual_modems.tools.ha_virtual_cleanup enable
  python -m virtual_modems.tools.ha_virtual_cleanup disable
  python -m virtual_modems.tools.ha_virtual_cleanup prune --apply   # drop stale entities after a seed change
  python -m virtual_modems.tools.ha_virtual_cleanup delete --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

import httpx

LAB_DOMAINS = {"tplink_router", "tplink_deco", "omada", "tplink_omada"}
VIRTUAL_MAC_PREFIX = "02:56:4d"
VIRTUAL_NAME_MARKERS = ("virtual", "vm-")


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _is_lab_entry(entry: dict[str, Any], lab_host: str) -> bool:
    if entry.get("domain") not in LAB_DOMAINS:
        return False
    title = str(entry.get("title") or "").lower()
    return lab_host.lower() in title or "virtual" in title


def list_entries(url: str, token: str, lab_host: str) -> list[dict[str, Any]]:
    response = httpx.get(f"{url}/api/config/config_entries/entry", headers=_headers(token), timeout=20)
    response.raise_for_status()
    return [entry for entry in response.json() if _is_lab_entry(entry, lab_host)]


def delete_entry(url: str, token: str, entry_id: str) -> None:
    response = httpx.delete(
        f"{url}/api/config/config_entries/entry/{entry_id}", headers=_headers(token), timeout=30
    )
    response.raise_for_status()


async def _ws_call(url: str, token: str, messages: list[dict[str, Any]]) -> list[Any]:
    try:
        import websockets
    except ImportError as err:
        raise SystemExit("websockets package missing: pip install -r virtual_modems/requirements.txt") from err

    ws_url = url.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/api/websocket"
    results: list[Any] = []
    async with websockets.connect(ws_url, max_size=None) as ws:
        first = json.loads(await ws.recv())
        if first.get("type") != "auth_required":
            raise RuntimeError(f"unexpected websocket greeting: {first}")
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            raise RuntimeError(f"websocket auth failed: {auth}")
        for index, message in enumerate(messages, start=1):
            await ws.send(json.dumps({"id": index, **message}))
            while True:
                reply = json.loads(await ws.recv())
                if reply.get("id") == index:
                    if not reply.get("success", False):
                        raise RuntimeError(f"websocket command failed: {reply.get('error')}")
                    results.append(reply.get("result"))
                    break
    return results


def set_entries_disabled(url: str, token: str, entry_ids: list[str], disabled: bool) -> None:
    messages = [
        {"type": "config_entries/disable", "entry_id": entry_id, "disabled_by": "user" if disabled else None}
        for entry_id in entry_ids
    ]
    asyncio.run(_ws_call(url, token, messages))


def _normalize_mac(value: Any) -> str:
    return "".join(ch for ch in str(value).lower() if ch in "0123456789abcdef")


VIRTUAL_MAC_PREFIX_PLAIN = _normalize_mac(VIRTUAL_MAC_PREFIX)


def _device_macs(device: dict[str, Any]) -> list[str]:
    # Integrations put the MAC either in connections ("mac") or in identifiers (domain, mac).
    candidates = [value for _kind, value in (device.get("connections") or [])]
    candidates += [value for pair in (device.get("identifiers") or []) if len(pair) > 1 for value in pair[1:]]
    return sorted({_normalize_mac(value) for value in candidates if len(_normalize_mac(value)) == 12})


def list_virtual_devices(url: str, token: str) -> list[dict[str, Any]]:
    (devices,) = asyncio.run(_ws_call(url, token, [{"type": "config/device_registry/list"}]))
    virtual: list[dict[str, Any]] = []
    for device in devices:
        macs = _device_macs(device)
        name = str(device.get("name_by_user") or device.get("name") or "").lower()
        if any(mac.startswith(VIRTUAL_MAC_PREFIX_PLAIN) for mac in macs) or name.startswith(VIRTUAL_NAME_MARKERS):
            virtual.append(
                {
                    "id": device.get("id"),
                    "name": device.get("name_by_user") or device.get("name"),
                    "model": device.get("model"),
                    "macs": macs,
                    "config_entries": device.get("config_entries") or [],
                }
            )
    return virtual


def prune_orphans(url: str, token: str, entry_ids: list[str], apply: bool) -> None:
    """Remove registry entities of the lab entries that no longer have a state (stale seed MACs),
    then detach devices of those entries that are left without entities."""
    if not entry_ids:
        print("no lab entries; nothing to prune")
        return
    entities, devices = asyncio.run(
        _ws_call(url, token, [{"type": "config/entity_registry/list"}, {"type": "config/device_registry/list"}])
    )
    states = httpx.get(f"{url}/api/states", headers=_headers(token), timeout=30)
    states.raise_for_status()
    # HA keeps entities of vanished devices as `unavailable` with `restored: true`; entities the
    # integration disabled have no state on purpose and must be left alone.
    all_states = states.json()
    stale = {
        item["entity_id"]
        for item in all_states
        if item.get("state") == "unavailable" and (item.get("attributes") or {}).get("restored") is True
    }
    live = {item["entity_id"] for item in all_states} - stale
    lab_entities = [
        entity
        for entity in entities
        if entity.get("config_entry_id") in entry_ids and not entity.get("disabled_by")
    ]
    orphans = [entity for entity in lab_entities if entity["entity_id"] not in live]
    keep_devices = {entity.get("device_id") for entity in lab_entities if entity["entity_id"] in live}
    keep_devices |= {
        entity.get("device_id")
        for entity in entities
        if entity.get("config_entry_id") in entry_ids and entity.get("disabled_by")
    }
    empty_devices = [
        device
        for device in devices
        if any(entry in entry_ids for entry in (device.get("config_entries") or []))
        and device["id"] not in keep_devices
    ]
    print(f"{len(orphans)} orphan entities, {len(empty_devices)} devices without live entities")
    for entity in orphans:
        print(f"  entity {entity['entity_id']}")
    for device in empty_devices:
        print(f"  device {device['id']}  {device.get('name_by_user') or device.get('name')}")
    if not apply:
        if orphans or empty_devices:
            print("dry run: pass --apply to remove them")
        return
    if orphans:
        asyncio.run(
            _ws_call(
                url,
                token,
                [{"type": "config/entity_registry/remove", "entity_id": entity["entity_id"]} for entity in orphans],
            )
        )
    detached = 0
    for device in empty_devices:
        for entry_id in device.get("config_entries") or []:
            if entry_id not in entry_ids:
                continue
            try:
                asyncio.run(
                    _ws_call(
                        url,
                        token,
                        [
                            {
                                "type": "config/device_registry/remove_config_entry",
                                "device_id": device["id"],
                                "config_entry_id": entry_id,
                            }
                        ],
                    )
                )
                detached += 1
            except RuntimeError as err:
                # Integrations without async_remove_config_entry_device refuse this; deleting the
                # config entry (`delete --apply`) removes the device instead.
                print(f"  device {device['id']} kept: {err}")
    print(f"removed {len(orphans)} entities and detached {detached}/{len(empty_devices)} devices")


def _print_entries(entries: list[dict[str, Any]]) -> None:
    if not entries:
        print("no lab config entries found")
        return
    for entry in entries:
        print(
            f"{entry.get('domain'):<14} {entry.get('entry_id')}  state={entry.get('state')}  "
            f"disabled_by={entry.get('disabled_by')}  title={entry.get('title')}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["list", "devices", "enable", "disable", "prune", "delete"])
    parser.add_argument("--url", default=os.environ.get("HA_URL"), help="Home Assistant base URL")
    parser.add_argument("--token", default=os.environ.get("HA_TOKEN"), help="long-lived access token")
    parser.add_argument("--lab-host", default="192.168.1.110", help="host the virtual lab runs on")
    parser.add_argument("--apply", action="store_true", help="required for delete; otherwise dry run")
    args = parser.parse_args()

    if not args.url or not args.token:
        parser.error("HA_URL and HA_TOKEN (or --url/--token) are required")
    url = args.url.rstrip("/")

    entries = list_entries(url, args.token, args.lab_host)

    if args.command == "list":
        _print_entries(entries)
        return 0

    if args.command == "devices":
        devices = list_virtual_devices(url, args.token)
        if not devices:
            print("no virtual devices found")
        for device in devices:
            print(f"{device['id']}  {device['name']}  model={device['model']}  macs={','.join(device['macs'])}  entries={len(device['config_entries'])}")
        return 0

    if args.command == "prune":
        prune_orphans(url, args.token, [entry["entry_id"] for entry in entries], apply=args.apply)
        return 0

    if args.command in ("enable", "disable"):
        ids = [entry["entry_id"] for entry in entries]
        if not ids:
            print("nothing to change")
            return 0
        set_entries_disabled(url, args.token, ids, disabled=args.command == "disable")
        print(f"{args.command}d {len(ids)} config entries")
        _print_entries(list_entries(url, args.token, args.lab_host))
        return 0

    # delete
    _print_entries(entries)
    if not entries:
        return 0
    if not args.apply:
        print("dry run: pass --apply to delete the entries above (devices and entities go with them)")
        return 0
    for entry in entries:
        delete_entry(url, args.token, entry["entry_id"])
        print(f"deleted {entry['domain']} {entry['entry_id']} ({entry.get('title')})")
    leftovers = list_virtual_devices(url, args.token)
    if leftovers:
        print(f"{len(leftovers)} virtual devices remain (other config entries reference them):")
        for device in leftovers:
            print(f"  {device['id']}  {device['name']}  macs={','.join(device['macs'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
