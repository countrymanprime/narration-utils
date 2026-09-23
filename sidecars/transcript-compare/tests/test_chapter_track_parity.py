"""Parity cases shared with the Go port of find_chapter_by_track_name
(apps/desktop/internal/chaptermatch, teleprompter-manuscript-integration PRD
Phase 8). Both suites read tests/fixtures/chapter-track-match/parity-cases.json,
so a change to either matcher that the other does not follow fails one of them."""

import csv
import importlib.util
import json
from pathlib import Path

import pytest
from narration_common.spoken_forms import HOMOPHONE_GROUPS

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_parity", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)

PARITY_PATH = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "chapter-track-match" / "parity-cases.json"
PARITY = json.loads(PARITY_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", PARITY["normalizedTokens"], ids=lambda case: repr(case["input"]))
def test_normalized_tokens_match_the_shared_cases(case):
    assert compare.normalized_tokens(case["input"]) == case["tokens"]


@pytest.mark.parametrize("case", PARITY["matches"], ids=lambda case: case["name"])
def test_find_chapter_by_track_name_matches_the_shared_cases(case):
    chapters = [{"title": title, "position": index} for index, title in enumerate(case["chapters"])]
    chapter, score, _candidates = compare.find_chapter_by_track_name(chapters, case["track"])
    assert (None if chapter is None else chapter["position"]) == case["index"]
    assert score == pytest.approx(case["score"], abs=1e-12)


def test_the_go_port_carries_the_same_homophone_list():
    # The Go port embeds the built-in homophone groups as a CSV (a Go embed
    # cannot reach Python data); this is the guard that the two stay the same.
    go_copy = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "internal" / "chaptermatch" / "homophones.csv"
    rows = csv.reader(line for line in go_copy.read_text(encoding="utf-8").splitlines() if line.strip() and not line.lstrip().startswith("#"))
    go_groups = tuple(tuple(word.strip() for word in row if word.strip()) for row in rows)
    assert go_groups == HOMOPHONE_GROUPS
