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


def _chunks(count, size=HALF_SECOND):
    for _ in range(count):
        yield np.zeros(size, dtype=np.float32)


def _words(*texts):
    return [(text, index * 0.5, index * 0.5 + 0.4) for index, text in enumerate(texts)]


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


def test_rolling_words_emits_confirmed_words_while_speech_is_still_in_progress():
    consumed = []

    def chunks():
        for chunk in _chunks(6):
            consumed.append(1)
            yield chunk

    def always_open(buffer, vad_options, sampling_rate):
        return [{"start": 0, "end": len(buffer)}]

    def growing_hypothesis(audio):
        return _words(*["one", "two", "three", "four", "five", "six"][: len(audio) // HALF_SECOND])

    emitted_at = []
    events = []
    for event in live_asr.rolling_words(chunks(), growing_hypothesis, max_buffer_seconds=999, detect_speech=always_open):
        events.append(event)
        emitted_at.append(len(consumed))

    assert [e["word"] for e in events] == ["one", "two", "three", "four", "five", "six"]
    assert [e["start"] for e in events] == [0.0, 0.5, 1.0, 1.5, 2.0, 2.5]
    assert emitted_at[0] < 6  # the first word was confirmed before the input finished


def test_rolling_words_closes_a_segment_on_a_pause_and_rebases_the_next_one():
    scripted = iter(
        [
            [{"start": 0, "end": 8000}],  # chunk 1: open, first interim decode
            [{"start": 0, "end": 12000}],  # chunk 2: closed by trailing silence -> final decode
            [{"start": 2000, "end": 12000}],  # chunk 3: next utterance open (buffer now 12000 long)
            [{"start": 2000, "end": 20000}],  # chunk 4: still open, agrees with chunk 3's decode
            [{"start": 2000, "end": 20000}],  # end of stream: tail check
        ]
    )

    def fake_detect(buffer, vad_options, sampling_rate):
        return next(scripted)

    def fixed_hypothesis(audio):
        return [("x", 0.0, 0.2), ("y", 0.2, 0.4)]

    events = list(live_asr.rolling_words(_chunks(4), fixed_hypothesis, max_buffer_seconds=999, detect_speech=fake_detect))

    second_start = 12000 / live_asr.SAMPLE_RATE + 2000 / live_asr.SAMPLE_RATE
    assert [(e["word"], e["start"]) for e in events] == [
        ("x", 0.0),
        ("y", 0.2),
        ("x", pytest.approx(second_start, abs=1e-3)),
        ("y", pytest.approx(second_start + 0.2, abs=1e-3)),
    ]


def test_rolling_words_never_decodes_silence():
    def no_speech(buffer, vad_options, sampling_rate):
        return []

    def must_not_decode(audio):
        raise AssertionError("silence should never reach the decoder")

    max_seconds = 2 * HALF_SECOND / live_asr.SAMPLE_RATE
    events = list(live_asr.rolling_words(_chunks(5), must_not_decode, max_buffer_seconds=max_seconds, detect_speech=no_speech))

    assert events == []


def test_rolling_words_force_closes_unbroken_speech_at_the_max_buffer_length():
    def always_open(buffer, vad_options, sampling_rate):
        return [{"start": 0, "end": len(buffer)}]

    def one_word_per_half_second(audio):
        return _words(*["w"] * (len(audio) // HALF_SECOND))

    max_seconds = 2 * HALF_SECOND / live_asr.SAMPLE_RATE
    events = list(live_asr.rolling_words(_chunks(4), one_word_per_half_second, max_buffer_seconds=max_seconds, detect_speech=always_open))

    # Two 1.0s segments (force-closed), each decoding to two words; the second starts at t=1.0.
    assert [e["start"] for e in events] == [0.0, 0.5, 1.0, 1.5]


def test_with_decode_timing_logs_duration_and_passes_words_through(capsys):
    decode = live_asr.with_decode_timing(lambda audio: [("hi", 0.0, 0.1)])

    words = decode(np.zeros(live_asr.SAMPLE_RATE, dtype=np.float32))

    assert words == [("hi", 0.0, 0.1)]
    assert "decode: 1.00s audio in" in capsys.readouterr().err
