"""Mutation checks for the bridge harness: each entry of mutations.json breaks one safety-relevant line of the Lua
source, and the harness must fail. A surviving mutation means a guard has no test that would notice it disappearing.

An entry whose ``find`` text no longer occurs exactly once also fails the run, so refactoring the Lua source means
updating this file in the same change instead of quietly losing a check.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from lupa.lua54 import LuaError, LuaRuntime

SuiteRunner = Callable[..., tuple[int, int, list[str]]]


def _mutated_copy(reaper_dir: Path, scratch: Path, entry: dict) -> Path:
    target = scratch / "reaper"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for source in reaper_dir.glob("*.lua"):
        shutil.copy2(source, target / source.name)
    file = target / entry["file"]
    text = file.read_text(encoding="utf-8")
    occurrences = text.count(entry["find"])
    if occurrences != 1:
        raise ValueError(f"mutation {entry['name']!r}: expected its text once in {entry['file']}, found {occurrences}")
    file.write_text(text.replace(entry["find"], entry["replace"]), encoding="utf-8", newline="")
    loaded = LuaRuntime(unpack_returned_tuples=True).eval("loadfile")(str(file))
    syntax_error = loaded[1] if isinstance(loaded, tuple) else None  # loadfile answers (nil, message) on a syntax error
    if syntax_error:
        raise ValueError(f"mutation {entry['name']!r} does not compile, so it proves nothing: {syntax_error}")
    return target


def run_mutations(tests_dir: Path, reaper_dir: Path, run_suite: SuiteRunner) -> int:
    entries = json.loads((tests_dir / "mutations.json").read_text(encoding="utf-8"))
    scratch = Path(tempfile.mkdtemp(prefix="reaper-mutations-"))
    survivors: list[str] = []
    try:
        for entry in entries:
            mutated = _mutated_copy(reaper_dir, scratch, entry)
            try:
                _, failed, _ = run_suite(mutated, verbose=False)
            except (LuaError, RuntimeError) as error:  # a mutation that breaks loading is caught too
                failed = 1
                print(f"  caught (suite raised {type(error).__name__}): {entry['name']}")
                continue
            if failed:
                print(f"  caught ({failed} failing): {entry['name']}")
            else:
                survivors.append(entry["name"])
                print(f"  SURVIVED: {entry['name']}")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    print(f"{len(entries) - len(survivors)} of {len(entries)} mutations caught")
    return 1 if survivors else 0
