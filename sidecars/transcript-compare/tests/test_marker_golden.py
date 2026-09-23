"""The take markers `diff_and_build_markers` writes for every committed recording-coverage case,
pinned byte for byte (docs/utilities/recording-coverage.md, ADR 0126, success signal:
the marker output is byte-identical before and after coverage is added).

Coverage reads the same alignment the markers come from (Q2), so a change to that alignment
shows up here first. Regenerate the golden file with `UPDATE_MARKER_GOLDEN=1` only when a marker
change is intended, and say why in the PR."""

import importlib.util
import json
import os
from pathlib import Path

import coverage_harness as harness

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_golden", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)

GOLDEN_PATH = harness.FIXTURE_DIR / "markers.golden.json"
MIN_WORDS = 1


def _markers_for(case):
    chapter = {"title": case.chapter.title, "paragraphs": [paragraph.text for paragraph in case.chapter.paragraphs]}
    words = [(word.text, word.start, word.end) for item in case.items for word in item.words]
    _units, tokens, unit_idx, raw_words = compare.build_chapter_units(chapter)
    markers, covered_range, alignment = compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, MIN_WORDS)
    return {
        "markers": [list(marker) for marker in markers],
        "coveredRange": list(covered_range) if covered_range else None,
        "opcodes": [list(opcode) for opcode in alignment["opcodes"]],
    }


def _render_all():
    corpus = harness.load_corpus(harness.FIXTURE_DIR)
    return json.dumps({case.id: _markers_for(case) for case in corpus.cases}, indent=1, sort_keys=True) + "\n"


def test_markers_for_the_committed_cases_match_the_golden_file():
    rendered = _render_all()
    if os.environ.get("UPDATE_MARKER_GOLDEN") == "1":
        GOLDEN_PATH.write_text(rendered, encoding="utf-8", newline="\n")
    assert rendered == GOLDEN_PATH.read_text(encoding="utf-8")
