"""The built-in recorder's core (native-recording-suite P1, ADR 0357): WAV writing, framing, metering and the recorder's
dropout accounting, all against synthetic input, so none of it needs a device."""

import math
import threading
import wave

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from narration_common.recording import (
    FLOOR_DBFS,
    Framer,
    LevelMeter,
    LinearResampler,
    Recorder,
    SyntheticSource,
    WavFullError,
    WavWriter,
    dbfs,
    downmix,
    read_wav_header,
    synthetic_tone,
)
from narration_common.recording import wav as wav_module
from narration_common.recording.wav import from_pcm, to_pcm


def _read(path):
    with wave.open(str(path), "rb") as handle:
        return handle.getframerate(), handle.getnchannels(), handle.getsampwidth(), handle.readframes(handle.getnframes())


# --- WAV --------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("bits", [16, 24])
@pytest.mark.parametrize("channels", [1, 2])
def test_a_take_is_a_pcm_wav_that_pythons_wave_reads_back_bit_exact(tmp_path, bits, channels):
    frames = synthetic_tone(0, 4800, 48000, channels)
    path = tmp_path / "take.wav"
    with WavWriter(path, 48000, channels, bits) as writer:
        writer.write(frames[:1000])
        writer.write(frames[1000:])

    rate, got_channels, width, raw = _read(path)
    assert (rate, got_channels, width) == (48000, channels, bits // 8)
    assert raw == to_pcm(frames, bits)
    step = 1 / (1 << (bits - 1))
    assert np.max(np.abs(from_pcm(raw, bits, channels) - frames)) <= step / 2 + 1e-9


def test_24_bit_samples_keep_their_sign_and_full_scale_is_clipped():
    samples = np.array([[0.0], [1.0], [-1.0], [2.0], [-2.0], [0.5], [-0.5], [np.nan]], dtype=np.float32)
    back = from_pcm(to_pcm(samples, 24), 24, 1)[:, 0]
    top = ((1 << 23) - 1) / (1 << 23)
    assert back.tolist() == pytest.approx([0.0, top, -1.0, top, -1.0, 0.5, -0.5, 0.0])


def test_the_header_is_patched_while_recording_so_a_crash_leaves_a_readable_file(tmp_path):
    path = tmp_path / "take.wav"
    writer = WavWriter(path, 8000, 1, 16, header_interval=0.25)
    writer.write(np.zeros(1000, dtype=np.float32))  # 0.125 s: not yet patched
    assert read_wav_header(path).data_bytes == 0
    writer.write(np.zeros(1000, dtype=np.float32))  # 0.25 s: patched
    header = read_wav_header(path)
    assert (header.data_bytes, header.riff_bytes, header.frames) == (4000, 4036, 2000)
    writer.close()


def test_close_writes_the_final_sizes_and_is_idempotent(tmp_path):
    path = tmp_path / "take.wav"
    writer = WavWriter(path, 44100, 2, 24)
    writer.write(np.zeros((441, 2), dtype=np.float32))
    writer.close()
    writer.close()
    header = read_wav_header(path)
    assert (header.sample_rate, header.channels, header.bits, header.frames) == (44100, 2, 24, 441)
    assert path.stat().st_size == 44 + 441 * 6
    assert writer.seconds == pytest.approx(0.01)
    with pytest.raises(ValueError, match="closed"):
        writer.write(np.zeros((1, 2), dtype=np.float32))


def test_a_take_never_overwrites_an_existing_file(tmp_path):
    path = tmp_path / "take.wav"
    path.write_bytes(b"the narrator's earlier take")
    with pytest.raises(FileExistsError):
        WavWriter(path, 48000, 1)
    assert path.read_bytes() == b"the narrator's earlier take"


def test_an_error_inside_the_with_block_still_leaves_a_finished_file(tmp_path):
    path = tmp_path / "take.wav"
    with pytest.raises(RuntimeError), WavWriter(path, 16000, 1, 16) as writer:
        writer.write(np.full(160, 0.5, dtype=np.float32))
        raise RuntimeError("the app crashed mid-take")
    assert read_wav_header(path).frames == 160


def test_a_full_file_keeps_what_fits_closes_and_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(wav_module, "MAX_RIFF_BYTES", 36 + 10 * 3)  # room for ten 24-bit mono frames
    path = tmp_path / "take.wav"
    writer = WavWriter(path, 48000, 1, 24)
    assert writer.write(np.zeros(6, dtype=np.float32)) == 6
    with pytest.raises(WavFullError, match="4 GiB"):
        writer.write(np.zeros(6, dtype=np.float32))
    assert writer.closed and read_wav_header(path).frames == 10


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"sample_rate": 0, "channels": 1}, "positive"),
        ({"sample_rate": 48000, "channels": 0}, "1 to 8"),
        ({"sample_rate": 48000, "channels": 1, "bits": 32}, "32-bit"),
    ],
)
def test_a_writer_refuses_a_format_it_cannot_write(tmp_path, kwargs, message):
    with pytest.raises(ValueError, match=message):
        WavWriter(tmp_path / "take.wav", **kwargs)
    assert not (tmp_path / "take.wav").exists()


def test_a_block_of_the_wrong_shape_is_refused(tmp_path):
    with WavWriter(tmp_path / "take.wav", 48000, 2) as writer, pytest.raises(ValueError, match=r"\(frames, 2\)"):
        writer.write(np.zeros(10, dtype=np.float32))


def test_read_wav_header_refuses_what_is_not_a_pcm_wav(tmp_path):
    path = tmp_path / "not.wav"
    path.write_bytes(b"ID3" + bytes(60))
    with pytest.raises(ValueError, match="PCM WAV header"):
        read_wav_header(path)
    with pytest.raises(ValueError, match="16- or 24-bit"):
        to_pcm(np.zeros(1), 8)
    with pytest.raises(ValueError, match="16- or 24-bit"):
        from_pcm(b"", 32, 1)


@given(st.lists(st.floats(min_value=-1.0, max_value=1.0, width=32), min_size=1, max_size=200), st.sampled_from([16, 24]))
def test_pcm_round_trips_within_half_a_step(samples, bits):
    frames = np.array(samples, dtype=np.float32).reshape(-1, 1)
    back = from_pcm(to_pcm(frames, bits), bits, 1)
    assert np.max(np.abs(back - frames)) <= 1 / (1 << (bits - 1)) + 1e-9


# --- metering ---------------------------------------------------------------------------------------------------------------


def test_dbfs_is_clamped_at_both_ends():
    assert dbfs(0.0) == FLOOR_DBFS and dbfs(float("nan")) == FLOOR_DBFS
    assert dbfs(1e-9) == FLOOR_DBFS
    assert dbfs(2.0) == 0.0
    assert dbfs(0.5) == -6.0


def test_the_meter_reports_every_100_ms_at_the_devices_own_rate_whatever_the_block_size():
    meter = LevelMeter(48000, 1)
    tone = synthetic_tone(0, 48000, 48000, 1)  # one second at -12 dBFS peak
    events = []
    for start in range(0, 48000, 441):  # an odd block size, as engines deliver
        events += meter.feed(tone[start : start + 441])
    assert len(events) == 10
    assert all(event["type"] == "level" for event in events)
    assert {event["peak"] for event in events} == {dbfs(0.25)}
    assert {event["rms"] for event in events} == {dbfs(0.25 / math.sqrt(2))}


def test_the_meter_takes_the_loudest_channel_and_counts_clipped_samples():
    meter = LevelMeter(1000, 2)  # 50-sample windows, 100-sample reports
    frames = np.zeros((100, 2), dtype=np.float32)
    frames[:, 1] = 1.0
    [event] = meter.feed(frames)
    assert (event["peak"], event["rms"]) == (0.0, 0.0)
    assert meter.clipped == 100
    [silence] = meter.feed(np.zeros((100, 2), dtype=np.float32))
    assert (silence["peak"], silence["rms"]) == (FLOOR_DBFS, FLOOR_DBFS)


def test_a_meter_refuses_windows_that_do_not_divide_a_report():
    with pytest.raises(ValueError, match="whole number"):
        LevelMeter(48000, 1, window_ms=30, report_ms=100)
    with pytest.raises(ValueError, match="positive rate"):
        LevelMeter(0, 1)


# --- framing ----------------------------------------------------------------------------------------------------------------


def test_downmix_averages_channels_and_passes_mono_through():
    assert downmix(np.array([[1.0, 0.0], [0.5, 0.5]], dtype=np.float32)).tolist() == [0.5, 0.5]
    assert downmix(np.array([0.25, -0.25], dtype=np.float32)).tolist() == [0.25, -0.25]
    with pytest.raises(ValueError, match="frames, channels"):
        downmix(np.zeros((2, 2, 2)))


def test_the_framer_gives_whole_chunks_and_a_last_shorter_one():
    framer = Framer(4)
    chunks = framer.feed(np.arange(3, dtype=np.float32)) + framer.feed(np.arange(3, 10, dtype=np.float32))
    assert [chunk.tolist() for chunk in chunks] == [[0, 1, 2, 3], [4, 5, 6, 7]]
    assert framer.flush().tolist() == [8, 9]
    assert framer.flush() is None
    with pytest.raises(ValueError, match="at least one"):
        Framer(0)


def test_the_framer_keeps_every_sample_in_order():
    framer = Framer(5)
    fed = np.arange(23, dtype=np.float32)
    chunks = framer.feed(fed[:7]) + framer.feed(fed[7:])
    rest = framer.flush()
    assert np.concatenate([*chunks, rest]).tolist() == fed.tolist()
    assert [len(chunk) for chunk in chunks] == [5, 5, 5, 5] and len(rest) == 3


@pytest.mark.parametrize("block", [1, 7, 480, 1024])
def test_48k_to_16k_is_the_same_whatever_the_blocks_and_keeps_the_count(block):
    tone = synthetic_tone(0, 48000, 48000, 1)[:, 0]
    whole = LinearResampler(48000, 16000).feed(tone)
    streamed_resampler = LinearResampler(48000, 16000)
    streamed = np.concatenate([streamed_resampler.feed(tone[start : start + block]) for start in range(0, len(tone), block)])
    assert np.allclose(streamed, whole, atol=1e-6)
    assert abs(len(streamed) - 16000) <= 1


def test_a_tone_survives_resampling_at_its_level():
    tone = synthetic_tone(0, 44100, 44100, 1)[:, 0]
    out = LinearResampler(44100, 16000).feed(tone)
    assert abs(len(out) - 16000) <= 1
    assert np.max(np.abs(out[100:])) == pytest.approx(0.25, rel=0.05)


def test_an_equal_rate_passes_through_and_a_bad_rate_is_refused():
    samples = np.array([0.1, 0.2], dtype=np.float32)
    assert LinearResampler(16000, 16000).feed(samples).tolist() == samples.tolist()
    assert LinearResampler(8000, 16000).feed(np.ones(1, dtype=np.float32)).size == 0  # waits for a right neighbour
    with pytest.raises(ValueError, match="positive"):
        LinearResampler(0, 16000)


# --- the recorder -----------------------------------------------------------------------------------------------------------


def test_a_synthetic_take_is_written_bit_exact_with_no_dropouts(tmp_path):
    source = SyntheticSource(48000, 2, 480, realtime=False, stop_after=100)
    levels = []
    recorder = Recorder(source, tmp_path / "take.wav", on_level=levels.append).start()
    source.wait(10)
    result = recorder.stop()

    assert result.error is None and result.dropouts == 0 and result.frames == 48000
    assert len(levels) == 10
    _rate, _channels, _width, raw = _read(tmp_path / "take.wav")
    assert raw == to_pcm(synthetic_tone(0, 48000, 48000, 2), 24)
    summary = result.summary()
    assert summary["seconds"] == 1.0 and summary["droppedBlocks"] == 0 and summary["blockMs"]["p50"] is not None


def test_the_engines_overflow_flags_are_counted_as_dropouts(tmp_path):
    source = SyntheticSource(16000, 1, 160, realtime=False, overflow_every=10, stop_after=50)
    recorder = Recorder(source, tmp_path / "take.wav").start()
    source.wait(10)
    result = recorder.stop()
    assert (result.overflows, result.dropouts, result.frames) == (5, 5, 8000)


def test_a_full_queue_drops_and_counts_blocks_instead_of_stalling_the_device(tmp_path):
    source = SyntheticSource(16000, 1, 1600, realtime=False, stop_after=40)  # one level event per block
    blocked = threading.Event()
    release = threading.Event()

    def slow_listener(_event):
        blocked.set()
        release.wait(10)

    recorder = Recorder(source, tmp_path / "take.wav", on_level=slow_listener, queue_seconds=0.0).start()
    source.wait(10)  # the device thread never waits on the stalled writer
    release.set()
    result = recorder.stop()
    assert blocked.is_set()
    assert result.dropped_blocks > 0 and result.dropped_frames == result.dropped_blocks * 1600
    assert result.frames + result.dropped_frames == 40 * 1600


def test_a_device_that_fails_mid_take_leaves_the_audio_before_it_and_says_why(tmp_path):
    source = SyntheticSource(16000, 1, 160, realtime=False, fail_after=25)
    recorder = Recorder(source, tmp_path / "take.wav").start()
    assert recorder.failed.wait(10)
    result = recorder.stop()
    assert result.error == "The input device stopped: the synthetic device was unplugged"
    assert result.frames == 25 * 160 == read_wav_header(tmp_path / "take.wav").frames


def test_a_disk_error_closes_the_file_keeps_draining_and_reports_it(tmp_path, monkeypatch):
    monkeypatch.setattr(wav_module, "MAX_RIFF_BYTES", 36 + 1000 * 3)
    source = SyntheticSource(16000, 1, 160, realtime=False, stop_after=20)
    recorder = Recorder(source, tmp_path / "take.wav").start()
    source.wait(10)
    result = recorder.stop()
    assert "4 GiB" in result.error
    assert result.frames == 1000 == read_wav_header(tmp_path / "take.wav").frames


def test_a_listener_that_raises_is_reported_and_the_take_is_still_written(tmp_path):
    def broken(_event):
        raise KeyError("ui gone")

    source = SyntheticSource(16000, 1, 1600, realtime=False, stop_after=3)
    recorder = Recorder(source, tmp_path / "take.wav", on_level=broken).start()
    source.wait(10)
    result = recorder.stop()
    assert result.error.startswith("The level listener failed") and result.frames == 4800


class _Refusing:
    sample_rate = 48000
    channels = 1
    latency = 0.0

    def start(self, deliver, fail):
        raise OSError("device in use")

    def stop(self):
        raise AssertionError("never started")


class _StopFails(SyntheticSource):
    def stop(self):
        super().stop()
        raise OSError("driver hung")


def test_a_device_that_will_not_open_raises_and_leaves_an_empty_valid_file(tmp_path):
    with pytest.raises(OSError, match="in use"):
        Recorder(_Refusing(), tmp_path / "take.wav").start()
    assert read_wav_header(tmp_path / "take.wav").frames == 0


def test_a_stop_that_fails_still_saves_the_take_and_stop_is_idempotent(tmp_path):
    source = _StopFails(8000, 1, 80, realtime=False, stop_after=10, latency=0.012)
    with Recorder(source, tmp_path / "take.wav") as recorder:
        source.wait(10)
    result = recorder.stop()
    assert result is recorder.stop()
    assert result.error == "The input device did not stop cleanly: driver hung"
    assert result.frames == 800 and result.latency == 0.012


def test_a_realtime_source_is_paced_to_the_wall_clock(tmp_path):
    source = SyntheticSource(8000, 1, 80, realtime=True, stop_after=20)  # 0.2 s of audio
    recorder = Recorder(source, tmp_path / "take.wav").start()
    source.wait(10)
    result = recorder.stop()
    assert result.wall_seconds >= 0.18 and result.frames == 1600
    assert recorder.frames == 1600 and recorder.error is None
