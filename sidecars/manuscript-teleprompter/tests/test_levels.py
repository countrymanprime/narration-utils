"""The input level meter (levels.py, read-aloud-control-bar PRD Phase 4): peak and RMS in dBFS about ten times a second."""

import importlib.util
from pathlib import Path

import numpy as np
import pytest
from narration_common import contract_files

LEVELS_PATH = Path(__file__).resolve().parents[1] / "core" / "levels.py"
SPEC = importlib.util.spec_from_file_location("levels", LEVELS_PATH)
levels = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(levels)

RATE = levels.SAMPLE_RATE
REPORT = levels.REPORT_SAMPLES  # 100 ms


def _sine(amplitude, seconds, frequency=440.0):
    t = np.arange(int(seconds * RATE)) / RATE
    return (amplitude * np.sin(2 * np.pi * frequency * t)).astype(np.float32)


def _feed_all(meter, audio, chunk=int(0.32 * RATE)):
    events = []
    for start in range(0, len(audio), chunk):
        events.extend(meter.feed(audio[start : start + chunk]))
    return events


def test_silence_rests_at_the_floor():
    events = _feed_all(levels.LevelMeter(), np.zeros(RATE, dtype=np.float32))

    assert len(events) == 10
    assert all(event == {"type": "level", "peak": levels.FLOOR_DBFS, "rms": levels.FLOOR_DBFS} for event in events)


def test_a_half_scale_sine_reads_minus_six_peak_and_minus_nine_rms():
    events = _feed_all(levels.LevelMeter(), _sine(0.5, 1.0))

    assert len(events) == 10
    for event in events:
        assert event["peak"] == pytest.approx(-6.0, abs=0.1)
        assert event["rms"] == pytest.approx(-9.0, abs=0.1)


def test_clipping_reads_zero_and_never_above():
    audio = np.clip(_sine(2.0, 0.5), -1.5, 1.5)

    events = _feed_all(levels.LevelMeter(), audio)

    assert all(event["peak"] == 0.0 for event in events)
    assert all(event["rms"] <= 0.0 for event in events)


def test_about_ten_events_a_second_whatever_the_chunk_size():
    for chunk in (160, 1000, 5120, 16000):
        assert len(_feed_all(levels.LevelMeter(), np.zeros(3 * RATE, dtype=np.float32), chunk=chunk)) == 30


def test_a_partial_report_waits_for_the_rest_of_its_samples():
    meter = levels.LevelMeter()

    assert meter.feed(np.zeros(REPORT - 1, dtype=np.float32)) == []
    assert len(meter.feed(np.zeros(1, dtype=np.float32))) == 1


def test_rms_is_the_loudest_fifty_millisecond_window_so_a_short_burst_shows():
    quiet = np.zeros(REPORT // 2, dtype=np.float32)
    burst = _sine(0.5, 0.05)

    (event,) = levels.LevelMeter().feed(np.concatenate([quiet, burst]))

    assert event["rms"] == pytest.approx(-9.0, abs=0.2)


def test_an_empty_chunk_reports_nothing():
    assert levels.LevelMeter().feed(np.zeros(0, dtype=np.float32)) == []


def test_metered_passes_chunks_through_and_reports_their_levels():
    reported = []
    chunks = [np.zeros(REPORT, dtype=np.float32), _sine(0.5, 0.1)]

    passed = list(levels.metered(iter(chunks), levels.LevelMeter(), reported.append))

    assert len(passed) == 2
    assert [event["peak"] for event in reported] == [levels.FLOOR_DBFS, pytest.approx(-6.0, abs=0.1)]


def test_the_level_events_match_the_committed_contract_file():
    """Silence, a sine at half scale, then a clipped burst, as the sidecar reports them (ADR 0069)."""
    audio = np.concatenate([np.zeros(REPORT, dtype=np.float32), _sine(0.5, 0.1), np.clip(_sine(2.0, 0.1), -1.0, 1.0)])

    contract_files.check("teleprompter-level", levels.LevelMeter().feed(audio))
