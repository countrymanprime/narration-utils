"""Pin a payload a sidecar really produces against a committed file (ADR 0069).

A sidecar test calls ``check("name", value)``. The value is written as indented JSON with sorted keys and compared with
``tests/fixtures/contracts/<name>.json``; the TypeScript contract tests validate the same file against the UI's schemas, so a
payload that drifts fails on one side or the other. Run the tests with ``UPDATE_CONTRACTS=1`` to rewrite the file after a
deliberate change, and commit the diff. The Go helper (apps/desktop/internal/contractfile) writes the same format.
"""

import json
import os
from pathlib import Path
from typing import Any

UPDATE_ENV = "UPDATE_CONTRACTS"


def contracts_dir(start: Path | None = None) -> Path:
    """The shared folder of committed payloads, found by walking up to the workspace file."""
    here = (start or Path(__file__)).resolve()
    for directory in [here, *here.parents]:
        if (directory / "pnpm-workspace.yaml").is_file():
            return directory / "tests" / "fixtures" / "contracts"
    raise FileNotFoundError(f"no pnpm-workspace.yaml above {here}")


def encode(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def check(name: str, value: Any, directory: Path | None = None) -> None:
    """Compare ``value`` with the committed ``<name>.json`` (or write it in update mode)."""
    folder = directory or contracts_dir()
    path = folder / f"{name}.json"
    encoded = encode(value)
    if os.environ.get(UPDATE_ENV):
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(encoded, encoding="utf-8", newline="\n")
        return
    if not path.is_file():
        raise AssertionError(f"no committed contract file {path} (run the test with {UPDATE_ENV}=1 and commit it)")
    committed = path.read_text(encoding="utf-8")
    if committed != encoded:
        raise AssertionError(
            f"{path} no longer matches what the sidecar produces.\ncommitted:\n{committed}\nnow:\n{encoded}\n"
            f"Run the test with {UPDATE_ENV}=1, then update the schema and the mock together."
        )
