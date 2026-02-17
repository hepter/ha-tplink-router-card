from __future__ import annotations

import atexit
import argparse
import importlib
import json
import os
from pathlib import Path
import socket
import tempfile
from typing import Callable

import uvicorn

PROFILE_MODULES = {
    "tplink_router_be230": "virtual_modems.profiles.tplink_router_be230",
    "tplink_deco_x50": "virtual_modems.profiles.tplink_deco_x50",
    "omada_controller": "virtual_modems.profiles.omada_controller",
}

PROFILE_ENTRY_PATHS = {
    "tplink_router_be230": "/",
    "tplink_deco_x50": "/",
    "omada_controller": "/",
}

MODEM_PROFILES = {"tplink_router_be230", "tplink_deco_x50", "omada_controller"}


def _active_modem_file() -> Path:
    return Path(tempfile.gettempdir()) / "virtual_modems" / "active_modem.json"


def _is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_modem_lock(profile: str, host: str, port: int) -> None:
    if profile not in MODEM_PROFILES:
        return

    state_file = _active_modem_file()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    current_pid = os.getpid()

    existing: dict[str, object] | None = None
    if state_file.exists():
        try:
            existing = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            existing = None

    if isinstance(existing, dict):
        existing_pid = int(existing.get("pid") or 0)
        if existing_pid and existing_pid != current_pid and _is_pid_running(existing_pid):
            existing_profile = str(existing.get("profile") or "unknown")
            existing_port = int(existing.get("port") or 0)
            raise RuntimeError(
                f"Another modem profile is already running: "
                f"profile={existing_profile} pid={existing_pid} port={existing_port}"
            )

    state = {
        "pid": current_pid,
        "profile": profile,
        "host": host,
        "port": port,
    }
    state_file.write_text(json.dumps(state), encoding="utf-8")

    def _cleanup() -> None:
        if not state_file.exists():
            return
        try:
            payload = json.loads(state_file.read_text(encoding="utf-8"))
            if int(payload.get("pid") or 0) == current_pid:
                state_file.unlink(missing_ok=True)
        except Exception:
            state_file.unlink(missing_ok=True)

    atexit.register(_cleanup)


def _load_profile(profile: str):
    module_name = PROFILE_MODULES[profile]
    module = importlib.import_module(module_name)
    app = getattr(module, "app", None)
    if app is None:
        create_app: Callable = getattr(module, "create_app")
        app = create_app()
    return app


def _get_local_ipv4_candidates() -> list[str]:
    candidates = {"127.0.0.1"}

    # Best effort: discover outward-facing local address
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        candidates.add(sock.getsockname()[0])
        sock.close()
    except Exception:
        pass

    # Hostname-based resolution
    try:
        _, _, addrs = socket.gethostbyname_ex(socket.gethostname())
        for addr in addrs:
            if addr and "." in addr:
                candidates.add(addr)
    except Exception:
        pass

    # Deterministic ordering: localhost first, then numerically sorted
    def sort_key(ip: str) -> tuple[int, list[int]]:
        if ip == "127.0.0.1":
            return (0, [127, 0, 0, 1])
        try:
            return (1, [int(part) for part in ip.split(".")])
        except Exception:
            return (2, [999, 999, 999, 999])

    return sorted(candidates, key=sort_key)


def _print_startup_urls(profile: str, host: str, port: int) -> None:
    path = PROFILE_ENTRY_PATHS.get(profile, "/")
    if host in {"0.0.0.0", "::"}:
        addresses = _get_local_ipv4_candidates()
    else:
        addresses = [host]

    def format_url(addr: str) -> str:
        if port == 80:
            return f"http://{addr}{path}"
        return f"http://{addr}:{port}{path}"

    print("")
    print(f"[virtual_modems] profile={profile} started")
    print("[virtual_modems] accessible URLs:")
    for addr in addresses:
        print(f"  - {format_url(addr)}")
    print("")


def _fixture_path(filename: str) -> Path:
    return Path(__file__).resolve().parent / "data" / filename


def _print_profile_details(profile: str) -> None:
    try:
        if profile == "tplink_router_be230":
            data = json.loads(_fixture_path("tplink_router_be230.json").read_text(encoding="utf-8"))
            router = data.get("router", {})
            print("[virtual_modems] login hints:")
            print("  - host: http://<ip>")
            print("  - username: admin")
            print("  - password: admin")
            print("[virtual_modems] fake router:")
            print(f"  - model: {router.get('model', '-')}")
            print(f"  - hardware: {router.get('hardware_version', '-')}")
            print(f"  - firmware: {router.get('firmware_version', '-')}")
            print(f"  - lan ip (fixture): {router.get('lan_ipv4_ipaddr', '-')}")
            print(f"  - wan ip (fixture): {router.get('wan_ipv4_ipaddr', '-')}")
            print("")
            return

        if profile == "tplink_deco_x50":
            data = json.loads(_fixture_path("tplink_deco_x50.json").read_text(encoding="utf-8"))
            master = (data.get("decos") or [{}])[0]
            print("[virtual_modems] login hints:")
            print("  - host: http://<ip>")
            print("  - password: any value (mock)")
            print("[virtual_modems] fake deco:")
            print(f"  - model: {master.get('device_model', '-')}")
            print(f"  - hardware: {master.get('hardware_ver', '-')}")
            print(f"  - firmware: {master.get('software_ver', '-')}")
            print(f"  - lan ip (fixture): {master.get('ip_address', '-')}")
            print("")
            return

        if profile == "omada_controller":
            data = json.loads(_fixture_path("omada_controller.json").read_text(encoding="utf-8"))
            controller = data.get("controller", {})
            username = os.getenv("VMODEM_OMADA_USERNAME", "admin")
            password = os.getenv("VMODEM_OMADA_PASSWORD", "admin")
            print("[virtual_modems] login hints:")
            print("  - host: http://<ip>")
            print("  - IMPORTANT: include 'http://' in host field")
            print(f"  - username: {username}")
            print(f"  - password: {password}")
            print("[virtual_modems] fake omada controller:")
            print(f"  - name: {controller.get('name', '-')}")
            print(f"  - version: {controller.get('version', '-')}")
            print(f"  - controller id: {controller.get('id', '-')}")
            print(f"  - site: {controller.get('site_name', '-')} ({controller.get('site_id', '-')})")
            print("")
            return
    except Exception:
        # Startup info is best-effort and should never block the mock service.
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Run virtual TP-Link device/controller profiles")
    parser.add_argument("profile", choices=PROFILE_MODULES.keys())
    args = parser.parse_args()

    host = "0.0.0.0"
    port = 80

    try:
        _acquire_modem_lock(args.profile, host, port)
    except RuntimeError as err:
        print(f"[virtual_modems] {err}")
        raise SystemExit(1) from err

    app = _load_profile(args.profile)
    _print_startup_urls(args.profile, host, port)
    _print_profile_details(args.profile)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
