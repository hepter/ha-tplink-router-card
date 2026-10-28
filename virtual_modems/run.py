from __future__ import annotations

import atexit
import argparse
import ctypes
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
    "lab": "virtual_modems.profiles.lab",
}

PROFILE_ENTRY_PATHS = {
    "tplink_router_be230": "/",
    "tplink_deco_x50": "/",
    "omada_controller": "/",
    "lab": "/",
}

MODEM_PROFILES = {"tplink_router_be230", "tplink_deco_x50", "omada_controller", "lab"}

# `lab` serves these two profiles on one port; their HTTP paths do not overlap.
LAB_PROFILES = ("omada_controller", "tplink_deco_x50")

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_ERROR_ACCESS_DENIED = 5
_STILL_ACTIVE = 259


def _active_modem_file(port: int) -> Path:
    return Path(tempfile.gettempdir()) / "virtual_modems" / f"active_modem_{port}.json"


def _is_windows_pid_running(pid: int) -> bool:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.GetExitCodeProcess.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong))
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ctypes.get_last_error() == _ERROR_ACCESS_DENIED
    try:
        exit_code = ctypes.c_ulong()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == _STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        # os.kill(pid, 0) is no probe on Windows: signal 0 is CTRL_C_EVENT and CPython falls back
        # to TerminateProcess, which killed the runner holding the lock.
        return _is_windows_pid_running(pid)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_modem_lock(profile: str, host: str, port: int) -> None:
    if profile not in MODEM_PROFILES:
        return

    state_file = _active_modem_file(port)
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
            raise RuntimeError(
                f"Port {port} is already used by another modem profile: "
                f"profile={existing_profile} pid={existing_pid}"
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


def _print_profile_details(profile: str, port: int) -> None:
    if profile == "lab":
        for member in LAB_PROFILES:
            _print_profile_details(member, port)
        return
    host_hint = "http://<ip>" if port == 80 else f"http://<ip>:{port}"
    try:
        if profile == "tplink_router_be230":
            data = json.loads(_fixture_path("tplink_router_be230.json").read_text(encoding="utf-8"))
            router = data.get("router", {})
            print("[virtual_modems] login hints:")
            print(f"  - host: {host_hint}")
            print("  - username: admin")
            print("  - password: admin")
            print("[virtual_modems] fake router:")
            print(f"  - model: {router.get('model', '-')}")
            print(f"  - hardware: {router.get('hardware_version', '-')}")
            print(f"  - firmware: {router.get('firmware_version', '-')}")
            print(f"  - lan ip (fixture): {router.get('lan_ipv4_ipaddr', '-')}")
            print(f"  - wan ip (fixture): {router.get('wan_ipv4_ipaddr', '-')}")
            for node in data.get("mesh", {}).get("nodes", []):
                link = node.get("connect_type") or node.get("role")
                print(f"  - mesh node: {node.get('name')} ({link}, {node.get('status')})")
            print("")
            return

        if profile == "tplink_deco_x50":
            data = json.loads(_fixture_path("tplink_deco_x50.json").read_text(encoding="utf-8"))
            master = (data.get("decos") or [{}])[0]
            print("[virtual_modems] login hints:")
            print(f"  - host: {host_hint}")
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
            client_id = os.getenv("VMODEM_OAPI_CLIENT_ID", "virtual-open-api")
            client_secret = os.getenv("VMODEM_OAPI_CLIENT_SECRET", "virtual-open-api-secret")
            print("[virtual_modems] login hints (omada / tplink_omada):")
            print(f"  - host: {host_hint}")
            print("  - IMPORTANT: include 'http://' in host field")
            print(f"  - username: {username}")
            print(f"  - password: {password}")
            print("[virtual_modems] login hints (omada_open_api):")
            print("  - controller type: Self-Hosted (Local Controller)")
            print(f"  - api url: {host_hint}")
            print(f"  - omada id: {controller.get('id', '-')}")
            print(f"  - client id: {client_id}")
            print(f"  - client secret: {client_secret}")
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
    parser.add_argument("--host", default="0.0.0.0", help="bind address (default 0.0.0.0)")
    parser.add_argument(
        "--port",
        type=int,
        default=80,
        help="bind port (default 80; integrations expect the default HTTP port unless the host includes one)",
    )
    args = parser.parse_args()

    host = args.host
    port = args.port

    try:
        _acquire_modem_lock(args.profile, host, port)
    except RuntimeError as err:
        print(f"[virtual_modems] {err}")
        raise SystemExit(1) from err

    app = _load_profile(args.profile)
    _print_startup_urls(args.profile, host, port)
    _print_profile_details(args.profile, port)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
