import importlib.util
from pathlib import Path

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
