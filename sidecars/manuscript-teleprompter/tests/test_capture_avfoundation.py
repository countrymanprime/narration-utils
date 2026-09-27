"""capture_avfoundation.py (docs/prds/coreaudio-capture.prd.md Phase 1): the coreaudio backend passes the capture port's
conformance suite, and its list_devices() reaches the narrator through the same fake ffmpeg log capture
test_devices_avfoundation.py's own tests use (see there for the parsing itself, already unit-tested); this only checks the port's
shape end to end, and that a name from list_devices() opens by FFmpeg's index (device addressing, PRD Q1)."""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from narration_common.ports import capture_conformance
from narration_common.ports.capture import CHUNK_SECONDS, chunk_samples

CORE = Path(__file__).resolve().parents[1] / "core"

DEVICE_NAME = "Built-in Microphone"
DEVICE_INDEX = 0

# Real-shaped ffmpeg avfoundation log output for one audio device (see test_devices_avfoundation.py and its module's docstring
# for how this format is reasoned, not yet confirmed against real hardware).
LOG_CAPTURE = [
    (32, "AVFoundation input device", "AVFoundation video devices:\n"),
    (32, "AVFoundation input device", "[0] FaceTime HD Camera\n"),
    (32, "AVFoundation input device", "AVFoundation audio devices:\n"),
    (32, "AVFoundation input device", f"[{DEVICE_INDEX}] {DEVICE_NAME}\n"),
]


@pytest.fixture(scope="module", autouse=True)
def _capture_avfoundation_module():
    """Same reasoning as test_capture_dshow.py's own fixture: capture_avfoundation.py registers its row into the shared BACKENDS
    singleton as a side effect of import, so it must be a plain import, deferred to first use here so it does not race another
    test file's own one-time sys.path insertion."""
    if str(CORE) not in sys.path:
        sys.path.insert(0, str(CORE))
    global capture_avfoundation
    import capture_avfoundation as _capture_avfoundation

    capture_avfoundation = _capture_avfoundation


class _FakeAvLogging:
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


def _install_fake_av(monkeypatch, fake_logging, audio_by_index):
    """A fake `av` covering both PyAV calls this adapter makes: `open(..., options=...)` is the device-listing mode (always
    raises; the log is the result), and a plain `open(file=":<index>", format="avfoundation")` opens that index's stream - or
    raises for an index not in audio_by_index, exactly as a device that does not exist would."""

    class _FakeAv:
        logging = fake_logging
        AudioResampler = _FakeResampler

        @staticmethod
        def open(file, format, options=None):
            if options is not None:
                if fake_logging.level is not None and fake_logging.level >= fake_logging.INFO:
                    fake_logging.captured.extend(LOG_CAPTURE)
                raise RuntimeError("Immediate exit requested")
            index = int(file.split(":", 1)[1])
            if index not in audio_by_index:
                raise OSError(f"Could not open device index {index}")
            return _FakeContainer(audio_by_index[index])

    monkeypatch.setitem(sys.modules, "av", _FakeAv)
    monkeypatch.setitem(sys.modules, "av.logging", fake_logging)


def _frames(total_samples: int, frame_size: int = 2048) -> list:
    tone = (0.5 * np.sin(np.arange(total_samples, dtype=np.float32) / 20)).astype(np.float32)
    return [_FakeFrame(tone[start : start + frame_size]) for start in range(0, total_samples, frame_size)]


def test_the_coreaudio_backend_is_registered_darwin_only():
    entry = capture_avfoundation.CoreAudioBackend()

    assert entry.descriptor.name == "coreaudio"
    assert entry.descriptor.runs_on("darwin") and not entry.descriptor.runs_on("windows")
    assert "coreaudio" in capture_avfoundation.BACKENDS


def test_the_coreaudio_backend_lists_devices_through_the_fake_log_capture_test_devices_avfoundation_py_uses(monkeypatch):
    fake_logging = _FakeAvLogging()
    _install_fake_av(monkeypatch, fake_logging, audio_by_index={})

    listed, error = capture_avfoundation.CoreAudioBackend().list_devices()

    assert error is None
    assert [device.name for device in listed] == [DEVICE_NAME]
    assert listed[0].to_json() == {"name": DEVICE_NAME}


def test_the_coreaudio_backend_lists_nothing_where_there_is_no_avfoundation_build():
    """This adapter changes nothing about list_devices() itself (devices_avfoundation.list_input_devices, unit-tested by
    test_devices_avfoundation.py): on a machine whose FFmpeg build has no avfoundation demuxer at all (any non-macOS FFmpeg,
    including this suite's own), listing raises before it can log anything and list_input_devices reports no devices - never an
    error, so a caller can never take this for "device listing itself failed"."""
    listed, error = capture_avfoundation.CoreAudioBackend().list_devices()

    assert (listed, error) == ([], None)


def test_the_coreaudio_backend_opens_by_the_name_it_listed_translating_it_to_ffmpegs_index(monkeypatch):
    """PRD Q1: the Protocol's by-name contract holds even though avfoundation itself addresses devices by index - the adapter
    resolves the name back to the index internally, so `chunks(device)` still takes the exact string `list_devices()` returned."""
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    opened_files = []
    _install_fake_av(monkeypatch, fake_logging, audio_by_index={DEVICE_INDEX: _frames(whole * 2)})
    real_open = sys.modules["av"].open

    def tracking_open(file, format, options=None):
        opened_files.append(file)
        return real_open(file, format, options=options)

    monkeypatch.setattr(sys.modules["av"], "open", tracking_open)

    stream = capture_avfoundation.CoreAudioBackend().chunks(DEVICE_NAME)
    next(stream)
    stream.close()

    assert f":{DEVICE_INDEX}" in opened_files


def test_the_coreaudio_backend_passes_the_capture_ports_conformance_suite(monkeypatch):
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    _install_fake_av(monkeypatch, fake_logging, audio_by_index={DEVICE_INDEX: _frames(whole * 3 + 777)})

    capture_conformance.run(capture_avfoundation.CoreAudioBackend(), device=DEVICE_NAME, missing_device="Narration Utils conformance: no such device")


def test_the_coreaudio_backend_closes_the_container_once_its_stream_is_closed(monkeypatch):
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    containers: list = []
    _install_fake_av(monkeypatch, fake_logging, audio_by_index={DEVICE_INDEX: _frames(whole * 2)})
    real_open = sys.modules["av"].open

    def tracking_open(file, format, options=None):
        container = real_open(file, format, options=options)
        if options is None:
            containers.append(container)
        return container

    monkeypatch.setattr(sys.modules["av"], "open", tracking_open)

    stream = capture_avfoundation.CoreAudioBackend().chunks(DEVICE_NAME)
    next(stream)
    stream.close()
    stream.close()  # a generator's close() is idempotent; the finally block must not run twice either

    assert containers[0].closed == 1


def test_the_coreaudio_backend_resolves_the_index_fresh_on_every_open_not_cached(monkeypatch):
    """PRD Q3: resolve at each chunks() open, never once at process start, in case avfoundation indices are unstable across
    hot-plug (untested - no Apple hardware available while this was written)."""
    whole = chunk_samples(CHUNK_SECONDS)
    fake_logging = _FakeAvLogging()
    _install_fake_av(monkeypatch, fake_logging, audio_by_index={DEVICE_INDEX: _frames(whole * 2)})
    real_open = sys.modules["av"].open
    listing_opens = []

    def tracking_open(file, format, options=None):
        if options is not None:
            listing_opens.append(options)
        return real_open(file, format, options=options)

    monkeypatch.setattr(sys.modules["av"], "open", tracking_open)

    for _ in range(2):
        stream = capture_avfoundation.CoreAudioBackend().chunks(DEVICE_NAME)
        next(stream)
        stream.close()

    assert len(listing_opens) == 2
