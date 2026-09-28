"""capture_wasapi.py (native-recording-suite P1, ADR 0357): the `wasapi` row passes the capture port's conformance suite
and records a take, driven through a fake `sounddevice` that plays a synthetic tone from its own thread, as PortAudio
calls its callback from the audio thread. CI has no microphone; the spike report (docs/research) has the measured runs."""

import sys
import threading
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from narration_common.ports import capture_conformance
from narration_common.ports.capture import CHUNK_SECONDS, chunk_samples
from narration_common.ports.registry import Level
from narration_common.recording import read_wav_header, synthetic_tone
from narration_common.recording.wav import to_pcm

CORE = Path(__file__).resolve().parents[1] / "core"

MIC = "Microphone (USB Audio CODEC)"


@pytest.fixture(scope="module", autouse=True)
def _capture_wasapi_module():
    """As test_capture_dshow.py: the module registers its row into the shared BACKENDS on import, so it is imported
    once, here."""
    if str(CORE) not in sys.path:
        sys.path.insert(0, str(CORE))
    global capture_wasapi
    import capture_wasapi as _capture_wasapi

    capture_wasapi = _capture_wasapi


class _Status:
    def __init__(self, overflow: bool):
        self.input_overflow = overflow


class FakeSounddevice:
    """The slice of `sounddevice` the adapter uses: two host APIs, their devices, and an InputStream whose thread
    delivers `blocks` blocks of the synthetic tone (then goes inactive, as an unplugged device does)."""

    PortAudioError = OSError

    def __init__(self, devices, *, blocks=200, block=480, overflow_every=0, refuse_open=False):
        self.devices = devices
        self.blocks = blocks
        self.block = block
        self.overflow_every = overflow_every
        self.refuse_open = refuse_open
        self.streams: list = []

    def query_hostapis(self):
        mme = {"name": "MME", "devices": [0]}
        wasapi = {"name": "Windows WASAPI", "devices": list(range(1, len(self.devices) + 1))}
        return (mme, wasapi)

    def query_devices(self, index):
        if index == 0:
            return {"name": "Microsoft Sound Mapper - Input", "max_input_channels": 2, "default_samplerate": 44100.0}
        return self.devices[index - 1]

    @staticmethod
    def WasapiSettings(exclusive):
        assert exclusive is False, "the recorder opens WASAPI in shared mode"
        return SimpleNamespace(exclusive=exclusive)

    def InputStream(self, **kwargs):
        if self.refuse_open:
            raise self.PortAudioError("Error opening InputStream: Device unavailable [PaErrorCode -9985]")
        stream = _FakeStream(self, **kwargs)
        self.streams.append(stream)
        return stream


class _FakeStream:
    def __init__(self, sd, *, device, samplerate, channels, dtype, latency, extra_settings, callback, finished_callback):
        assert dtype == "float32" and latency == "low"
        self.sd = sd
        self.device = device
        self.samplerate = samplerate
        self.channels = channels
        self.extra_settings = extra_settings
        self.callback = callback
        self.finished_callback = finished_callback
        self.latency = 0.0106
        self.started = self.stopped = self.closed = 0
        self._halt = threading.Event()
        self._thread = None

    def start(self):
        self.started += 1

        def run():
            for n in range(self.sd.blocks):
                if self._halt.is_set():
                    break
                block = synthetic_tone(n * self.sd.block, self.sd.block, self.samplerate, self.channels)
                overflow = bool(self.sd.overflow_every) and (n + 1) % self.sd.overflow_every == 0
                self.callback(block, len(block), None, _Status(overflow))
            self.finished_callback()

        self._thread = threading.Thread(target=run, daemon=True)
        self._thread.start()

    def stop(self):
        self.stopped += 1
        self._halt.set()
        self._thread.join()

    def close(self):
        self.closed += 1


def _device(name, channels=2, rate=48000.0):
    return {"name": name, "max_input_channels": channels, "default_samplerate": rate, "default_low_input_latency": 0.003}


def _backend(sd):
    return capture_wasapi.WasapiBackend(load=lambda: sd)


def test_the_wasapi_row_is_registered_after_dshow_windows_only_and_experimental():
    import capture_dshow  # noqa: F401 - the order live_asr.py imports them in

    backend = capture_wasapi.WasapiBackend()
    assert backend.descriptor.name == "wasapi" and backend.descriptor.label == "WASAPI"
    assert backend.descriptor.runs_on("windows") and not backend.descriptor.runs_on("linux")
    assert backend.level is Level.Experimental and not backend.descriptor.modes
    assert capture_wasapi.BACKENDS.names("windows").index("dshow") < capture_wasapi.BACKENDS.names("windows").index("wasapi")
    assert capture_wasapi.BACKENDS.default("windows") == "dshow"


def test_it_lists_only_wasapi_input_endpoints_and_disambiguates_a_repeated_name():
    sd = FakeSounddevice([_device(MIC), _device("Speakers", channels=0), _device(MIC, channels=1, rate=44100.0)])
    listed, error = _backend(sd).list_devices()
    assert error is None
    assert [(d.name, d.index, d.channels, d.sample_rate) for d in listed] == [(MIC, 1, 2, 48000), (f"{MIC} [2]", 3, 1, 44100)]
    assert listed[0].to_json() == {"name": MIC}


def test_a_host_without_wasapi_lists_nothing_and_no_error():
    sd = FakeSounddevice([])
    sd.query_hostapis = lambda: ({"name": "ALSA", "devices": []},)
    assert _backend(sd).list_devices() == ([], None)


def test_a_host_without_sounddevice_says_so_in_a_sentence():
    def missing():
        raise ImportError("No module named 'sounddevice'")

    listed, error = capture_wasapi.WasapiBackend(load=missing).list_devices()
    assert listed == [] and error == "The built-in recorder cannot list devices here: No module named 'sounddevice'"


def test_a_failing_listing_is_a_sentence_not_an_exception():
    sd = FakeSounddevice([_device(MIC)])

    def broken(_index):
        raise RuntimeError("PortAudio not initialized")

    sd.query_devices = broken
    assert _backend(sd).list_devices() == ([], "Could not list WASAPI input devices: PortAudio not initialized")


def test_the_wasapi_backend_passes_the_capture_ports_conformance_suite():
    sd = FakeSounddevice([_device(MIC)], blocks=400)
    capture_conformance.run(_backend(sd), missing_device="Narration Utils conformance: no such device")
    assert all(stream.closed == 1 and stream.extra_settings.exclusive is False for stream in sd.streams)


def test_chunks_are_16k_mono_at_the_ports_length_from_a_48k_stereo_endpoint():
    sd = FakeSounddevice([_device(MIC, channels=2)], blocks=200)
    stream = _backend(sd).chunks(MIC)
    chunks = [next(stream) for _ in range(5)]
    stream.close()
    assert all(chunk.dtype == np.float32 and chunk.shape == (chunk_samples(CHUNK_SECONDS),) for chunk in chunks)
    opened = sd.streams[0]
    assert (opened.samplerate, opened.channels, opened.device) == (48000, 1, 1)  # its own rate; mono asked of WASAPI
    assert (opened.stopped, opened.closed) == (1, 1)
    assert np.max(np.abs(np.concatenate(chunks)[200:])) == pytest.approx(0.25, rel=0.05)


def test_chunks_raise_when_the_device_goes_away_or_falls_silent(monkeypatch):
    sd = FakeSounddevice([_device(MIC)], blocks=20)  # 0.2 s, then the device goes inactive by itself
    stream = _backend(sd).chunks(MIC)
    with pytest.raises(OSError, match="stopped delivering audio"):
        for _ in stream:
            pass

    class _Silent(_FakeStream):
        def start(self):
            self.started += 1
            self._thread = threading.Thread(target=lambda: None)
            self._thread.start()

    monkeypatch.setattr(capture_wasapi, "SILENT_DEVICE_SECONDS", 0.05)
    quiet = FakeSounddevice([_device(MIC)])
    quiet.InputStream = lambda **kwargs: _Silent(quiet, **kwargs)
    with pytest.raises(TimeoutError, match="no audio for 0.05 seconds"):
        next(_backend(quiet).chunks(MIC))


def test_record_writes_a_24_bit_take_at_the_endpoints_own_rate(tmp_path):
    sd = FakeSounddevice([_device(MIC, rate=44100.0)], blocks=100, block=441, overflow_every=50)
    levels: list = []
    recorder = _backend(sd).record(MIC, tmp_path / "take.wav", on_level=levels.append)
    assert recorder.failed.wait(10)  # the fake ends after 100 blocks, as an unplugged device would
    result = recorder.stop()

    assert result.error == f"The input device stopped: {MIC} stopped delivering audio"
    assert (result.sample_rate, result.channels, result.bits, result.frames) == (44100, 1, 24, 44100)
    assert result.overflows == 2 and result.latency == 0.0106 and len(levels) == 10
    with wave.open(str(tmp_path / "take.wav"), "rb") as handle:
        raw = handle.readframes(handle.getnframes())
        assert (handle.getframerate(), handle.getsampwidth()) == (44100, 3)
    assert raw == to_pcm(synthetic_tone(0, 44100, 44100, 1), 24)


def test_record_can_take_two_channels_but_never_more_than_the_endpoint_has(tmp_path):
    sd = FakeSounddevice([_device(MIC, channels=1)], blocks=10)
    recorder = _backend(sd).record(MIC, tmp_path / "take.wav", channels=2, bits=16)
    recorder.failed.wait(10)
    assert recorder.stop().channels == 1 == read_wav_header(tmp_path / "take.wav").channels


def test_record_refuses_an_unknown_device_before_it_creates_a_file(tmp_path):
    with pytest.raises(OSError, match='no WASAPI input device called "Line In"'):
        _backend(FakeSounddevice([_device(MIC)])).record("Line In", tmp_path / "take.wav")
    assert not (tmp_path / "take.wav").exists()


def test_a_device_that_will_not_open_leaves_an_empty_valid_file_and_raises(tmp_path):
    sd = FakeSounddevice([_device(MIC)], refuse_open=True)
    with pytest.raises(OSError, match="Device unavailable"):
        _backend(sd).record(MIC, tmp_path / "take.wav")
    assert read_wav_header(tmp_path / "take.wav").frames == 0


def test_stopping_a_take_releases_the_device_once(tmp_path):
    sd = FakeSounddevice([_device(MIC)], blocks=10_000)
    recorder = _backend(sd).record(MIC, tmp_path / "take.wav")
    result = recorder.stop()
    recorder.stop()
    assert result.error is None
    assert (sd.streams[0].stopped, sd.streams[0].closed) == (1, 1)
