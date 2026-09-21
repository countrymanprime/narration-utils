"""The dependency-review licence allow-list (docs security and hygiene PRD, phase 9; owner decisions D17 and Q14).

The action only judges dependencies a pull request adds or changes, so it cannot see what is already locked: this test is the other half. It
holds the workflow to the policy (the allow-list names the GPL, AGPL and LGPL families that the AGPL project may bundle, and no
GPL-2.0-only) and to the reality (every licence the release ships is on it, so a routine update of a shipped package is not flagged).
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import notices

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/dependency-review.yml"
OPERATORS = {"AND", "OR", "WITH"}


def review_step() -> dict:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["review"]["steps"]
    return next(step for step in steps if str(step.get("uses", "")).startswith("actions/dependency-review-action@"))["with"]


def allowed() -> set[str]:
    return {entry.strip() for entry in str(review_step()["allow-licenses"]).split(",") if entry.strip()}


def spdx_ids(expression: str) -> set[str]:
    """The licence ids in an SPDX expression; the exception after WITH is not a licence."""
    tokens = re.findall(r"[A-Za-z0-9.+-]+", expression.replace("(", " ").replace(")", " "))
    ids: set[str] = set()
    skip_next = False
    for token in tokens:
        if skip_next:
            skip_next = False
        elif token == "WITH":
            skip_next = True
        elif token not in OPERATORS:
            ids.add(token)
    return ids


def test_the_allow_list_names_the_copyleft_families_an_agpl_project_may_bundle():
    names = allowed()

    for needed in ("MIT", "Apache-2.0", "BSD-3-Clause", "GPL-3.0-or-later", "AGPL-3.0-or-later", "LGPL-2.1-or-later", "LGPL-3.0-or-later", "MPL-2.0"):
        assert needed in names, needed


def test_a_licence_that_is_not_compatible_with_agpl_is_not_allowed():
    # docs/research/local-dependency-evaluation.md: "GPL-2.0-only is not compatible."
    assert "GPL-2.0-only" not in allowed()
    assert "GPL-2.0" not in allowed()


def test_the_action_blocks_on_runtime_dependencies_and_keeps_the_vulnerability_gate():
    step = review_step()

    assert step["fail-on-scopes"] == "runtime"
    assert step["fail-on-severity"] == "high"


def test_the_allow_list_uses_spdx_ids_and_nothing_twice():
    entries = [entry.strip() for entry in str(review_step()["allow-licenses"]).split(",") if entry.strip()]

    assert len(entries) == len(set(entries))
    assert all(re.fullmatch(r"[A-Za-z0-9.+-]+", entry) for entry in entries), entries


def test_spdx_ids_reads_expressions():
    assert spdx_ids("(CC-BY-4.0 AND MIT)") == {"CC-BY-4.0", "MIT"}
    assert spdx_ids("GPL-2.0-or-later WITH Bootloader-exception") == {"GPL-2.0-or-later"}
    assert spdx_ids("Apache-2.0 OR BSD-2-Clause") == {"Apache-2.0", "BSD-2-Clause"}


needs_pnpm = pytest.mark.skipif(shutil.which("pnpm") is None or not (REPO_ROOT / "apps/ui/node_modules").exists(), reason="pnpm or the UI install is not here")
needs_go = pytest.mark.skipif(shutil.which("go") is None, reason="go is not here")


@needs_pnpm
def test_every_licence_of_the_ui_production_dependencies_is_allowed():
    found = {i for c in notices.npm_components(REPO_ROOT / "apps/ui") for i in spdx_ids(c.license)}

    assert found - allowed() == set()


@needs_go
def test_every_licence_of_the_go_modules_the_windows_build_links_is_allowed():
    found = {i for c in notices.go_components(REPO_ROOT / "apps/desktop") for i in spdx_ids(c.license)}

    # go list classifies texts with the bare GNU names; the allow-list carries the or-later ones the Python metadata declares.
    assert found - allowed() == set()


def test_every_licence_of_the_frozen_python_packages_is_allowed():
    build = REPO_ROOT / ".release-build"
    if not (build / "manuscript-guide/work").exists():
        pytest.skip("the sidecars have not been frozen here (scripts/release/prepare-resources.py)")
    components, _ = notices.python_components(build)

    found = {i for c in components for i in spdx_ids(c.license) if c.license != "UNKNOWN"}

    # pyinstaller's own licence is decided by hand in reviewed.json ("GPL-2.0-or-later WITH Bootloader-exception"), so it is not read here.
    assert found - allowed() == set()
