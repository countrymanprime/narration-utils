"""capture_dshow.py (provider-ports P11): the dshow backend passes the capture port's conformance suite, and its
list_devices() reaches the narrator through the very fake ffmpeg log capture test_devices.py's own tests use (see
there for the parsing itself, already unit-tested); this only checks the port's shape end to end."""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from narration_common.ports import capture_conformance
from narration_common.ports.capture import CHUNK_SECONDS, chunk_samples

CORE = Path(__file__).resolve().parents[1] / "core"

DEVICE_NAME = "Microphone Array (Realtek(R) Audio)"

# Real ffmpeg dshow log output for one audio device, the same shape (and split fragments) as test_devices.py's own
# REAL_LOG_CAPTURE fixture.
LOG_CAPTURE = [
    (32, "dshow", f'"{DEVICE_NAME}"'),
    (32, "dshow", " (audio"),
    (32, "dshow", ")"),
    (32, "dshow", "\n"),
]


@pytest.fixture(scope="module", autouse=True)
def _capture_dshow_module():
    """Same reasoning as test_asr_conformance.py's own fixture: capture_dshow.py registers its row into the shared
    BACKENDS singleton as a side effect of import, so it must be a plain import (Python's module cache dedupes a
    second registration of the same name, which the registry would otherwise refuse), deferred to first use here so
    it does not race another test file's own one-time sys.path insertion."""
    if str(CORE) not in sys.path:
        sys.path.insert(0, str(CORE))
    global capture_dshow
    import capture_dshow as _capture_dshow

    capture_dshow = _capture_dshow


class _FakeAvLogging:
    """As test_devices.py's own fake: PyAV's default log level is off, so a capture receives nothing unless the
    listing (devices.capture_dshow_log) raises it to INFO first."""

    INFO = 32

    def __init__(self):
        self.level = None
        self.captured: list = []

    def get_level(self):
        return self.level

    def set_level(self, level):
        self.level = level

    def Capture(self, local):
        assert local is True
        captured = self.captured

        class _Capture:
            def __enter__(self):
                return captured

            def __exit__(self, *exc):
                return False

        return _Capture()


class _FakeFrame:
    def __init__(self, samples: np.ndarray):
        self._samples = samples

    def to_ndarray(self) -> np.ndarray:
        return self._samples.reshape(1, -1)


class _FakeResampler:
    """Stands in for av.AudioResampler: this suite only needs the pass-through shape (frame in, frames out), not an
    actual resample."""

    def __init__(self, format, layout, rate):
        pass

    def resample(self, frame):
        return [frame]


class _FakeContainer:
    def __init__(self, frames):
        self.streams = SimpleNamespace(audio=[SimpleNamespace()])
        self._frames = frames
        self.closed = 0

    def decode(self, stream):
        yield from self._frames

    def close(self):
        self.closed += 1


def _install_fake_av(monkeypatch, fake_logging, audio_by_device):
    """A fake `av` covering both PyAV calls this adapter makes: `open(..., options=...)` is devices.py's
    device-listing mode (always raises; the log is the result, as test_devices.py's own fake establishes), and a
    plain `open(file="audio=<name>", format="dshow")` opens that device's stream - or raises for a name not in
    audio_by_device, exactly as a real device that does not exist would."""

    class _FakeAv:
        logging = fake_logging
        AudioResampler = _FakeResampler

        @staticmethod
        def open(file, format, options=None):
            if options is not None:
                if fake_logging.level is not None and fake_logging.level >= fake_logging.INFO:
                    fake_logging.captured.extend(LOG_CAPTURE)
                raise RuntimeError("Immediate exit requested")
            device = file.split("audio=", 1)[1]
            if device not in audio_by_device:
                raise OSError(f"Could not open {device}")
            return _FakeContainer(audio_by_device[device])

    monkeypatch.setitem(sys.modules, "av", _FakeAv)
    monkeypatch.setitem(sys.modules, "av.logging", fake_logging)


def _frames(total_samples: int, frame_size: int = 2048) -> list:
    """One tone split across several short frames, so the suite's own chunking loop is fed more than once, as real
    audio arriving in bursts would."""
    tone = (0.5 * np.sin(np.arange(total_samples, dtype=np.float32) / 20)).astype(np.float32)
    return [_FakeFrame(tone[start : start + frame_size]) for start in range(0, total_samples, frame_size)]


def test_the_dshow_backend_is_registered_windows_only():
    entry = capture_dshow.DshowBackend()

    assert entry.descriptor.name == "dshow"
    assert entry.descriptor.runs_on("windows") and not entry.descriptor.runs_on("darwin")
    assert "dshow" in capture_dshow.BACKENDS


def test_the_dshow_backend_lists_devices_through_the_fake_log_capture_test_devices_py_uses(monkeypatch):
    fake_logging = _FakeAvLogging()
    _install_fake_av(monkeypatch, fake_logging, audio_by_device={})

    listed, error = capture_dshow.DshowBackend().list_devices()

    assert error is None
    assert [device.name for device in listed] == [DEVICE_NAME]
    assert listed[0].to_json() == {"name": DEVICE_NAME}


def test_the_dshow_backend_lists_nothing_where_there_is_no_dshow_build():
    """This adapter changes nothing about list_devices() itself (devices.list_input_devices, unit-tested by
    test_devices.py): on a machine whose FFmpeg build has no dshow muxer at all (any non-Windows FFmpeg, including
    this suite's own), listing raises before it can log anything and list_input_devices reports no devices - never
    an error, so a caller can never take this for "device listing itself failed" (the sentinel devices.py's own
    tests cover with a forced capture failure)."""
    listed, error = capture_dshow.DshowBackend().list_devices()

    assert (listed, error) == ([], None)


def test_the_dshow_backend_passes_the_capture_ports_conformance_suite(monkeypatch):
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    _install_fake_av(monkeypatch, fake_logging, audio_by_device={DEVICE_NAME: _frames(whole * 3 + 777)})

    capture_conformance.run(capture_dshow.DshowBackend(), device=DEVICE_NAME, missing_device="Narration Studio conformance: no such device")


def test_the_dshow_backend_closes_the_container_once_its_stream_is_closed(monkeypatch):
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    containers: list = []
    _install_fake_av(monkeypatch, fake_logging, audio_by_device={DEVICE_NAME: _frames(whole * 2)})
    real_open = sys.modules["av"].open

    def tracking_open(file, format, options=None):
        container = real_open(file, format, options=options)
        if options is None:
            containers.append(container)
        return container

    monkeypatch.setattr(sys.modules["av"], "open", tracking_open)

    stream = capture_dshow.DshowBackend().chunks(DEVICE_NAME)
    next(stream)
    stream.close()
    stream.close()  # a generator's close() is idempotent; the finally block must not run twice either

    assert containers[0].closed == 1
