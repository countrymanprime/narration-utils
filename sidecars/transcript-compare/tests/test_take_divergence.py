"""Tests for core/take_divergence.py: localizing where one take of a fixed span diverges
(take-review PRD phase 9). Transcripts here are hand-timed words, so every expected time is exact."""

import importlib.util
import sys
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

import take_divergence as td

SPEC = importlib.util.spec_from_file_location("transcript_compare_divergence", CORE / "compare.py")
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)

PARAGRAPHS = [
    "Alice was beginning to get very tired of sitting by her sister on the bank. She had nothing to do.",
    "Once or twice she had peeped into the book her sister was reading.",
]


def timed(text, start=0.0, step=0.5):
    """Words of text, one every `step` seconds, each lasting 0.4 of it."""
    return [(word, round(start + i * step, 3), round(start + i * step + step * 0.8, 3)) for i, word in enumerate(text.split())]


def span(first=0, last=0, paragraphs=PARAGRAPHS):
    return td.build_span(compare, paragraphs, first, last)


def statuses(alignment):
    return [word.status for word in alignment.words]


# ---------------------------------------------------------------------------
# the span


def test_the_span_numbers_sentences_as_the_markers_do_and_keeps_only_spoken_words():
    result = td.build_span(compare, ["One two. Three — four.", "Five six."], 1, 2)

    assert [(w.index, w.text, w.unit, w.paragraph) for w in result.words] == [(0, "Three", 1, 0), (1, "four.", 1, 0), (2, "Five", 2, 1), (3, "six.", 2, 1)]
    assert (result.first_unit, result.last_unit, result.first_paragraph, result.last_paragraph) == (1, 2, 0, 1)


@pytest.mark.parametrize(("first", "last"), [(-1, 0), (2, 1), (0, 3)])
def test_a_span_outside_the_chapter_is_refused(first, last):
    with pytest.raises(td.SpanError, match="not within"):
        span(first, last)


def test_a_chapter_without_sentences_or_spoken_words_is_refused():
    with pytest.raises(td.SpanError, match="no sentences"):
        td.build_span(compare, [], 0, 0)
    with pytest.raises(td.SpanError, match="no spoken words"):
        td.build_span(compare, ["— —."], 0, 0)


# ---------------------------------------------------------------------------
# aligning a take


def test_a_clean_take_matches_every_word_with_its_own_time():
    s = span(0, 0)
    words = timed("Alice was beginning to get very tired of sitting by her sister on the bank.")

    result = td.align_take(compare, s, words)

    assert set(statuses(result)) == {td.MATCHED}
    assert result.divergences == ()
    assert result.fidelity == 1.0
    assert (result.words[11].start, result.words[11].end) == (words[11][1], words[11][2])


def test_a_misread_word_partway_is_localized_to_that_word_and_its_time():
    s = span(0, 0)
    words = timed("Alice was beginning to get very tired of sitting by her sitter on the bank")

    result = td.align_take(compare, s, words)

    [divergence] = result.divergences
    assert (divergence.kind, divergence.position, divergence.first_word, divergence.last_word) == (td.MISREAD, td.WITHIN, 11, 11)
    assert (divergence.manuscript_text, divergence.audio_text) == ("sister", "sitter")
    assert (divergence.start, divergence.end) == (words[11][1], words[11][2])
    assert result.words[11].status == td.MISREAD
    assert result.count(td.MATCHED) == 14


def test_a_skipped_phrase_is_the_pause_where_it_was_left_out():
    s = span(0, 0)
    words = timed("Alice was beginning to get very tired of sitting on the bank")

    result = td.align_take(compare, s, words)

    [divergence] = result.divergences
    assert (divergence.kind, divergence.first_word, divergence.last_word) == (td.SKIPPED, 9, 11)
    assert divergence.manuscript_text == "by her sister"
    assert (divergence.start, divergence.end) == (words[8][2], words[9][1])
    assert [w.status for w in result.words[9:12]] == [td.SKIPPED] * 3
    assert result.words[9].start is None


def test_a_restart_is_an_extra_at_the_false_start_before_the_word_read_again():
    s = span(1, 1)
    words = timed("She had nothing to she had nothing to do")

    result = td.align_take(compare, s, words)

    [divergence] = result.divergences
    assert (divergence.kind, divergence.first_word) == (td.EXTRA, 0)
    assert divergence.position == td.BEFORE, "the false start comes before the first word read cleanly"
    assert divergence.audio_text == "She had nothing to"
    assert (divergence.start, divergence.end) == (words[0][1], words[3][2])
    assert result.extra_words == 4
    assert result.fidelity == 1.0


def test_a_repeated_word_inside_the_span_is_an_extra_within_it():
    s = span(1, 1)
    words = timed("She had had nothing to do")

    [divergence] = td.align_take(compare, s, words).divergences

    assert (divergence.kind, divergence.position, divergence.audio_text) == (td.EXTRA, td.WITHIN, "had")


def test_a_restart_the_diff_matched_first_is_still_the_earlier_copy():
    s = td.build_span(compare, ["alpha bravo charlie delta echo foxtrot golf."], 0, 0)
    words = timed("alpha bravo charlie delta echo charlie delta echo foxtrot golf")

    result = td.align_take(compare, s, words)

    [divergence] = result.divergences
    assert (divergence.kind, divergence.position, divergence.first_word, divergence.audio_text) == (td.EXTRA, td.WITHIN, 2, "charlie delta echo")
    assert (divergence.start, divergence.end) == (words[2][1], words[4][2]), "the abandoned first copy, not the read that went on"
    assert result.words[2].start == words[5][1], "the word is timed by the copy that continued"


def test_nothing_is_reinterpreted_when_the_audio_tokens_cannot_be_rebuilt():
    opcodes = [("equal", 0, 2, 0, 2), ("insert", 2, 2, 2, 4)]

    assert td._prefer_earlier_copy(opcodes, None) == opcodes
    assert td._audio_tokens(compare, timed("a b"), [0, 0]) is None


def test_a_take_that_stops_early_leaves_the_rest_unread_with_no_time():
    s = span(0, 1)
    words = timed("Alice was beginning to get very tired of sitting by her sister on the bank")

    result = td.align_take(compare, s, words)

    [divergence] = result.divergences
    assert (divergence.kind, divergence.position, divergence.first_word) == (td.UNREAD, td.AFTER, 15)
    assert (divergence.start, divergence.end) == (None, None)
    assert result.count(td.UNREAD) == 5


def test_chatter_before_the_span_is_an_extra_before_it_and_a_take_after_it_too():
    s = span(1, 1)
    words = timed("okay from the top She had nothing to do cut")

    result = td.align_take(compare, s, words)

    assert [(d.kind, d.position, d.audio_text, d.first_word) for d in result.divergences] == [
        (td.EXTRA, td.BEFORE, "okay from the top", 0),
        (td.EXTRA, td.AFTER, "cut", None),
    ]


def test_a_take_of_something_else_is_one_misread_of_the_whole_span():
    s = span(1, 1)

    result = td.align_take(compare, s, timed("completely different words"))

    assert set(statuses(result)) == {td.MISREAD}
    assert [(d.kind, d.first_word, d.last_word) for d in result.divergences] == [(td.MISREAD, 0, 4)]
    assert result.fidelity == 0.0


def test_a_take_with_no_words_leaves_the_whole_span_unread():
    result = td.align_take(compare, span(1, 1), [])

    assert set(statuses(result)) == {td.UNREAD}
    assert [(d.kind, d.position) for d in result.divergences] == [(td.UNREAD, td.BEFORE)]


def test_spoken_numbers_and_compounds_match_the_written_words_they_stand_for():
    s = td.build_span(compare, ["Twenty three superpowered men ran."], 0, 0)
    words = [("23", 0.0, 0.8), ("super-powered", 1.0, 1.6), ("men", 1.7, 1.9), ("ran", 2.0, 2.3)]

    result = td.align_take(compare, s, words)

    assert set(statuses(result)) == {td.MATCHED}
    assert (result.words[0].start, result.words[1].start, result.words[1].end) == (0.0, 0.0, 0.8), "both number words take the digit's time"


def test_a_word_only_partly_read_is_a_misread():
    s = td.build_span(compare, ["The rock-hard ground was cold."], 0, 0)

    result = td.align_take(compare, s, timed("The rock ground was cold"))

    assert result.words[1].status == td.MISREAD
    assert [(d.kind, d.first_word) for d in result.divergences] == [(td.SKIPPED, 1)]


def test_fillers_are_not_extras():
    s = span(1, 1)

    result = td.align_take(compare, s, timed("She had um nothing to do"))

    assert result.divergences == ()


# ---------------------------------------------------------------------------
# output


def test_json_times_are_source_seconds_and_rounded():
    s = span(1, 1)
    words = timed("She had nothing to", step=0.3333)

    payload = td.to_json(td.align_take(compare, s, words), 10.0)

    assert payload["counts"] == {"matched": 4, "misread": 0, "skipped": 0, "unread": 1, "extraWords": 0}
    assert payload["fidelity"] == 0.8
    assert payload["words"][1] == {"index": 1, "status": "matched", "start": 10.333, "end": 10.6}
    assert payload["divergences"] == [
        {"kind": "unread", "position": "after", "firstWord": 4, "lastWord": 4, "manuscriptText": "do.", "audioText": "", "start": None, "end": None}
    ]


def test_span_json_lists_every_span_word_with_where_it_came_from():
    payload = td.span_json(span(1, 1))

    assert payload["firstUnit"] == payload["lastUnit"] == 1
    assert payload["words"][0] == {"index": 0, "text": "She", "unit": 1, "paragraph": 0}


# ---------------------------------------------------------------------------
# properties

VOCABULARY = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"]


def _drop_words(manuscript, data):
    kept = data.draw(st.lists(st.booleans(), min_size=len(manuscript), max_size=len(manuscript)))
    return [word for word, keep in zip(manuscript, kept) if keep]


@given(st.lists(st.sampled_from(VOCABULARY), min_size=1, max_size=12), st.data())
def test_every_span_word_gets_one_status_and_times_keep_the_order_said(manuscript, data):
    s = td.build_span(compare, [" ".join(manuscript) + "."], 0, 0)
    said = _drop_words(manuscript, data)

    result = td.align_take(compare, s, timed(" ".join(said)))

    assert len(result.words) == len(manuscript)
    assert all(word.status in td.WORD_STATUSES for word in result.words)
    assert result.count(td.MATCHED) <= len(said)
    starts = [word.start for word in result.words if word.status == td.MATCHED]
    assert starts == sorted(starts), "matched words keep the order they were said in"
    assert all(d.kind in td.DIVERGENCE_KINDS and d.position in (td.BEFORE, td.WITHIN, td.AFTER) for d in result.divergences)


@given(st.lists(st.sampled_from(VOCABULARY), min_size=1, max_size=7, unique=True), st.data())
def test_when_no_word_repeats_every_word_said_matches_and_every_dropped_word_diverges(manuscript, data):
    s = td.build_span(compare, [" ".join(manuscript) + "."], 0, 0)
    said = _drop_words(manuscript, data)

    result = td.align_take(compare, s, timed(" ".join(said)))

    assert [word.status == td.MATCHED for word in result.words] == [word in said for word in manuscript]
    assert (result.divergences == ()) == (said == manuscript)
