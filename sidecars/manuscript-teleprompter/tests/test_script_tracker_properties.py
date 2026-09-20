"""Property tests for the script tracker (engine-independent alignment; ADR 0021).

Example tests pin what the tracker does on a lighthouse script. These pin the rules that must hold
on any script and any heard words, so an alignment change cannot quietly break the cursor.
"""

import importlib.util
from pathlib import Path

from hypothesis import event, example, given
from hypothesis import strategies as st

TRACKER_PATH = Path(__file__).resolve().parents[1] / "core" / "script_tracker.py"
SPEC = importlib.util.spec_from_file_location("script_tracker_properties", TRACKER_PATH)
tracker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(tracker)

# A small vocabulary makes the heard words hit the script (and each other) often, which is
# where the alignment rules are exercised; the arbitrary-text strategy covers everything else.
VOCABULARY = st.sampled_from(["the", "old", "lamp", "keeper", "climbed", "stairs", "lighthouse", "evening", "ships", "pass", "night", "sea"])
WORD = VOCABULARY | st.text(alphabet="abcd'", min_size=1, max_size=6)
WORDS = st.lists(WORD, max_size=14)
SCRIPT = st.lists(WORD, max_size=40)
POSITION = st.integers(min_value=0, max_value=60)


@st.composite
def heard_from_the_script(draw):
    """A script, an anchor, and words heard from somewhere in that script (some misheard), so the
    alignment reaches its restart and skip-ahead branches instead of matching nothing."""
    script = draw(st.lists(WORD, min_size=6, max_size=40))
    anchor = draw(st.integers(min_value=0, max_value=len(script)))
    offset = draw(st.integers(min_value=0, max_value=len(script)))
    span = script[offset : offset + draw(st.integers(min_value=0, max_value=12))]
    keep = draw(st.lists(st.booleans(), min_size=len(span), max_size=len(span)))
    noise = draw(WORD)
    return script, anchor, [word if kept else noise for word, kept in zip(span, keep)]


@given(WORDS, SCRIPT, POSITION)
def test_advance_moves_forward_inside_the_script(heard, script, start):
    result = tracker.advance(heard, script, start)
    assert start <= result.read <= max(start, len(script))
    assert 0 <= result.matched <= len(heard)
    assert (result.first is None) == (result.matched == 0)
    if result.first is not None:
        assert start <= result.first < len(script)


@given(heard_from_the_script(), WORDS)
def test_advancing_in_two_steps_equals_advancing_once(scenario, more):
    script, start, first_half = scenario
    whole = tracker.advance(first_half + more, script, start)
    one = tracker.advance(first_half, script, start)
    two = tracker.advance(more, script, one.read)
    assert whole.read == two.read
    assert whole.matched == one.matched + two.matched
    assert whole.first == (one.first if one.matched else two.first)


_SCRIPT_TEXT = ["the", "old", "lamp", "keeper", "climbed", "stairs", "lighthouse", "evening", "ships", "pass", "night", "sea", "the", "lamp", "night"]


@example((_SCRIPT_TEXT, 0, _SCRIPT_TEXT[6:11]))  # heard well ahead of the anchor: a skip
@example((_SCRIPT_TEXT, 10, _SCRIPT_TEXT[0:5]))  # heard from the top again: a restart
@given(heard_from_the_script())
def test_locate_reports_only_known_jumps_and_skips_that_start_at_the_anchor(scenario):
    script, anchor, heard = scenario
    location = tracker.locate(heard, script, anchor)
    event(f"jump={location.jump}")
    near = tracker.advance(heard, script, anchor)
    assert location.jump in (None, "restart", "skip")
    assert 0 <= location.matched <= len(heard)
    assert location.read <= max(anchor, len(script))
    if location.jump is None:
        assert location.skipped is None
        assert (location.read, location.matched) == (near.read, near.matched)
    if location.jump == "restart":
        assert location.skipped is None
    if location.skipped is not None:
        start, end = location.skipped
        assert location.jump == "skip"
        assert start == anchor < end


def test_the_explicit_examples_really_do_jump():
    skip = tracker.locate(_SCRIPT_TEXT[6:11], _SCRIPT_TEXT, 0)
    restart = tracker.locate(_SCRIPT_TEXT[0:5], _SCRIPT_TEXT, 10)
    assert (skip.jump, skip.skipped is not None) == ("skip", True)
    assert restart.jump == "restart"


@given(WORD)
def test_a_word_always_matches_itself(word):
    assert tracker.words_match(word, word)


@given(st.text(alphabet="abcdefg'", max_size=3), st.text(alphabet="abcdefg'", min_size=4, max_size=8))
def test_a_short_word_only_ever_matches_an_identical_one(short, other):
    assert not tracker.words_match(short, other)
    assert not tracker.words_match(other, short)


@given(st.text(alphabet="abcdefgh'", min_size=4, max_size=9), st.text(alphabet="abcdefgh'", min_size=4, max_size=9))
@example("aabbbbb", "abbbbba")
def test_fuzzy_word_matching_agrees_in_both_directions(left, right):
    # SequenceMatcher.ratio is not guaranteed symmetric; the tracker feeds (heard, script) in one
    # order, so an asymmetry would make a match depend on which side was misspelled.
    assert tracker.words_match(left, right) == tracker.words_match(right, left)


@given(st.text())
def test_normalizing_a_word_is_idempotent_and_leaves_only_word_characters(word):
    once = tracker.normalize_word(word)
    assert tracker.normalize_word(once) == once
    assert all(character.isalnum() or character in "_'" for character in once)


@st.composite
def heard_stream(draw):
    """A script and engine events whose words come from random places in it, so the stream contains
    restarts and skips ahead as well as ordinary reading, and the tracker reports real jumps."""
    script = draw(st.lists(WORD, min_size=6, max_size=40))

    def chunk():
        offset = draw(st.integers(min_value=0, max_value=len(script)))
        return script[offset : offset + draw(st.integers(min_value=0, max_value=8))]

    events = []
    for _ in range(draw(st.integers(min_value=0, max_value=25))):
        kind = draw(st.sampled_from(["partial", "word", "segment_end", "noise"]))
        segment = draw(st.integers(min_value=0, max_value=2))
        if kind == "partial":
            event = {"type": "partial", "segment": segment, "words": [{"word": word} for word in chunk()]}
        elif kind == "word":
            event = {"type": "word", "segment": segment, "word": draw(WORD) if draw(st.booleans()) else (chunk() or ["x"])[0]}
        else:
            event = {"type": kind}
        events.append((event, draw(st.floats(min_value=0, max_value=3, allow_nan=False))))
    return script, events


@given(heard_stream())
def test_the_tracker_never_leaves_the_script_whatever_it_hears(stream):
    script, timed_events = stream
    follower = tracker.ScriptTracker(script)
    now = 0.0
    for heard_event, delay in timed_events:
        now += delay
        for position in follower.feed(heard_event, now) + follower.tick(now):
            event(f"status={position['status']} jump={position['jump']}")
            assert position["type"] == "position"
            assert 0 <= position["read"] <= len(script)
            assert 0 <= position["committed"] <= len(script)
            assert position["status"] in ("listening", "waiting", "done")
            assert position["jump"] in (None, "restart", "skip")
