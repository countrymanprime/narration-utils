#!/usr/bin/env python3
"""Create the release-only Tauri resources from approved local inputs.

The build intentionally freezes only first-party command entry points. Optional
models and voices remain first-use downloads and must never be copied into a
release without an approved provenance entry.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RESOURCES = ROOT / "shell" / "src-tauri" / "resources"
RUNTIME = RESOURCES / "runtime"


def freeze(name: str, entry: Path, paths: list[Path]) -> None:
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
    args.append(str(entry))
    subprocess.run(args, cwd=ROOT, check=True)
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
    args = parser.parse_args()
    if args.clean:
        shutil.rmtree(RESOURCES, ignore_errors=True)
    shutil.rmtree(RUNTIME, ignore_errors=True)
    shared_python = ROOT / "shared" / "python"
    freeze(
        "manuscript-guide", ROOT / "tools" / "manuscript-guide" / "core" / "manuscript_guide.py", [shared_python, ROOT / "tools" / "manuscript-guide" / "core"]
    )
    freeze("transcript-compare", ROOT / "tools" / "transcript-compare" / "core" / "compare.py", [shared_python, ROOT / "tools" / "transcript-compare" / "core"])
    shutil.copytree(ROOT / "shared" / "ui" / "dist", RESOURCES / "shared" / "ui" / "dist", dirs_exist_ok=True)
    shutil.copytree(ROOT / "shared" / "config", RESOURCES / "shared" / "config", dirs_exist_ok=True)


if __name__ == "__main__":
    main()
