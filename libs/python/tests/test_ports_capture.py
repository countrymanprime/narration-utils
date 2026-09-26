"""The capture port (provider-ports P10): its descriptor, its roles and its conformance suite."""

import ast
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from narration_common.ports import PLATFORMS, Descriptor, NotSupportedError, Registry, capture, capture_conformance, conformance
from narration_common.ports.capture import BACKENDS, CHUNK_SECONDS, SAMPLE_RATE, CaptureDescriptor, chunk_samples
from narration_common.ports.conformance import ConformanceError

LIVE_ASR = Path(__file__).resolve().parents[3] / "sidecars" / "manuscript-teleprompter" / "core" / "live_asr.py"

# --- the fakes ------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class FakeDevice:
    """Shaped like ``devices.Device``: the wire carries the name only."""

    name: str
    kind: str = "audio"

    def to_json(self) -> dict:
        return {"name": self.name}


FAKE = CaptureDescriptor("fake", "Fake capture", platforms=PLATFORMS)


class FakeBackend:
    """A test-only backend that implements the port by shape alone: no base class, as the dshow adapter (P11) will.

    Each device is a tone of ``seconds`` seconds; ``endless`` devices never run out, like a microphone. ``chunks`` is a generator,
    as ``iter_microphone_chunks`` is, so the device opens on the first ``next`` and closes when the generator is closed.
    """

    def __init__(self, descriptor=FAKE, devices=None, seconds=1.0, endless=False, error=None):
        self.descriptor = descriptor
        self.devices = [FakeDevice("Microphone (Fake)"), FakeDevice("Line In (Fake)")] if devices is None else devices
        self.seconds = seconds
        self.endless = endless
        self.error = error
        self.opened: list[str] = []
        self.open_now = 0

    def list_devices(self):
        if self.error:
            return [], self.error
        return list(self.devices), None

    def _samples(self):
        tone = np.sin(np.arange(int(self.seconds * SAMPLE_RATE), dtype=np.float32) / 10).astype(np.float32) * 0.5
        while True:
            yield tone
            if not self.endless:
                return

    def chunks(self, device, chunk_seconds=CHUNK_SECONDS):
        if device not in {d.name for d in self.devices}:
            raise OSError(f"Could not open {device}")
        self.opened.append(device)
        self.open_now += 1
        size = chunk_samples(chunk_seconds)
        pending = np.zeros(0, dtype=np.float32)
        try:
            for block in self._samples():
                pending = np.concatenate([pending, block])
                while len(pending) >= size:
                    yield pending[:size]
                    pending = pending[size:]
        finally:
            self.open_now -= 1
        if len(pending) > 0:
            yield pending


def _run(backend, **cases):
    capture_conformance.run(backend, **cases)


# --- the port itself ------------------------------------------------------------------------------------------------------------


def test_the_port_imports_no_backend_and_no_numpy():
    sources = (Path(capture.__file__).read_text(encoding="utf-8"), Path(capture_conformance.__file__).read_text(encoding="utf-8"))
    modules = {
        (node.module or "") if isinstance(node, ast.ImportFrom) else alias.name
        for text in sources
        for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    }

    assert not {m for m in modules if m.split(".")[0] in {"numpy", "av", "sounddevice", "pyaudio"}}


def test_the_backends_registry_speaks_of_capture_backends_and_starts_empty():
    """The dshow adapter (P11) fills it at import; the port itself registers nothing."""
    assert isinstance(BACKENDS, Registry) and BACKENDS.kind == "capture backend" and len(BACKENDS) == 0


def test_the_sample_rate_and_chunk_length_are_the_teleprompters():
    """Every chunk a backend gives is what ``live_asr`` feeds its decoder today; read from its source so neither can drift."""
    text = LIVE_ASR.read_text(encoding="utf-8")

    assert f"SAMPLE_RATE = {SAMPLE_RATE}\n" in text
    assert f"CHUNK_SECONDS = {CHUNK_SECONDS}\n" in text


def test_chunk_samples_is_the_teleprompters_rounding():
    """``iter_microphone_chunks`` sizes its chunks with ``max(1, int(chunk_seconds * SAMPLE_RATE))``."""
    assert chunk_samples(CHUNK_SECONDS) == 5120
    assert chunk_samples(0.5) == 8000
    assert chunk_samples(0.00001) == 1
    assert chunk_samples(0) == 1


# --- the descriptor -------------------------------------------------------------------------------------------------------------


def test_capture_descriptor_is_a_descriptor_with_platforms_and_no_modes():
    dshow = CaptureDescriptor("dshow", "DirectShow", platforms=("windows",))

    assert isinstance(dshow, Descriptor)
    assert dshow.runs_on("windows") and not dshow.runs_on("darwin")
    assert dshow.modes == ()


def test_capture_descriptor_refuses_modes():
    with pytest.raises(ValueError, match="no modes"):
        CaptureDescriptor("dshow", "DirectShow", platforms=("windows",), modes=("live",))


def test_capture_descriptor_must_name_its_platforms():
    """A backend opens one platform's own audio API, so "every platform" by omission would be a lie the Go row could not match."""
    with pytest.raises(ValueError, match="platforms"):
        CaptureDescriptor("dshow", "DirectShow")


def test_capture_descriptor_keeps_the_kits_checks():
    with pytest.raises(ValueError, match="not one of"):
        CaptureDescriptor("dshow", "DirectShow", platforms=("amiga",))


def test_the_registry_answers_by_platform():
    backends = Registry("capture backend")
    backends.register(FakeBackend(CaptureDescriptor("dshow", "DirectShow", platforms=("windows",))))
    backends.register(FakeBackend(CaptureDescriptor("coreaudio", "Core Audio", platforms=("darwin",))))

    assert backends.names("windows") == ["dshow"]
    assert backends.default("linux") is None
    with pytest.raises(NotSupportedError, match="not available on darwin"):
        backends.lookup("dshow", "darwin")


# --- the suite passes a backend that keeps the contract -------------------------------------------------------------------------


def test_a_fake_backend_passes_the_suite():
    backend = FakeBackend()

    _run(backend)

    assert backend.opened[0] == "Microphone (Fake)"
    assert backend.open_now == 0


def test_an_endless_backend_passes_and_is_closed_after():
    backend = FakeBackend(endless=True)

    _run(backend)

    assert backend.open_now == 0


def test_a_backend_whose_stream_ends_on_a_short_chunk_passes():
    """The last chunk may be short (whatever audio was left when the device stopped), as long as it is not empty."""
    _run(FakeBackend(seconds=0.33), take=5)


def test_a_backend_whose_stream_ends_on_a_whole_chunk_passes():
    _run(FakeBackend(seconds=CHUNK_SECONDS * 2), take=5)


def test_a_backend_that_cannot_list_passes_when_told_which_device_to_open():
    """Listing may fail with a message (off Windows today): the suite then needs a device to open."""
    _run(FakeBackend(error="Could not list input devices: no dshow"), device="Microphone (Fake)")


def test_a_backend_that_cannot_list_needs_a_device_to_check():
    with pytest.raises(ValueError, match="device="):
        _run(FakeBackend(error="Could not list input devices: no dshow"))


def test_a_backend_with_no_microphones_passes_when_told_which_device_to_open():
    backend = FakeBackend()
    listed = backend.devices
    backend.list_devices = lambda: ([], None)

    _run(backend, device=listed[0].name)


def test_the_missing_device_check_can_be_skipped():
    backend = FakeBackend()
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: FakeBackend().chunks("Microphone (Fake)", chunk_seconds)

    _run(backend, missing_device=None)


def test_the_suite_runs_over_a_registry():
    backends = Registry("capture backend")
    backends.register(FakeBackend())

    conformance.run_over_registry(backends, capture_conformance.run)


# --- the suite fails a backend that breaks it -----------------------------------------------------------------------------------


def _fails(backend, message: str, **cases) -> None:
    with pytest.raises(ConformanceError, match=message):
        _run(backend, **cases)


def test_the_suite_needs_a_capture_descriptor():
    _fails(FakeBackend(descriptor=Descriptor("fake", "Fake")), "not a CaptureDescriptor")


def test_listing_must_not_raise():
    backend = FakeBackend()

    def broken():
        raise OSError("no dshow")

    backend.list_devices = broken

    _fails(backend, "list_devices.. raised OSError")


def test_listing_returns_a_pair():
    backend = FakeBackend()
    backend.list_devices = lambda: backend.devices

    _fails(backend, re.escape("(devices, error)"))


def test_a_listing_error_is_a_sentence_and_lists_nothing():
    backend = FakeBackend()
    backend.list_devices = lambda: (backend.devices, "Could not list input devices.")
    _fails(backend, "listed devices and an error")

    backend.list_devices = lambda: ([], "  ")
    _fails(backend, "error with no message", device="Microphone (Fake)")

    backend.list_devices = lambda: ([], 42)
    _fails(backend, "error with no message", device="Microphone (Fake)")


def test_a_listed_device_needs_a_name_and_its_wire_form():
    class Nameless:
        name = " "

        def to_json(self):
            return {"name": self.name}

    _fails(FakeBackend(devices=[Nameless()]), "device with no name")


def test_a_listed_device_says_its_name_on_the_wire():
    class Renamed(FakeDevice):
        def to_json(self):
            return {"name": "something else"}

    _fails(FakeBackend(devices=[Renamed("Mic")]), "to_json")


def test_a_listed_device_is_json_on_the_wire():
    class Unserialisable(FakeDevice):
        def to_json(self):
            return {"name": self.name, "handle": object()}

    _fails(FakeBackend(devices=[Unserialisable("Mic")]), "not JSON")


def test_a_listed_device_without_to_json_fails():
    class Bare:
        name = "Mic"

    _fails(FakeBackend(devices=[Bare()]), "to_json")


def test_the_listed_name_is_the_name_that_opens():
    backend = FakeBackend()
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: FakeBackend(devices=[FakeDevice("other")]).chunks(device, chunk_seconds)

    _fails(backend, "could not open", missing_device=None)


def test_a_missing_device_must_raise():
    backend = FakeBackend()
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: FakeBackend().chunks("Microphone (Fake)", chunk_seconds)

    _fails(backend, "opened a device that does not exist")


def test_a_missing_device_must_not_end_quietly():
    backend = FakeBackend()
    real = backend.chunks
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: real(device, chunk_seconds) if device in {"Microphone (Fake)"} else iter(())

    _fails(backend, "ended without audio instead of raising")


def test_chunks_must_have_a_close():
    backend = FakeBackend()
    real = backend.chunks
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: iter(list(real(device, chunk_seconds)))

    _fails(backend, "no close", missing_device=None)


def test_a_second_close_must_not_raise():
    class Once:
        def __init__(self, inner):
            self.inner, self.closed = inner, False

        def __iter__(self):
            return self

        def __next__(self):
            return next(self.inner)

        def close(self):
            if self.closed:
                raise RuntimeError("already closed")
            self.closed = True
            self.inner.close()

    backend = FakeBackend()
    real = backend.chunks
    backend.chunks = lambda device, chunk_seconds=CHUNK_SECONDS: Once(real(device, chunk_seconds))

    _fails(backend, "second close", missing_device=None)


def test_a_stream_with_no_audio_fails():
    _fails(FakeBackend(seconds=0), "gave no audio")


def test_every_chunk_but_the_last_is_whole():
    backend = FakeBackend()

    def uneven(device, chunk_seconds=CHUNK_SECONDS):
        yield np.zeros(10, dtype=np.float32)
        yield np.zeros(chunk_samples(chunk_seconds), dtype=np.float32)

    backend.chunks = uneven

    _fails(backend, "10 samples, not 5120", missing_device=None)


def test_a_short_chunk_must_be_the_last():
    backend = FakeBackend()

    def short_then_more(device, chunk_seconds=CHUNK_SECONDS):
        yield np.zeros(chunk_samples(chunk_seconds), dtype=np.float32)
        yield np.zeros(10, dtype=np.float32)
        yield np.zeros(chunk_samples(chunk_seconds), dtype=np.float32)

    backend.chunks = short_then_more

    _fails(backend, "chunk 1 .* is 10 samples, not 5120; only the last may be shorter", missing_device=None, take=2)


@pytest.mark.parametrize(
    ("chunk", "message"),
    [
        (np.zeros(0, dtype=np.float32), "empty"),
        (np.zeros(5120, dtype=np.float64), "float64, not float32"),
        (np.zeros((1, 5120), dtype=np.float32), "2 dimensions"),
        (np.full(5120, np.nan, dtype=np.float32), "not a number"),
        (np.full(5120, np.inf, dtype=np.float32), "not a number"),
        ([0.0] * 5120, "no dtype"),
        (None, "no length"),
    ],
)
def test_a_chunk_is_mono_float32_samples(chunk, message):
    backend = FakeBackend()

    def bad(device, chunk_seconds=CHUNK_SECONDS):
        yield chunk

    backend.chunks = bad

    _fails(backend, message, missing_device=None)


def test_the_last_chunk_is_never_longer_than_a_whole_one():
    backend = FakeBackend()

    def long(device, chunk_seconds=CHUNK_SECONDS):
        yield np.zeros(chunk_samples(chunk_seconds) + 1, dtype=np.float32)

    backend.chunks = long

    _fails(backend, "5121 samples, more than 5120", missing_device=None)


def test_a_stream_that_fails_after_opening_fails_the_suite():
    backend = FakeBackend()

    def unplugged(device, chunk_seconds=CHUNK_SECONDS):
        yield np.zeros(chunk_samples(chunk_seconds), dtype=np.float32)
        raise OSError("device unplugged")

    backend.chunks = unplugged

    _fails(backend, "failed after 1 chunks", missing_device=None)


def test_the_suite_refuses_to_take_nothing():
    with pytest.raises(ValueError, match="take"):
        _run(FakeBackend(), take=0)


def test_a_backend_passes_at_another_chunk_length():
    _run(FakeBackend(), chunk_seconds=0.1, take=4)
