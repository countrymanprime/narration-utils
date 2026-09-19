import importlib.util
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

LIVE_ASR_PATH = Path(__file__).resolve().parents[1] / "live_asr.py"
SPEC = importlib.util.spec_from_file_location("live_asr", LIVE_ASR_PATH)
live_asr = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(live_asr)

HALF_SECOND = live_asr.SAMPLE_RATE // 2  # 8000 samples; equals the default decode interval
NAMES = ["one", "two", "three", "four", "five", "six"]


def _chunks(count, size=HALF_SECOND):
    for _ in range(count):
        yield np.zeros(size, dtype=np.float32)


def _words(*texts):
    return [(text, index * 0.5, index * 0.5 + 0.4) for index, text in enumerate(texts)]


def _hyp(segment, texts, final=False):
    return live_asr.Hypothesis(segment=segment, words=tuple(_words(*texts)), final=final)


def _always_open(buffer, vad_options, sampling_rate):
    return [{"start": 0, "end": len(buffer)}]


def _growing_hypothesis(audio):
    return _words(*NAMES[: len(audio) // HALF_SECOND])


def test_confirm_emits_only_the_prefix_two_consecutive_decodes_agree_on():
    confirmed, committed = live_asr._confirm_agreed_words(_words("a", "b", "c"), _words("a", "b", "d"), 0)

    assert [w[0] for w in confirmed] == ["a", "b"]
    assert committed == 2


def test_confirm_ignores_case_and_punctuation_when_comparing():
    confirmed, committed = live_asr._confirm_agreed_words(_words("Hello,", "world"), _words("hello", "world."), 0)

    assert [w[0] for w in confirmed] == ["hello", "world."]
    assert committed == 2


def test_confirm_does_not_re_emit_already_committed_words():
    confirmed, committed = live_asr._confirm_agreed_words(_words("a", "b", "c"), _words("a", "b", "c"), 2)

    assert [w[0] for w in confirmed] == ["c"]
    assert committed == 3


def test_confirm_emits_nothing_when_agreement_has_not_passed_the_committed_count():
    confirmed, committed = live_asr._confirm_agreed_words(_words("a", "x"), _words("a", "y"), 2)

    assert confirmed == []
    assert committed == 2


def test_whisper_hypotheses_yield_in_progress_hypotheses_before_the_input_finishes():
    consumed = []

    def chunks():
        for chunk in _chunks(6):
            consumed.append(1)
            yield chunk

    seen_at = []
    hypotheses = []
    for hypothesis in live_asr.whisper_hypotheses(chunks(), _growing_hypothesis, max_buffer_seconds=999, detect_speech=_always_open):
        hypotheses.append(hypothesis)
        seen_at.append(len(consumed))

    assert [h.final for h in hypotheses] == [False] * 6 + [True]
    assert [len(h.words) for h in hypotheses] == [1, 2, 3, 4, 5, 6, 6]
    assert seen_at[0] < 6  # the first hypothesis arrived before the input finished


def test_whisper_hypotheses_close_a_segment_on_a_pause_and_rebase_the_next_one():
    scripted = iter(
        [
            [{"start": 0, "end": 8000}],  # chunk 1: open, first interim decode
            [{"start": 0, "end": 12000}],  # chunk 2: closed by trailing silence -> final decode
            [{"start": 2000, "end": 12000}],  # chunk 3: next utterance open (buffer now 12000 long)
            [{"start": 2000, "end": 20000}],  # chunk 4: still open
            [{"start": 2000, "end": 20000}],  # end of stream: tail check
        ]
    )

    def fake_detect(buffer, vad_options, sampling_rate):
        return next(scripted)

    def fixed_hypothesis(audio):
        return [("x", 0.0, 0.2), ("y", 0.2, 0.4)]

    hypotheses = list(live_asr.whisper_hypotheses(_chunks(4), fixed_hypothesis, max_buffer_seconds=999, detect_speech=fake_detect))

    assert [(h.segment, h.final) for h in hypotheses] == [(0, False), (0, True), (1, False), (1, False), (1, True)]
    assert [w[1] for w in hypotheses[1].words] == [0.0, 0.2]
    second_start = 12000 / live_asr.SAMPLE_RATE + 2000 / live_asr.SAMPLE_RATE
    assert hypotheses[-1].words[0][1] == pytest.approx(second_start, abs=1e-3)


def test_whisper_hypotheses_never_decode_silence():
    def no_speech(buffer, vad_options, sampling_rate):
        return []

    def must_not_decode(audio):
        raise AssertionError("silence should never reach the decoder")

    max_seconds = 2 * HALF_SECOND / live_asr.SAMPLE_RATE
    hypotheses = list(live_asr.whisper_hypotheses(_chunks(5), must_not_decode, max_buffer_seconds=max_seconds, detect_speech=no_speech))

    assert hypotheses == []


def test_whisper_hypotheses_force_close_unbroken_speech_at_the_max_buffer_length():
    def one_word_per_half_second(audio):
        return _words(*["w"] * (len(audio) // HALF_SECOND))

    max_seconds = 2 * HALF_SECOND / live_asr.SAMPLE_RATE
    hypotheses = list(live_asr.whisper_hypotheses(_chunks(4), one_word_per_half_second, max_buffer_seconds=max_seconds, detect_speech=_always_open))

    finals = [h for h in hypotheses if h.final]
    assert [h.segment for h in finals] == [0, 1]
    # Two 1.0s segments (force-closed), each two words; the second starts at t=1.0.
    assert [w[1] for h in finals for w in h.words] == [0.0, 0.5, 1.0, 1.5]


def test_confirmed_events_interleave_partials_confirmed_words_and_the_segment_end():
    hypotheses = [_hyp(0, ["a"]), _hyp(0, ["a", "b"]), _hyp(0, ["a", "b", "c"]), _hyp(0, ["a", "b", "c", "d"], final=True)]

    events = list(live_asr.confirmed_events(hypotheses))

    assert [(e["type"], e.get("word")) for e in events] == [
        ("partial", None),
        ("partial", None),
        ("word", "a"),
        ("partial", None),
        ("word", "b"),
        ("word", "c"),
        ("word", "d"),
        ("segment_end", None),
    ]


def test_confirmed_events_carry_the_full_current_hypothesis_in_each_partial():
    events = list(live_asr.confirmed_events([_hyp(0, ["a", "b"])]))

    assert events == [{"type": "partial", "segment": 0, "words": [{"word": "a", "start": 0.0, "end": 0.4}, {"word": "b", "start": 0.5, "end": 0.9}]}]


def test_event_words_never_end_before_they_start_even_if_the_engine_says_so():
    inverted = (("a", 2.0, 1.5),)
    hypotheses = [live_asr.Hypothesis(0, inverted, final=False), live_asr.Hypothesis(0, inverted, final=True)]

    events = list(live_asr.confirmed_events(hypotheses))

    assert events[0]["words"][0] == {"word": "a", "start": 2.0, "end": 2.0}
    assert next(e for e in events if e["type"] == "word")["end"] == 2.0


def test_confirmed_events_reset_agreement_between_segments():
    hypotheses = [
        _hyp(0, ["a", "b", "c"]),
        _hyp(0, ["a", "b", "c"]),
        _hyp(0, ["a", "b", "c"], final=True),
        _hyp(1, ["x"]),
        _hyp(1, ["x"]),
    ]

    events = list(live_asr.confirmed_events(hypotheses))

    words = [(e["segment"], e["word"]) for e in events if e["type"] == "word"]
    assert words == [(0, "a"), (0, "b"), (0, "c"), (1, "x")]


def test_confirmed_events_emit_every_word_exactly_once_when_a_segment_closes_early():
    events = list(live_asr.confirmed_events([_hyp(0, ["a", "b"]), _hyp(0, ["a", "b"], final=True)]))

    assert [e["word"] for e in events if e["type"] == "word"] == ["a", "b"]
    assert events[-1] == {"type": "segment_end", "segment": 0}


def test_whisper_events_stream_partials_then_words_then_a_segment_end():
    events = list(live_asr.whisper_events(_chunks(6), _growing_hypothesis, max_buffer_seconds=999, detect_speech=_always_open))

    types = [e["type"] for e in events]
    assert types[0] == "partial"
    assert types[-1] == "segment_end"
    assert [e["word"] for e in events if e["type"] == "word"] == NAMES
    assert [e["start"] for e in events if e["type"] == "word"] == [0.0, 0.5, 1.0, 1.5, 2.0, 2.5]


class LineTextChanged:
    def __init__(self, line):
        self.line = line


class LineCompleted:
    def __init__(self, line):
        self.line = line


class LineStarted:
    def __init__(self, line):
        self.line = line


def _line(line_id, text, start=0.0, duration=1.0, timings=None):
    words = None if timings is None else [SimpleNamespace(word=w, start=s, end=e) for w, s, e in timings]
    return SimpleNamespace(line_id=line_id, text=text, start_time=start, duration=duration, words=words)


class FakeTranscriber:
    """Stands in for moonshine_voice.Transcriber: events fire synchronously
    inside add_audio (keyed by call number) and stop (key "stop")."""

    def __init__(self, script):
        self.script = script
        self.calls = 0
        self.calls_log = []
        self.listener = None

    def add_listener(self, listener):
        self.listener = listener
        self.calls_log.append("add_listener")

    def start(self):
        self.calls_log.append("start")

    def add_audio(self, samples, sample_rate):
        self.calls += 1
        self.calls_log.append(("add_audio", len(samples), sample_rate))
        for event in self.script.get(self.calls, []):
            self.listener(event)

    def stop(self):
        self.calls_log.append("stop")
        for event in self.script.get("stop", []):
            self.listener(event)


HELLO = [("hello", 1.0, 1.4)]
HELLO_WORLD = [("hello", 1.0, 1.4), ("world", 1.5, 1.9)]


def test_moonshine_hypotheses_map_line_events_to_partial_and_final_hypotheses():
    script = {
        1: [LineTextChanged(_line(900, "hello", timings=HELLO))],
        2: [LineTextChanged(_line(900, "hello world", timings=HELLO_WORLD))],
        3: [LineCompleted(_line(900, "hello world", timings=HELLO_WORLD))],
    }

    hypotheses = list(live_asr.moonshine_hypotheses(_chunks(3), FakeTranscriber(script)))

    assert [(h.segment, h.final, [w[0] for w in h.words]) for h in hypotheses] == [
        (0, False, ["hello"]),
        (0, False, ["hello", "world"]),
        (0, True, ["hello", "world"]),
    ]
    assert hypotheses[1].words[1] == ("world", 1.5, 1.9)


def test_moonshine_hypotheses_number_segments_in_order_of_first_appearance():
    script = {
        1: [LineCompleted(_line(9_000_000_000_000_000_001, "one", timings=[("one", 0.0, 0.3)]))],
        2: [LineTextChanged(_line(4_000_000_000_000_000_002, "two", start=1.0, timings=[("two", 1.0, 1.3)]))],
        3: [LineCompleted(_line(4_000_000_000_000_000_002, "two", start=1.0, timings=[("two", 1.0, 1.3)]))],
    }

    hypotheses = list(live_asr.moonshine_hypotheses(_chunks(3), FakeTranscriber(script)))

    assert [(h.segment, h.final) for h in hypotheses] == [(0, True), (1, False), (1, True)]


def test_moonshine_hypotheses_are_yielded_while_audio_is_still_being_fed():
    consumed = []

    def chunks():
        for chunk in _chunks(3):
            consumed.append(1)
            yield chunk

    script = {1: [LineTextChanged(_line(1, "hello", timings=HELLO))]}

    first = next(live_asr.moonshine_hypotheses(chunks(), FakeTranscriber(script)))

    assert first.words[0][0] == "hello"
    assert len(consumed) == 1


def test_moonshine_hypotheses_skip_empty_partials_but_keep_an_empty_final():
    script = {
        1: [LineStarted(_line(1, "", duration=0.0)), LineTextChanged(_line(1, "", duration=0.0))],
        2: [LineCompleted(_line(1, "", duration=0.0))],
    }

    hypotheses = list(live_asr.moonshine_hypotheses(_chunks(2), FakeTranscriber(script)))

    assert [(h.final, h.words) for h in hypotheses] == [(True, ())]


def test_moonshine_hypotheses_flush_lines_completed_by_stop():
    script = {
        1: [LineTextChanged(_line(1, "hello", timings=HELLO))],
        "stop": [LineCompleted(_line(1, "hello", timings=HELLO))],
    }

    hypotheses = list(live_asr.moonshine_hypotheses(_chunks(1), FakeTranscriber(script)))

    assert [h.final for h in hypotheses] == [False, True]


def test_moonshine_hypotheses_start_before_audio_and_stop_after_it():
    transcriber = FakeTranscriber({})

    list(live_asr.moonshine_hypotheses(_chunks(2), transcriber))

    assert transcriber.calls_log == [
        "add_listener",
        "start",
        ("add_audio", HALF_SECOND, live_asr.SAMPLE_RATE),
        ("add_audio", HALF_SECOND, live_asr.SAMPLE_RATE),
        "stop",
    ]


def test_moonshine_words_are_stripped_and_blank_ones_dropped():
    script = {1: [LineTextChanged(_line(1, "hi there", timings=[(" hi ", 0.0, 0.2), ("", 0.2, 0.3), ("there", 0.3, 0.6)]))]}

    hypothesis = next(live_asr.moonshine_hypotheses(_chunks(1), FakeTranscriber(script)))

    assert [w[0] for w in hypothesis.words] == ["hi", "there"]


def test_moonshine_falls_back_to_evenly_spaced_words_when_the_line_has_no_timings():
    script = {1: [LineTextChanged(_line(1, "a b", start=2.0, duration=1.0, timings=None))]}

    hypothesis = next(live_asr.moonshine_hypotheses(_chunks(1), FakeTranscriber(script)))

    assert hypothesis.words == (("a", 2.0, 2.5), ("b", 2.5, 3.0))


def test_moonshine_keeps_a_word_the_timing_list_omitted_using_the_texts_words():
    line = _line(1, "The ancient artifact", start=1.0, duration=2.0, timings=[("The", 1.0, 1.4), ("ancient", 1.4, 2.0)])

    words = live_asr._moonshine_words(line)

    assert words == (("The", 1.0, 1.4), ("ancient", 1.4, 2.0), ("artifact", 2.0, 3.0))


def test_moonshine_words_keep_the_texts_punctuation_and_the_timings():
    line = _line(1, "Hello, world.", timings=[("Hello", 0.1, 0.5), ("world", 0.6, 0.9)])

    assert live_asr._moonshine_words(line) == (("Hello,", 0.1, 0.5), ("world.", 0.6, 0.9))


def test_moonshine_interpolates_a_word_missing_from_the_middle_of_the_timing_list():
    line = _line(1, "a x b", start=0.0, duration=3.0, timings=[("a", 0.0, 1.0), ("b", 2.0, 3.0)])

    assert live_asr._moonshine_words(line) == (("a", 0.0, 1.0), ("x", 1.0, 2.0), ("b", 2.0, 3.0))


def test_moonshine_ignores_timed_words_that_are_not_in_the_text():
    line = _line(1, "a b", timings=[("a", 0.0, 0.5), ("stray", 0.5, 0.7), ("b", 0.7, 1.0)])

    assert live_asr._moonshine_words(line) == (("a", 0.0, 0.5), ("b", 0.7, 1.0))


def test_moonshine_hypotheses_feed_the_shared_event_layer_like_any_other_engine():
    script = {
        1: [LineTextChanged(_line(7, "hello", timings=HELLO))],
        2: [LineTextChanged(_line(7, "hello world", timings=HELLO_WORLD))],
        3: [LineCompleted(_line(7, "hello world", timings=HELLO_WORLD))],
    }

    events = list(live_asr.confirmed_events(live_asr.moonshine_hypotheses(_chunks(3), FakeTranscriber(script))))

    assert [(e["type"], e.get("word")) for e in events] == [
        ("partial", None),
        ("partial", None),
        ("word", "hello"),
        ("word", "world"),
        ("segment_end", None),
    ]


def test_stream_clock_for_a_file_counts_the_audio_consumed_so_far():
    clock = live_asr.StreamClock()

    clock.note_chunk(np.zeros(HALF_SECOND, dtype=np.float32))
    clock.note_chunk(np.zeros(HALF_SECOND, dtype=np.float32))

    assert clock.now() == pytest.approx(1.0)


def test_stream_clock_for_a_mic_is_wall_time_since_capture_began():
    clock = live_asr.StreamClock(capture_started=10.0, time_fn=lambda: 12.5)

    clock.note_chunk(np.zeros(HALF_SECOND, dtype=np.float32))

    assert clock.now() == pytest.approx(2.5)


def test_ticking_reports_the_clock_after_each_chunk_and_passes_chunks_through():
    clock = live_asr.StreamClock()
    ticks = []

    passed = list(live_asr.ticking(_chunks(3), clock, ticks.append))

    assert len(passed) == 3
    assert ticks == pytest.approx([0.5, 1.0, 1.5])


def test_event_lag_is_measured_from_the_end_of_the_newest_word_carried():
    word = {"type": "word", "segment": 0, "word": "a", "start": 1.0, "end": 1.4}
    partial = {"type": "partial", "segment": 0, "words": [{"word": "a", "start": 1.0, "end": 1.4}, {"word": "b", "start": 1.5, "end": 1.9}]}

    assert live_asr.event_lag_seconds(word, 2.0) == pytest.approx(0.6)
    assert live_asr.event_lag_seconds(partial, 2.5) == pytest.approx(0.6)


def test_event_lag_is_none_for_events_that_carry_no_words():
    assert live_asr.event_lag_seconds({"type": "partial", "segment": 0, "words": []}, 2.0) is None
    assert live_asr.event_lag_seconds({"type": "segment_end", "segment": 0}, 2.0) is None


def test_with_decode_timing_logs_duration_and_passes_words_through(capsys):
    decode = live_asr.with_decode_timing(lambda audio: [("hi", 0.0, 0.1)])

    words = decode(np.zeros(live_asr.SAMPLE_RATE, dtype=np.float32))

    assert words == [("hi", 0.0, 0.1)]
    assert "decode: 1.00s audio in" in capsys.readouterr().err
