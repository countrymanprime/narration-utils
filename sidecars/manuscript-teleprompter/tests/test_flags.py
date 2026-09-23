import importlib.util
import sys
from pathlib import Path

import hypothesis
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

CORE = Path(__file__).resolve().parents[1] / "core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

SPEC = importlib.util.spec_from_file_location("flags", CORE / "flags.py")
flags = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(flags)

SCRIPT = "The old lighthouse keeper climbed the spiral stairs each evening. He lit the great lamp and watched the ships pass. Nobody ever thanked him for it."
# 0 The 1 old 2 lighthouse 3 keeper 4 climbed 5 the 6 spiral 7 stairs 8 each 9 evening.
# 10 He 11 lit 12 the 13 great 14 lamp 15 and 16 watched 17 the 18 ships 19 pass.
# 20 Nobody 21 ever 22 thanked 23 him 24 for 25 it.


def _tracker(text=SCRIPT):
    return flags.FlaggingTracker(text.split())


def _partial(segment, text):
    return {"type": "partial", "segment": segment, "words": [{"word": w, "start": 0.0, "end": 0.1} for w in text.split()]}


def _word(segment, text, at=0.0):
    return {"type": "word", "segment": segment, "word": text, "start": at, "end": at + 0.2}


def _read_segment(tracker, segment, text, now=0.0):
    """A segment spoken one word every 0.3 s of audio, each confirmed in turn."""
    events = list(tracker.feed(_partial(segment, text), now))
    for index, word in enumerate(text.split()):
        events += tracker.feed(_word(segment, word, 10.0 * segment + 0.3 * index), now)
    events += tracker.feed({"type": "segment_end", "segment": segment}, now)
    return events


def _flags(events):
    return [(e["kind"], e["start"], e["end"], e["heard"]) for e in events if e["type"] == "flag"]


def test_a_clean_read_raises_no_flags():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the spiral stairs each evening")

    assert _flags(events) == []


def test_a_different_word_read_in_place_of_a_script_word_is_a_misread():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the spiral chairs each evening")

    assert _flags(events) == [("misread", 7, 8, "chairs")]


def test_a_script_word_passed_over_is_skipped():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the stairs each evening")

    assert _flags(events) == [("skipped", 6, 7, "")]


def test_a_dropped_article_is_not_flagged_because_engines_drop_them_on_their_own():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed spiral stairs each evening")

    assert _flags(events) == []


def test_a_word_heard_between_two_script_words_is_an_extra_at_the_word_after_it():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper slowly climbed the spiral stairs")

    assert _flags(events) == [("extra", 4, 4, "slowly")]


def test_hesitations_are_not_extras():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper um climbed the spiral stairs")

    assert _flags(events) == []


@pytest.mark.parametrize(
    ("script", "heard"),
    [
        ("She made a daisy-chain for her friends today.", "she made a daisy chain for her friends today"),
        ("She counted twenty-three of her friends today.", "she counted twenty three of her friends today"),
        ("She counted 23 of her friends today.", "she counted twenty three of her friends today"),
        ("She said it's far from her friends today.", "she said its far from her friends today"),
    ],
)
def test_a_word_said_right_but_spelt_differently_is_not_a_misread(script, heard):
    events = _read_segment(_tracker(script), 0, heard)

    assert _flags(events) == []


def test_the_first_words_of_a_segment_only_anchor_and_raise_nothing():
    events = _read_segment(_tracker(), 0, "the ogled lighthouse keeper climbed the spiral stairs")

    assert _flags(events) == []


def test_a_discrepancy_just_after_the_first_words_of_a_segment_is_judged():
    events = _read_segment(_tracker(), 0, "the old ogled keeper climbed the spiral stairs")

    assert _flags(events) == [("misread", 2, 3, "ogled")]


def test_unmatched_words_at_the_end_of_a_segment_are_not_judged():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the spiral xyzzy")

    assert _flags(events) == []


def test_a_long_run_of_unplaceable_words_is_not_called_a_misread():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the grr brr frr zrr stairs each evening")

    assert _flags(events) == []


def test_going_back_to_an_earlier_sentence_in_a_new_segment_is_a_restart_of_the_words_read_again():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral stairs")

    events = _read_segment(tracker, 1, "the old lighthouse keeper climbed the spiral stairs each evening")

    assert _flags(events) == [("restart", 0, 8, "the old lighthouse keeper climbed the spiral stairs")]


def test_repeating_the_last_words_within_a_segment_is_a_restart():
    events = _read_segment(_tracker(), 0, "the old lighthouse keeper climbed the spiral climbed the spiral stairs each evening")

    assert _flags(events) == [("restart", 4, 7, "climbed the spiral")]


@pytest.mark.parametrize(
    "heard", ["the old lighthouse keeper keeper climbed the spiral stairs", "the old lighthouse keeper climbed the climbed the spiral stairs"]
)
def test_one_or_two_repeated_words_are_not_flagged_since_engines_duplicate_words_too(heard):
    assert _flags(_read_segment(_tracker(), 0, heard)) == []


def test_words_the_engine_confirmed_twice_from_the_same_audio_are_not_a_restart_or_an_extra():
    tracker = _tracker()
    spoken = [("the", 0.0), ("old", 0.3), ("lighthouse", 0.6), ("keeper", 0.9), ("climbed", 1.2), ("the", 1.5), ("spiral", 1.8)]
    echoed = spoken[4:] + [("stairs", 2.1), ("each", 2.4), ("evening", 2.7)]

    events = []
    for word, at in spoken + echoed:
        events += tracker.feed(_word(0, word, at), 0.0)
    events += tracker.feed({"type": "segment_end", "segment": 0}, 0.0)

    assert _flags(events) == []


def test_a_word_the_engine_split_across_a_matched_neighbour_is_not_a_misread():
    events = _read_segment(_tracker("He climbed the stairs at seven o'clock each evening."), 0, "he climbed the stairs at 7 o clock each evening")

    assert _flags(events) == []


def test_a_run_heard_within_the_trackers_own_spelling_tolerance_is_not_a_misread():
    events = _read_segment(_tracker("She was making a daisy-chain for her sister."), 0, "she was making a daily chain for her sister")

    assert _flags(events) == []


def test_a_skip_ahead_is_not_flagged_when_something_was_heard_in_place_of_the_skipped_words():
    events = _read_segment(_tracker(), 0, "grr brr he lit the great lamp and watched the ships")

    assert _flags(events) == []


def test_skipping_ahead_flags_the_words_passed_over():
    events = _read_segment(_tracker(), 0, "he lit the great lamp and watched the ships")

    assert _flags(events) == [("skipped", 0, 10, "")]


def test_a_seek_is_the_narrator_moving_and_is_never_flagged():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral stairs")

    events = tracker.reset_to(0, 1.0) + _read_segment(tracker, 1, "the old lighthouse keeper climbed the spiral")

    assert _flags(events) == []
    assert events[0]["jump"] == "restart"


def test_flags_wait_for_the_segment_to_close_and_follow_its_position_events():
    tracker = _tracker()
    heard = "the old lighthouse keeper climbed the spiral chairs each evening"

    before_end = list(tracker.feed(_partial(0, heard), 0.0))
    for word in heard.split():
        before_end += tracker.feed(_word(0, word), 0.0)
    at_end = tracker.feed({"type": "segment_end", "segment": 0}, 0.0)

    assert _flags(before_end) == []
    assert [event["type"] for event in at_end] == ["flag"]


def test_flag_events_carry_an_increasing_id_and_the_script_word_span():
    tracker = _tracker()

    first = _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral chairs each evening")
    second = _read_segment(tracker, 1, "he lit the great lamp and watched the ships pass nobody thanked him")

    flag_events = [e for e in first + second if e["type"] == "flag"]
    assert flag_events == [
        {"type": "flag", "id": 1, "kind": "misread", "start": 7, "end": 8, "heard": "chairs"},
        {"type": "flag", "id": 2, "kind": "skipped", "start": 21, "end": 22, "heard": ""},
    ]


def test_spans_are_reported_in_script_words_positions_across_punctuation_only_tokens():
    tracker = flags.FlaggingTracker(["one", "two", "—", "three", "four", "five", "six"])

    events = _read_segment(tracker, 0, "one two three four sticks six")

    assert _flags(events) == [("misread", 5, 6, "sticks")]


def test_half_of_a_word_the_engine_split_is_not_an_extra():
    events = _read_segment(_tracker("It was a so-called lighthouse on the old hill."), 0, "it was a so called lighthouse on the old hill")

    assert _flags(events) == []


VOCABULARY = st.sampled_from(["the", "old", "lamp", "keeper", "climbed", "stairs", "lighthouse", "um", "ships", "pass", "night", "sea", "—"])
WORD = VOCABULARY | st.text(alphabet="abcd'-", min_size=1, max_size=6)


@st.composite
def reading_stream(draw):
    """A script and confirmed-word segments drawn from anywhere in it, with some words swapped, so the
    stream holds misreads, skips, extras, restarts and skips ahead as well as clean reading."""
    script = draw(st.lists(WORD, min_size=4, max_size=40))
    segments = []
    for _ in range(draw(st.integers(min_value=0, max_value=6))):
        offset = draw(st.integers(min_value=0, max_value=len(script)))
        span = script[offset : offset + draw(st.integers(min_value=0, max_value=12))]
        segments.append([word if draw(st.booleans()) else draw(WORD) for word in span])
    return script, segments


@settings(max_examples=200)
@given(reading_stream())
def test_every_flag_is_a_known_kind_inside_the_script_with_ids_counting_from_one(stream):
    script, segments = stream
    tracker = flags.FlaggingTracker(script)
    raised = []
    for segment, words in enumerate(segments):
        for word in words:
            raised += tracker.feed(_word(segment, word), 0.0)
        raised += tracker.feed({"type": "segment_end", "segment": segment}, 0.0)
    raised = [event for event in raised if event["type"] == "flag"]
    for event in raised:
        hypothesis.event(f"kind={event['kind']}")
        assert event["kind"] in flags.FLAG_KINDS
        assert 0 <= event["start"] <= event["end"] <= len(script)
        assert (event["start"] == event["end"]) == (event["kind"] == "extra")
        assert (event["heard"] == "") == (event["kind"] == "skipped")
    assert [event["id"] for event in raised] == list(range(1, len(raised) + 1))


def test_each_flag_kind_maps_onto_a_findings_category_the_findings_contract_accepts():
    assert flags.FINDING_CATEGORIES == {
        "misread": "transcript_discrepancy",
        "extra": "transcript_discrepancy",
        "skipped": "transcript_discrepancy",
        "restart": "pickup",
    }
