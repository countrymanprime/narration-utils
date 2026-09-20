import importlib.util
from pathlib import Path

import pytest

PROBE_PATH = Path(__file__).resolve().parents[1] / "spikes" / "moonshine_probe.py"
SPEC = importlib.util.spec_from_file_location("moonshine_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(probe)


def _partial(line_id, wall, text, words=None):
    return {"kind": "LineTextChanged", "line_id": line_id, "wall": wall, "text": text, "words": words or []}


def _final(line_id, wall, text, words):
    return {"kind": "LineCompleted", "line_id": line_id, "wall": wall, "text": text, "words": words}


def test_normalize_words_drops_case_and_punctuation_but_keeps_apostrophes():
    assert probe.normalize_words("Hello, World! It's fine.") == ["hello", "world", "it's", "fine"]


def test_word_error_rate_is_zero_for_an_exact_match():
    assert probe.word_error_rate(["a", "b", "c"], ["a", "b", "c"]) == 0.0


def test_word_error_rate_counts_substitutions_insertions_and_deletions():
    assert probe.word_error_rate(["a", "b", "c", "d"], ["a", "x", "c", "d"]) == pytest.approx(0.25)
    assert probe.word_error_rate(["a", "b", "c", "d"], ["a", "b", "d"]) == pytest.approx(0.25)
    assert probe.word_error_rate(["a", "b"], ["a", "b", "c", "d"]) == pytest.approx(1.0)


def test_word_error_rate_handles_an_empty_reference():
    assert probe.word_error_rate([], []) == 0.0
    assert probe.word_error_rate([], ["extra"]) == 1.0


def test_summarize_measures_how_long_after_each_word_ended_it_first_appeared():
    records = [
        _partial(1, 1.0, "hello", words=[{"word": "hello", "start": 0.2, "end": 0.6}]),
        _partial(1, 1.5, "hello world"),
        _final(1, 2.0, "hello world", [{"word": "hello", "start": 0.2, "end": 0.6}, {"word": "world", "start": 0.7, "end": 1.1}]),
    ]

    summary = probe.summarize(records)

    assert summary["word_lag_seconds"]["median"] == pytest.approx(0.4)
    assert summary["word_lag_seconds"]["timed_words"] == 2
    assert summary["partials_with_word_timestamps"] == 1
    assert summary["partial_events"] == 2


def test_summarize_counts_shown_words_that_were_later_revised():
    records = [
        _partial(1, 1.0, "hello wurld"),
        _partial(1, 1.5, "hello world"),
        _final(1, 2.0, "hello world", []),
    ]

    summary = probe.summarize(records)

    assert summary["shown_words_later_revised"] == "1/2"
    assert summary["final_differs_from_last_partial"] == "0/1"


def test_summarize_flags_a_final_line_that_differs_from_its_last_partial():
    records = [
        _partial(1, 1.0, "hello world"),
        _final(1, 2.0, "hello there world", []),
    ]

    assert probe.summarize(records)["final_differs_from_last_partial"] == "1/1"


def test_summarize_ignores_lines_that_never_completed_for_lag_and_mismatch():
    records = [_partial(1, 1.0, "still talking")]

    summary = probe.summarize(records)

    assert summary["lines_completed"] == 0
    assert summary["word_lag_seconds"]["median"] is None
