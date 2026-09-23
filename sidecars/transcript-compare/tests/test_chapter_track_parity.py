"""Parity cases shared with the Go port of find_chapter_by_track_name
(apps/desktop/internal/chaptermatch, teleprompter-manuscript-integration PRD
Phase 8). Both suites read tests/fixtures/chapter-track-match/parity-cases.json,
so a change to either matcher that the other does not follow fails one of them."""

import importlib.util
import json
from pathlib import Path

import pytest

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
    # The Go port embeds a copy of homophones.csv (a Go embed cannot reach
    # outside its module); the Go suite checks the copy too, this is the
    # Python side of the same guard.
    go_copy = Path(__file__).resolve().parents[3] / "apps" / "desktop" / "internal" / "chaptermatch" / "homophones.csv"
    python_list = COMPARE_PATH.parent / "homophones.csv"
    assert go_copy.read_text(encoding="utf-8").splitlines() == python_list.read_text(encoding="utf-8").splitlines()
