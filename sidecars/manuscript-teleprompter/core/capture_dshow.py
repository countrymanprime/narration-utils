"""The capture port's dshow adapter (provider-ports P11, ADR 0301): what `devices.py`'s device listing and the old
`iter_microphone_chunks` become as the `dshow` row of `narration_common.ports.capture.BACKENDS`. Everything a Windows
DirectShow microphone needs - listing devices and opening one as chunks of mono audio - was already here; this only
gives it the port's shape, so `live_asr.py`'s two capture callers (the session and the level meter) can ask the
registry for the backend instead of importing `devices` and calling `iter_microphone_chunks` by name.

`devices.Device` already satisfies the port's `InputDevice` Protocol (a `name` and a `to_json()` that carries it), so
`list_devices()` is `devices.list_input_devices()` unchanged. `chunks()` is the body of the old
`iter_microphone_chunks`, moved here verbatim (same PyAV open/resample/chunk loop, same Ctrl+C handling for manual
CLI use); `live_asr.py` keeps a same-named, same-signature `iter_microphone_chunks` that only looks this backend up
and delegates, so its own tests (which patch that name directly) still drive the same generator they always did, and
running off Windows still fails exactly where it always did - opening `format="dshow"` through PyAV - not at the
lookup, which does not check platform any more than `ENGINES.lookup` does for a speech engine (provider-ports P5).
"""

import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

import devices
from narration_common.logging_utils import log
from narration_common.ports.capture import BACKENDS, CHUNK_SECONDS, SAMPLE_RATE, CaptureDescriptor


class DshowBackend:
    """The one capture backend this sidecar has today: PyAV's Windows DirectShow input (see `devices.py`'s module
    docstring for how listing works and the spike note verifying real-hardware capture)."""

    descriptor = CaptureDescriptor(name="dshow", label="DirectShow", platforms=("windows",))

    def list_devices(self) -> tuple[list[Any], str | None]:
        return devices.list_input_devices()

    def chunks(self, device: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
        """Capture live mic audio via PyAV's Windows dshow input, resampled the same way `iter_wav_chunks` resamples
        a file. Manual-testing path only (see `devices.py`); Ctrl+C ends the stream so buffered audio is still
        decoded - a session instead stops it with a sentinel file (`stoppable`, in `live_asr.py`)."""
        import av

        container = av.open(file=f"audio={device}", format="dshow")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        chunk_len = max(1, int(chunk_seconds * SAMPLE_RATE))

        pending = np.zeros(0, dtype=np.float32)
        try:
            for frame in container.decode(stream):
                for rframe in resampler.resample(frame):
                    pending = np.concatenate([pending, rframe.to_ndarray()[0].astype(np.float32)])
                    while len(pending) >= chunk_len:
                        yield pending[:chunk_len]
                        pending = pending[chunk_len:]
        except KeyboardInterrupt:
            log("Stopping...")
        finally:
            container.close()
        if len(pending) > 0:
            yield pending


BACKENDS.register(DshowBackend())
