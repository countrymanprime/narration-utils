#!/usr/bin/env python3
"""Create embedded Wails resources from approved local inputs.

The build intentionally freezes only first-party command entry points. Optional
models and voices remain first-use downloads and must never be copied into a
release without an approved provenance entry.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / "shell" / "cmd" / "narration-utils" / "resources"
RUNTIME = RESOURCES / "runtime"
REAPER = RESOURCES / "reaper"

# The freezes run at the same time, so their output is written one whole line at a time.
_PRINT_LOCK = threading.Lock()


class Sidecar(NamedTuple):
    name: str
    entry: Path
    paths: list[Path]
    collect_data: tuple[str, ...] = ()


def emit(text: str) -> None:
    """Write to stdout without ever failing on a character the console encoding cannot show (cp1252 on Windows)."""
    encoding = sys.stdout.encoding or "utf-8"
    with _PRINT_LOCK:
        sys.stdout.write(text.encode(encoding, errors="replace").decode(encoding))
        sys.stdout.flush()


def freeze(name: str, entry: Path, paths: list[Path], collect_data: tuple[str, ...] = ()) -> None:
    work = ROOT / ".release-build" / name
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        name,
        "--distpath",
        str(work / "dist"),
        "--workpath",
        str(work / "work"),
        "--specpath",
        str(work / "spec"),
    ]
    for path in paths:
        args.extend(["--paths", str(path)])
    for package in collect_data:
        args.extend(["--collect-data", package])
    args.append(str(entry))
    # `--clean` wipes PyInstaller's cache directory, which every run shares by default. With the freezes
    # running at once, that would delete files another one is reading, so each gets a cache of its own.
    cache = work / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    # PYTHONIOENCODING: the pipe is read as UTF-8 below, whatever the Windows locale would have written.
    env = {**os.environ, "PYINSTALLER_CONFIG_DIR": str(cache), "PYTHONIOENCODING": "utf-8"}
    # Streamed line by line, each tagged with its sidecar, so the log stays live and readable while three run at once.
    with subprocess.Popen(args, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace") as process:
        for line in process.stdout:
            emit(f"[{name}] {line}")
    if process.returncode != 0:
        raise subprocess.CalledProcessError(process.returncode, args)
    source = work / "dist" / name / (f"{name}.exe" if sys.platform == "win32" else name)
    if not source.is_file():
        raise RuntimeError(f"PyInstaller did not produce {source}")
    shutil.copytree(source.parent, RUNTIME / name, dirs_exist_ok=True)
    executable = RUNTIME / name / source.name
    if sys.platform != "win32":
        executable.chmod(executable.stat().st_mode | 0o111)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true")
    parser.add_argument(
        "--sidecar", choices=["manuscript-guide", "transcript-compare", "manuscript-teleprompter"], help="build one sidecar while diagnosing a platform package"
    )
    args = parser.parse_args()
    if args.clean:
        shutil.rmtree(RESOURCES, ignore_errors=True)
    if not args.sidecar:
        shutil.rmtree(RUNTIME, ignore_errors=True)
    shared_python = ROOT / "shared" / "python"
    sidecars = [
        Sidecar(
            "manuscript-guide",
            ROOT / "tools" / "manuscript-guide" / "core" / "manuscript_guide.py",
            [shared_python, ROOT / "tools" / "manuscript-guide" / "core"],
        ),
        # faster-whisper ships its Silero VAD model (assets/silero_vad_v6.onnx) as
        # package data and PyInstaller has no hook for it. Without collecting it, a
        # frozen sidecar that uses vad_filter=True fails with NoSuchFile at runtime.
        Sidecar(
            "transcript-compare",
            ROOT / "tools" / "transcript-compare" / "core" / "compare.py",
            [shared_python, ROOT / "tools" / "transcript-compare" / "core"],
            ("faster_whisper",),
        ),
        # live_asr.py imports script_tracker and chapter_script (siblings) inside
        # functions; PyInstaller finds them because their directory is on --paths.
        # The optional Moonshine engine (moonshine_voice) is deliberately not
        # bundled: it is not a project dependency yet.
        Sidecar(
            "manuscript-teleprompter",
            ROOT / "tools" / "manuscript-teleprompter" / "core" / "live_asr.py",
            [shared_python, ROOT / "tools" / "manuscript-teleprompter" / "core"],
            ("faster_whisper",),
        ),
    ]
    selected = [sidecar for sidecar in sidecars if args.sidecar in (None, sidecar.name)]
    # Each freeze is one mostly single-threaded PyInstaller process with its own work and output
    # directories, so they run side by side instead of one after another.
    with ThreadPoolExecutor(max_workers=len(selected)) as pool:
        futures = {sidecar.name: pool.submit(freeze, *sidecar) for sidecar in selected}
    # The pool has drained, so every freeze has finished: report all failures, not just the first.
    failures = {name: error for name, future in futures.items() if (error := future.exception())}
    if failures:
        emit(f"Freeze failed for: {', '.join(failures)}\n")
        raise next(iter(failures.values()))
    shutil.copytree(ROOT / "shared" / "config", RESOURCES / "config", dirs_exist_ok=True)
    # The action package is embedded with the desktop host.  At first launch
    # the host materializes it in its per-user cache and writes the installed
    # executable path beside it.  REAPER imports only when the narrator asks.
    shutil.copytree(ROOT / "shared" / "reaper", REAPER, dirs_exist_ok=True)


if __name__ == "__main__":
    main()
