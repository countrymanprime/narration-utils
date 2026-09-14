"""CLI entrypoint, ported from shared/hub/Program.cs.

Launches the FastAPI/uvicorn host on a loopback port, writes the same
startup.ready/startup.failure handshake files the REAPER Lua launcher polls
for, and opens the user's default browser at the loopback URL instead of a
Photino native window.
"""

import argparse
import asyncio
import sys
import time
import webbrowser
from pathlib import Path

import uvicorn

# How long the server can go with zero requests of any kind before treating
# the browser tab as gone for good and shutting itself down. Deliberately
# generous: this tab is normally *backgrounded* while the narrator works in
# REAPER, and browsers throttle a backgrounded tab's timers (the heartbeat
# App.tsx sends included) down to roughly once a minute or slower - a short
# timeout here would kill a session the user still has open and intends to
# come back to. This is a backstop for "actually closed/crashed", not a
# resource-reclaiming optimization.
IDLE_SHUTDOWN_GRACE_SECONDS = 600
IDLE_WATCHDOG_INTERVAL_SECONDS = 30

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "shared" / "python"))

from narration_common import config as cfg  # noqa: E402

from .app import build_app  # noqa: E402
from .diagnostics import SessionDiagnostics  # noqa: E402
from .dialogs import show_open_docx_dialog  # noqa: E402
from .hub_state import HubState  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--project-folder", default="")
    parser.add_argument("--project-name", default="")
    parser.add_argument("--daw", default="")
    parser.add_argument("--manuscript-python", default="")
    parser.add_argument("--manuscript-backend", default="")
    parser.add_argument("--compare-python", default="")
    parser.add_argument("--compare-backend", default="")
    parser.add_argument("--seed", action="append", default=[])
    parser.add_argument("--smoke-test", action="store_true")
    return parser.parse_args(argv)


def write_startup_ready(session_dir: Path) -> None:
    (session_dir / "startup.ready").write_text("OK\n", encoding="utf-8")


def write_startup_failure(session_dir: Path, message: str) -> None:
    (session_dir / "startup.failure").write_text(message + "\n", encoding="utf-8")


async def _watch_shutdown(server: uvicorn.Server, shutdown_event: asyncio.Event) -> None:
    await shutdown_event.wait()
    server.should_exit = True


async def _idle_watchdog(hub: HubState, shutdown_event: asyncio.Event) -> None:
    """Shuts the server down once nothing has talked to it for a long time.

    App.tsx sends a periodic heartbeat independent of which page is open, so
    "no request of any kind for IDLE_SHUTDOWN_GRACE_SECONDS" means the tab is
    gone (closed, crashed, or the machine slept) rather than merely idle or
    backgrounded - see the module docstring's note on timer throttling.
    """
    while not shutdown_event.is_set():
        await asyncio.sleep(IDLE_WATCHDOG_INTERVAL_SECONDS)
        if time.monotonic() - hub.last_activity_at >= IDLE_SHUTDOWN_GRACE_SECONDS:
            hub.diagnostics.event("idle_shutdown_no_browser_tab")
            shutdown_event.set()
            return


async def _serve(app, hub: HubState, session_dir: Path, open_browser: bool, has_audio_dir: bool, shutdown_event: asyncio.Event) -> None:
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    if has_audio_dir:
        hub.guide_audio_base_url = base_url.rstrip("/") + "/audio/"
        hub.diagnostics.event("audio_server_started", {"url": hub.guide_audio_base_url})
    hub.diagnostics.event("local_server_started", {"url": base_url})
    write_startup_ready(session_dir)
    if open_browser:
        webbrowser.open(base_url)

    watch_task = asyncio.create_task(_watch_shutdown(server, shutdown_event))
    idle_task = asyncio.create_task(_idle_watchdog(hub, shutdown_event))
    try:
        await task
    finally:
        watch_task.cancel()
        idle_task.cancel()


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv if argv is not None else sys.argv[1:])
    session_dir = Path(options.session_dir)
    session_dir.mkdir(parents=True, exist_ok=True)
    diagnostics = SessionDiagnostics(str(session_dir))
    ui_dist_dir = REPO_ROOT / "shared" / "ui" / "dist"

    if not (ui_dist_dir / "index.html").exists():
        message = "Narration Utils UI assets are missing.\n\nRun scripts\\Quickstart.ps1 from this checkout, then launch it again."
        diagnostics.event("startup_error_shown", {"message": message})
        write_startup_failure(session_dir, message)
        print(message, file=sys.stderr)
        return 1

    for seed in options.seed:
        parts = seed.split("|", 2)
        if len(parts) == 3:
            cfg.seed_global_if_missing(parts[0], {parts[1]: parts[2]})

    audio_dir = str(Path(options.project_folder) / "ManuscriptGuide" / "audio") if options.project_folder else None
    hub = HubState(
        session_dir=str(session_dir),
        project_folder=options.project_folder,
        project_name=options.project_name,
        daw=options.daw,
        manuscript_python=options.manuscript_python,
        manuscript_backend=options.manuscript_backend,
        compare_python=options.compare_python,
        compare_backend=options.compare_backend,
        diagnostics=diagnostics,
    )
    hub.show_open_docx_dialog = show_open_docx_dialog
    shutdown_event = asyncio.Event()
    app = build_app(hub, str(ui_dist_dir), audio_dir, shutdown_event=shutdown_event)

    if options.smoke_test:
        return asyncio.run(_smoke_test(app, hub))

    try:
        asyncio.run(_serve(app, hub, session_dir, open_browser=True, has_audio_dir=audio_dir is not None, shutdown_event=shutdown_event))
    except Exception as exc:  # noqa: BLE001 - mirrors Program.cs's startup-failure path
        write_startup_failure(session_dir, f"Narration Utils could not start its desktop API: {exc}")
        raise
    return 0


async def _smoke_test(app, hub: HubState) -> int:
    import httpx

    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            response = await client.get("/api/health")
            if response.status_code != 200:
                raise RuntimeError("Smoke test could not reach /api/health.")
    finally:
        server.should_exit = True
        await task
    hub.diagnostics.event("smoke_test_passed")
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
