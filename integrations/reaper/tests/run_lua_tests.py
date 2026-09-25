"""Runs the REAPER bridge harness: every ``*_test.lua`` beside this file, under Lua 5.4 (lupa).

Each test file gets a fresh Lua state, so no test can leak globals into another. The runner injects a ``host`` table
with the few things Lua's standard library cannot do (temp directories, listing and creating directories), plus the
directory the scripts under test live in. Exit status is non-zero when any test fails, when no Lua 5.4 interpreter is
available, or when a mutation check (``--mutations``) survives.

    python integrations/reaper/tests/run_lua_tests.py              # the harness tests
    python integrations/reaper/tests/run_lua_tests.py --mutations  # also prove the tests catch broken guards
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

try:
    from lupa.lua54 import LuaRuntime
except ImportError as error:  # pragma: no cover - the message is the point
    sys.exit(f"Lua 5.4 (the lupa package) is not installed: {error}. Run `uv sync --locked`.")

TESTS_DIR = Path(__file__).resolve().parent
REAPER_DIR = TESTS_DIR.parent
BOOTSTRAP = """
local host, tests_dir = ...
_G.host = host
package.path = tests_dir .. '/?.lua;' .. package.path
"""


def build_host(lua: LuaRuntime, reaper_dir: Path, scratch: Path) -> object:
    """The Python-backed primitives the harness gives Lua."""

    def tmpdir() -> str:
        return tempfile.mkdtemp(prefix="session_", dir=scratch)

    def listdir(path: str):
        directory = Path(path)
        names = sorted(entry.name for entry in directory.iterdir() if entry.is_file()) if directory.is_dir() else []
        return lua.table_from(names)

    def listsubdirs(path: str):
        directory = Path(path)
        names = sorted(entry.name for entry in directory.iterdir() if entry.is_dir()) if directory.is_dir() else []
        return lua.table_from(names)

    def makedirs(path: str) -> int:
        Path(path).mkdir(parents=True, exist_ok=True)
        return 1

    return lua.table_from(
        {
            "tmpdir": tmpdir,
            "listdir": listdir,
            "listsubdirs": listsubdirs,
            "makedirs": makedirs,
            "reaper_dir": str(reaper_dir),
            "is_windows": sys.platform == "win32",
        }
    )


def run_file(test_file: Path, reaper_dir: Path, scratch: Path) -> tuple[int, int, str]:
    lua = LuaRuntime(unpack_returned_tuples=True)
    if lua.eval("_VERSION") != "Lua 5.4":
        raise RuntimeError(f"expected Lua 5.4, got {lua.eval('_VERSION')}")
    host = build_host(lua, reaper_dir, scratch)
    lua.execute(BOOTSTRAP, host, TESTS_DIR.as_posix())
    harness = lua.eval("(require('harness'))")
    lua.eval("dofile")(str(test_file))
    passed, failed, report = harness.run(test_file.name)
    return int(passed), int(failed), str(report)


def run_suite(reaper_dir: Path, verbose: bool = True) -> tuple[int, int, list[str]]:
    scratch = Path(tempfile.mkdtemp(prefix="reaper-harness-"))
    passed = failed = 0
    reports: list[str] = []
    try:
        for test_file in sorted(TESTS_DIR.glob("*_test.lua")):
            ok, bad, report = run_file(test_file, reaper_dir, scratch)
            passed, failed = passed + ok, failed + bad
            if report:
                reports.append(report)
            if not ok + bad:
                reports.append(f"FAIL {test_file.name}: registers no tests")
                failed += 1
            if verbose:
                print(f"{test_file.name}: {ok} passed, {bad} failed")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return passed, failed, reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mutations", action="store_true", help="also run the mutation checks (mutations.json)")
    args = parser.parse_args()

    lua_version = LuaRuntime().eval("_VERSION")
    print(f"Lua interpreter: {lua_version} (lupa)")
    passed, failed, reports = run_suite(REAPER_DIR)
    for report in reports:
        print(report)
    print(f"{passed} passed, {failed} failed")
    status = 1 if failed or not passed else 0
    if not passed:
        print("No tests ran: the harness must find at least one *_test.lua that registers tests.")
    if args.mutations and not status:
        from mutations import run_mutations

        status = run_mutations(TESTS_DIR, REAPER_DIR, run_suite)
    return status


if __name__ == "__main__":
    sys.exit(main())
