import importlib.util
from pathlib import Path

import pytest

TRACKER_PATH = Path(__file__).resolve().parents[1] / "core" / "script_tracker.py"
SPEC = importlib.util.spec_from_file_location("script_tracker", TRACKER_PATH)
tracker_module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(tracker_module)

SCRIPT = "The old lighthouse keeper climbed the spiral stairs each evening. He lit the great lamp and watched the ships pass. Nobody ever thanked him for it."
# 0 The 1 old 2 lighthouse 3 keeper 4 climbed 5 the 6 spiral 7 stairs 8 each 9 evening.
# 10 He 11 lit 12 the 13 great 14 lamp 15 and 16 watched 17 the 18 ships 19 pass.
# 20 Nobody 21 ever 22 thanked 23 him 24 for 25 it.


def _norm(text):
    return [tracker_module.normalize_word(w) for w in text.split()]


def _tracker():
    return tracker_module.ScriptTracker(tracker_module.script_words(SCRIPT))


def _partial(segment, text):
    return {"type": "partial", "segment": segment, "words": [{"word": w, "start": 0.0, "end": 0.1} for w in text.split()]}


def _word(segment, text):
    return {"type": "word", "segment": segment, "word": text, "start": 0.0, "end": 0.1}


def _end(segment):
    return {"type": "segment_end", "segment": segment}


def _read_segment(tracker, segment, text, now=0.0):
    """Feed a whole segment the way an engine would: a partial, each word
    confirmed, then the segment end. Returns all position events."""
    events = list(tracker.feed(_partial(segment, text), now))
    for word in text.split():
        events += tracker.feed(_word(segment, word), now)
    events += tracker.feed(_end(segment), now)
    return events


def test_script_words_split_on_whitespace_and_keep_punctuation():
    assert tracker_module.script_words("The old\nlighthouse  keeper.") == ["The", "old", "lighthouse", "keeper."]


def test_words_match_ignoring_case_and_punctuation():
    assert tracker_module.words_match(tracker_module.normalize_word("Evening."), tracker_module.normalize_word("evening"))


def test_words_match_close_spellings_of_longer_words_but_not_short_or_unrelated_ones():
    assert tracker_module.words_match("stairs", "stair")
    assert tracker_module.words_match("keeper", "keepers")
    assert not tracker_module.words_match("lamp", "lump")
    assert not tracker_module.words_match("the", "then")


def test_advance_follows_the_script_in_order():
    result = tracker_module.advance(_norm("the old lighthouse keeper"), _norm(SCRIPT), 0)

    assert (result.read, result.matched, result.first) == (4, 4, 0)


def test_advance_ignores_inserted_words_that_are_not_in_the_script():
    result = tracker_module.advance(_norm("the old um lighthouse"), _norm(SCRIPT), 0)

    assert (result.read, result.matched) == (3, 3)


def test_advance_steps_over_a_script_word_that_was_misread_or_skipped():
    result = tracker_module.advance(_norm("the lighthouse keeper"), _norm(SCRIPT), 0)

    assert (result.read, result.matched) == (4, 3)


def test_advance_will_not_skip_more_than_the_allowed_number_of_script_words():
    result = tracker_module.advance(_norm("the climbed"), _norm(SCRIPT), 0)

    assert (result.read, result.matched) == (1, 1)


def test_partials_move_the_cursor_forward_as_more_words_are_heard():
    tracker = _tracker()

    first = tracker.feed(_partial(0, "the"), 1.0)
    second = tracker.feed(_partial(0, "the old lighthouse"), 1.5)

    assert [e["read"] for e in first + second] == [1, 3]
    assert second[0]["type"] == "position"


def test_a_garbage_first_word_does_not_block_the_cursor():
    tracker = _tracker()

    events = tracker.feed(_partial(0, "they're old lighthouse"), 1.0)

    assert events[-1]["read"] == 3


def test_partials_never_move_the_cursor_backward():
    tracker = _tracker()
    tracker.feed(_partial(0, "the old lighthouse"), 1.0)

    assert tracker.feed(_partial(0, "the"), 1.5) == []


def test_repeating_the_same_partial_emits_nothing_new():
    tracker = _tracker()
    tracker.feed(_partial(0, "the old"), 1.0)

    assert tracker.feed(_partial(0, "the old"), 1.2) == []


def test_confirmed_words_advance_the_committed_position_behind_the_speculative_one():
    tracker = _tracker()
    tracker.feed(_partial(0, "the old lighthouse"), 1.0)

    events = tracker.feed(_word(0, "the"), 1.1) + tracker.feed(_word(0, "old"), 1.2)

    assert [(e["read"], e["committed"]) for e in events] == [(3, 1), (3, 2)]


def test_the_next_segment_continues_from_where_the_last_one_was_committed():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper")

    events = tracker.feed(_partial(1, "climbed the"), 3.0)

    assert events[-1]["read"] == 6


def test_a_restart_of_an_earlier_sentence_moves_the_cursor_back():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral stairs")

    events = tracker.feed(_partial(1, "the old lighthouse keeper climbed"), 4.0)

    assert events[-1]["read"] == 5
    assert events[-1]["jump"] == "restart"


def test_a_jump_is_reported_once_and_later_partials_in_the_segment_just_advance():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral stairs")
    tracker.feed(_partial(1, "the old lighthouse keeper climbed"), 4.0)

    events = tracker.feed(_partial(1, "the old lighthouse keeper climbed the spiral"), 4.5)

    assert events[-1]["read"] == 7
    assert events[-1]["jump"] is None


def test_skipping_ahead_in_the_script_is_a_jump_that_reports_the_skipped_span():
    tracker = _tracker()

    events = tracker.feed(_partial(0, "he lit the great lamp"), 1.0)

    assert events[-1]["read"] == 15
    assert events[-1]["jump"] == "skip"
    assert events[-1]["skipped"] == [0, 10]


def test_a_single_word_that_appears_elsewhere_in_the_script_is_not_enough_to_jump():
    tracker = _tracker()

    assert tracker.feed(_partial(0, "lamp"), 1.0) == []


def test_status_becomes_waiting_after_a_pause_and_listening_again_on_progress():
    tracker = _tracker()
    tracker.feed(_partial(0, "the old"), 1.0)

    assert tracker.tick(2.0) == []
    waiting = tracker.tick(3.0)
    resumed = tracker.feed(_partial(0, "the old lighthouse"), 3.2)

    assert [e["status"] for e in waiting] == ["waiting"]
    assert resumed[-1]["status"] == "listening"


def test_status_is_done_when_the_whole_script_has_been_read():
    tracker = tracker_module.ScriptTracker(["a", "b"])

    events = tracker.feed(_partial(0, "a b"), 1.0)

    assert events[-1]["read"] == 2
    assert events[-1]["status"] == "done"


def test_punctuation_only_script_tokens_are_passed_over_transparently():
    tracker = tracker_module.ScriptTracker(["a", "—", "b", "c"])

    assert tracker.feed(_partial(0, "a"), 1.0)[-1]["read"] == 2
    assert tracker.feed(_partial(0, "a b c"), 1.5)[-1]["read"] == 4


def test_a_noisy_recorded_style_partial_sequence_ends_at_the_right_place():
    tracker = _tracker()
    partials = ["okay", "the old light", "the old lighthouse keeper", "the old lighthouse keeper climbed the", "the old lighthouse keeper climbed the spiral"]

    reads = [e["read"] for text in partials for e in tracker.feed(_partial(0, text), 1.0)]

    assert reads == sorted(reads)
    assert reads[-1] == 7


@pytest.mark.parametrize("event", [{"type": "segment_end", "segment": 0}, {"type": "unknown"}])
def test_events_that_do_not_change_anything_produce_no_position_events(event):
    assert _tracker().feed(event, 1.0) == []


def test_reset_to_jumps_forward_and_reports_it_as_a_restart():
    tracker = _tracker()

    events = tracker.reset_to(15, 1.0)

    assert [(e["read"], e["committed"], e["jump"]) for e in events] == [(15, 15, "restart")]


def test_reset_to_jumps_back_by_one_word():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed")

    events = tracker.reset_to(4, 2.0)

    assert [(e["read"], e["committed"], e["jump"]) for e in events] == [(4, 4, "restart")]


def test_reset_to_jumps_back_by_many_words():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse keeper climbed the spiral stairs each evening")

    events = tracker.reset_to(0, 3.0)

    assert [(e["read"], e["committed"], e["jump"]) for e in events] == [(0, 0, "restart")]


def test_reset_to_clamps_an_out_of_range_word_to_the_end_of_the_script():
    tracker = _tracker()
    total = len(tracker_module.script_words(SCRIPT))

    events = tracker.reset_to(total + 500, 1.0)

    assert events[-1]["read"] == total
    assert events[-1]["jump"] == "restart"
    assert events[-1]["status"] == "done"


def test_reset_to_clamps_a_negative_word_to_the_start():
    tracker = _tracker()

    events = tracker.reset_to(-5, 1.0)

    assert events[-1]["read"] == 0


def test_reset_to_reports_again_even_when_the_word_does_not_change():
    tracker = _tracker()
    tracker.reset_to(4, 1.0)

    events = tracker.reset_to(4, 2.0)

    assert [(e["read"], e["jump"]) for e in events] == [(4, "restart")]


def test_reading_continues_normally_after_a_reset_to_seek():
    tracker = _tracker()
    tracker.reset_to(10, 1.0)

    events = tracker.feed(_partial(0, "lit the great lamp"), 2.0)

    assert events[-1]["read"] == 15
    assert events[-1]["jump"] is None


def test_align_reports_the_script_word_each_heard_word_matched_or_none():
    matches = tracker_module.align(_norm("the old um lighthouse climbed"), _norm(SCRIPT), 0)

    assert matches == (0, 1, None, 2, 4)


def test_locate_reports_the_start_and_first_match_of_the_alignment_it_chose():
    near = tracker_module.locate(_norm("the old lighthouse"), _norm(SCRIPT), 0)
    ahead = tracker_module.locate(_norm("he lit the great lamp"), _norm(SCRIPT), 0)

    assert (near.start, near.first) == (0, 0)
    assert ahead.jump == "skip"
    assert ahead.first == 10
    assert ahead.start <= ahead.first


def test_a_closed_segment_is_handed_over_once_with_its_confirmed_words_and_anchor():
    tracker = _tracker()
    _read_segment(tracker, 0, "The old lighthouse")

    reading = tracker.take_closed_segment()

    assert reading.heard == ("the", "old", "lighthouse")
    assert reading.heard_raw == ("The", "old", "lighthouse")
    assert reading.heard_times == ((0.0, 0.1), (0.0, 0.1), (0.0, 0.1))
    assert reading.anchor == 0
    assert reading.location.read == 3
    assert tracker.take_closed_segment() is None


def test_a_segment_with_no_confirmed_words_hands_nothing_over():
    tracker = _tracker()
    tracker.feed(_partial(0, "the old"), 1.0)
    tracker.feed(_end(0), 1.2)

    assert tracker.take_closed_segment() is None


def test_a_seek_discards_a_closed_segment_nobody_took():
    tracker = _tracker()
    _read_segment(tracker, 0, "the old lighthouse")

    tracker.reset_to(10, 2.0)

    assert tracker.take_closed_segment() is None


def test_original_index_maps_a_filtered_position_back_to_a_script_words_index():
    tracker = tracker_module.ScriptTracker(["a", "—", "b"])

    assert [tracker.original_index(position) for position in (0, 1, 2)] == [0, 2, 3]
