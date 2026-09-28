"""The capture port's `wasapi` row: the built-in recorder's engine (native-recording-suite PRD Phase 1, ADR 0357).

WASAPI in shared mode, through PortAudio's WASAPI host API as the `sounddevice` package binds it. That is the PRD's
recommended shape (Q3, answered by D86): a proven library rather than hand-written COM calls, in a sidecar rather than in
the Go host, whose Windows build is `CGO_ENABLED=0`. It sits beside `capture_dshow.py` in this sidecar and registers
into the same `BACKENDS`, after `dshow`, so `dshow` stays the default and the teleprompter's own capture does not change.

It does what the port asks of every row:

- `list_devices()` lists the WASAPI input endpoints (never raises; a failure is a sentence). A device's name opens it;
  two endpoints with one name get a ` [2]` suffix, so a name is never ambiguous.
- `chunks(device)` opens the endpoint at its own shared-mode rate and gives the port's 16 kHz mono chunks
  (`narration_common.recording.framing`), so the teleprompter could listen through it too.

and the one thing the dshow row cannot:

- `record(device, path)` records a take: the endpoint's own rate (the shared-mode mix format, usually 48 kHz), mono
  by default, written as it arrives to a 24-bit WAV that is never resampled, with level events and dropout counts
  (`narration_common.recording.Recorder`).

It is **Experimental** (`LEVEL`): built and tested against a faked `sounddevice`, measured on CI's Windows runner, not yet
through the owner's check with a real microphone (#510). The Booth's "Built-in recorder" (PRD Phase 2, ADR 0455) calls it
through live_asr.py's --record, --meter and --list-devices with --capture wasapi. It opens only the local device and writes only the file it is
given: no network, no telemetry (D72). `sounddevice` is imported only when a device is listed or opened; in a build or on
a host without it (Linux) listing says so in a sentence.
"""

import queue
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

# dshow registers first, whoever imports this module first: it stays the default row (BACKENDS' first for Windows).
import capture_dshow  # noqa: F401
from narration_common.ports.capture import BACKENDS, CHUNK_SECONDS, SAMPLE_RATE, CaptureDescriptor, chunk_samples
from narration_common.ports.registry import Level
from narration_common.recording import Framer, LinearResampler, Recorder, downmix

WASAPI_HOST_API = "Windows WASAPI"
LEVEL = Level.Experimental
# How long chunks() waits for the next block before it calls the device stopped. A device delivers every ~10 ms.
SILENT_DEVICE_SECONDS = 2.0


def _sounddevice() -> Any:
    """The `sounddevice` module; raises ImportError or OSError (no PortAudio) where it cannot load."""
    import sounddevice

    return sounddevice


@dataclass(frozen=True)
class WasapiDevice:
    """One WASAPI input endpoint. `name` opens it; the rest is what a take at its own format needs."""

    name: str
    index: int
    channels: int
    sample_rate: int
    low_latency: float

    def to_json(self) -> dict[str, Any]:
        return {"name": self.name}


def _wasapi_devices(sd: Any) -> list[WasapiDevice]:
    host_apis = sd.query_hostapis()
    wasapi = next((api for api in host_apis if api.get("name") == WASAPI_HOST_API), None)
    if wasapi is None:
        return []
    devices: list[WasapiDevice] = []
    seen: dict[str, int] = {}
    for index in wasapi.get("devices", []):
        info = sd.query_devices(index)
        if int(info.get("max_input_channels", 0)) < 1:
            continue
        base = str(info["name"]).strip()
        seen[base] = seen.get(base, 0) + 1
        name = base if seen[base] == 1 else f"{base} [{seen[base]}]"
        devices.append(
            WasapiDevice(
                name=name,
                index=int(index),
                channels=int(info["max_input_channels"]),
                sample_rate=round(float(info["default_samplerate"])),
                low_latency=float(info.get("default_low_input_latency", 0.0)),
            )
        )
    return devices


class WasapiSource:
    """A WASAPI shared-mode input stream as the recorder's `Source`: the endpoint's own rate, `channels` of it."""

    def __init__(self, sd: Any, device: WasapiDevice, channels: int = 1):
        self._sd = sd
        self.device = device
        self.sample_rate = device.sample_rate
        self.channels = max(1, min(channels, device.channels))
        self._stream: Any = None
        self._stopping = False
        self._latency = 0.0

    @property
    def latency(self) -> float:
        """PortAudio's reported input latency for the open stream, kept after it closes for the take's result."""
        return self._latency

    def start(self, deliver: Callable[[np.ndarray, bool], None], fail: Callable[[BaseException], None]) -> None:
        def callback(indata: np.ndarray, _frames: int, _time: Any, status: Any) -> None:
            deliver(indata, bool(getattr(status, "input_overflow", False)))

        def finished() -> None:
            # PortAudio calls this whenever the stream goes inactive; only an end we did not ask for is an error.
            if not self._stopping:
                fail(OSError(f"{self.device.name} stopped delivering audio"))

        self._stopping = False

        self._stream = self._sd.InputStream(
            device=self.device.index,
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="float32",
            latency="low",
            extra_settings=self._sd.WasapiSettings(exclusive=False),
            callback=callback,
            finished_callback=finished,
        )
        self._stream.start()
        self._latency = float(self._stream.latency)

    def stop(self) -> None:
        stream, self._stream = self._stream, None
        if stream is None:
            return
        self._stopping = True
        try:
            stream.stop()
        finally:
            stream.close()


class WasapiBackend:
    """The `wasapi` row; see the module docstring."""

    descriptor = CaptureDescriptor(name="wasapi", label="WASAPI", platforms=("windows",))
    level = LEVEL

    def __init__(self, load: Callable[[], Any] = _sounddevice):
        self._load = load

    def list_devices(self) -> tuple[list[WasapiDevice], str | None]:
        try:
            sd = self._load()
        except (ImportError, OSError) as error:
            return [], f"The built-in recorder cannot list devices here: {error}"
        try:
            return _wasapi_devices(sd), None
        except Exception as error:  # noqa: BLE001 - a listing never raises (the capture port's rule)
            return [], f"Could not list WASAPI input devices: {error}"

    def _open(self, device: str) -> tuple[Any, WasapiDevice]:
        sd = self._load()
        for candidate in _wasapi_devices(sd):
            if candidate.name == device:
                return sd, candidate
        raise OSError(f'There is no WASAPI input device called "{device}".')

    def chunks(self, device: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
        """The port's 16 kHz mono chunks from `device`, opened at its own rate. A live device never ends on its own, so
        every chunk is whole; the stream ends when it is closed (which releases the device) or the device fails."""
        sd, endpoint = self._open(device)
        source = WasapiSource(sd, endpoint, channels=1)
        blocks: queue.Queue = queue.Queue()
        source.start(lambda block, _overflowed: blocks.put(np.array(block, dtype=np.float32)), blocks.put)
        resampler = LinearResampler(source.sample_rate, SAMPLE_RATE)
        framer = Framer(chunk_samples(chunk_seconds))
        try:
            while True:
                try:
                    item = blocks.get(timeout=SILENT_DEVICE_SECONDS)
                except queue.Empty as error:
                    raise TimeoutError(f"{endpoint.name} delivered no audio for {SILENT_DEVICE_SECONDS:g} seconds") from error
                if isinstance(item, BaseException):
                    raise item
                yield from framer.feed(resampler.feed(downmix(item)))
        finally:
            source.stop()

    def record(self, device: str, path: str | Path, *, channels: int = 1, bits: int = 24, on_level: Callable[[dict], None] | None = None) -> Recorder:
        """Starts a take of `device` into `path` (which must not exist yet) and returns the running `Recorder`; its
        `stop()` finishes the file and returns the take's `RecordingResult`."""
        sd, endpoint = self._open(device)
        return Recorder(WasapiSource(sd, endpoint, channels), path, bits=bits, on_level=on_level).start()


BACKENDS.register(WasapiBackend())
