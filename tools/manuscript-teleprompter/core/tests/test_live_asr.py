import importlib.util
from pathlib import Path

import numpy as np
import pytest

LIVE_ASR_PATH = Path(__file__).resolve().parents[1] / "live_asr.py"
SPEC = importlib.util.spec_from_file_location("live_asr", LIVE_ASR_PATH)
live_asr = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(live_asr)


def _chunks(total_samples, chunk_size=1600):
    """1.0s worth of chunks per call at 16kHz by default (chunk_size=1600 => 0.1s)."""
    audio = np.arange(total_samples, dtype=np.float32)
    for start in range(0, total_samples, chunk_size):
        yield audio[start : start + chunk_size]


def test_segment_stream_flushes_as_soon_as_a_later_speech_span_confirms_a_pause():
    # First VAD check (buffer len 1600): one open span still touching the end -> no flush.
    # Second check (buffer len 3200): a second span appears, so the first (end=1000) is closed.
    calls = iter(
        [
            [{"start": 0, "end": 1600}],
            [{"start": 0, "end": 1000}, {"start": 2000, "end": 3200}],
        ]
    )

    def fake_detect(buffer, vad_options, sampling_rate):
        return next(calls)

    segments = list(live_asr.segment_stream(_chunks(3200), max_buffer_seconds=999, detect_speech=fake_detect))

    assert segments[0].start_time == 0.0
    assert len(segments[0].audio) == 1000


def test_segment_stream_carries_the_remainder_into_the_next_segments_start_time():
    calls = iter(
        [
            [{"start": 0, "end": 1600}],
            [{"start": 0, "end": 1000}, {"start": 2000, "end": 3200}],
        ]
    )

    def fake_detect(buffer, vad_options, sampling_rate):
        return next(calls)

    segments = list(live_asr.segment_stream(_chunks(3200), max_buffer_seconds=999, detect_speech=fake_detect))

    assert len(segments) == 2
    assert segments[1].start_time == pytest.approx(1000 / live_asr.SAMPLE_RATE)
    assert len(segments[1].audio) == 2200


def test_segment_stream_force_flushes_when_buffer_exceeds_max_duration_without_a_pause():
    def always_open(buffer, vad_options, sampling_rate):
        return [{"start": 0, "end": len(buffer)}]

    max_seconds = 3200 / live_asr.SAMPLE_RATE
    segments = list(live_asr.segment_stream(_chunks(4800), max_buffer_seconds=max_seconds, detect_speech=always_open))

    assert [len(s.audio) for s in segments] == [3200, 1600]
    assert segments[1].start_time == pytest.approx(3200 / live_asr.SAMPLE_RATE)


def test_segment_stream_flushes_remaining_audio_once_the_input_ends():
    def never_closes(buffer, vad_options, sampling_rate):
        return [{"start": 0, "end": len(buffer)}]

    segments = list(live_asr.segment_stream(_chunks(1600), max_buffer_seconds=999, detect_speech=never_closes))

    assert len(segments) == 1
    assert len(segments[0].audio) == 1600


def test_stream_words_rebases_each_segments_word_timestamps_to_absolute_stream_time():
    segments = [
        live_asr.SpeechSegment(audio=np.ones(10, dtype=np.float32), start_time=0.0),
        live_asr.SpeechSegment(audio=np.ones(10, dtype=np.float32), start_time=5.0),
    ]

    def fake_decode(audio):
        return [("hello", 0.1, 0.4), ("world", 0.5, 0.9)]

    events = list(live_asr.stream_words(segments, fake_decode))

    assert events == [
        {"word": "hello", "start": 0.1, "end": 0.4},
        {"word": "world", "start": 0.5, "end": 0.9},
        {"word": "hello", "start": 5.1, "end": 5.4},
        {"word": "world", "start": 5.5, "end": 5.9},
    ]


def test_stream_words_skips_empty_segments_and_blank_words():
    segments = [
        live_asr.SpeechSegment(audio=np.zeros(0, dtype=np.float32), start_time=0.0),
        live_asr.SpeechSegment(audio=np.ones(5, dtype=np.float32), start_time=1.0),
    ]

    def fake_decode(audio):
        return [("", 0.0, 0.1), ("ok", 0.1, 0.2)]

    events = list(live_asr.stream_words(segments, fake_decode))

    assert events == [{"word": "ok", "start": 1.1, "end": 1.2}]
