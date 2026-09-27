"""The capture port's Core Audio (macOS) adapter (docs/prds/coreaudio-capture.prd.md Phase 1, ADR 0402): what
`devices_avfoundation.py`'s device listing and a resample/chunk loop mirroring `capture_dshow.py`'s become as the `coreaudio`
row of `narration_common.ports.capture.BACKENDS`. This is `dshow`'s exact shape ported to FFmpeg's `avfoundation` demuxer -
PyAV's macOS input device, which reaches Core Audio through `AVCaptureDevice`/`AVCaptureSession` underneath.

The one real difference from `dshow`: `avfoundation` addresses a device by index (`av.open(file=":0", format="avfoundation")`),
not by the name it was listed under. `CaptureBackend.chunks(device: str, ...)`'s contract - a caller opens the exact string
`list_devices()` returned - stays unchanged for every caller: `chunks()` resolves `device` back to FFmpeg's index internally
(`devices_avfoundation.resolve_index`), fresh on every open, never cached (PRD Q1/Q3 - a cached index could go stale across a
hot-plug or reboot, unverified without real Apple hardware, PRD Q2).
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

import devices_avfoundation
from narration_common.logging_utils import log
from narration_common.ports.capture import BACKENDS, CHUNK_SECONDS, SAMPLE_RATE, CaptureDescriptor


class CoreAudioBackend:
    """The macOS capture backend: PyAV's `avfoundation` input (see `devices_avfoundation.py`'s module docstring for how listing
    and index resolution work; real-hardware verification is Phase 2, PRD Q2)."""

    descriptor = CaptureDescriptor(name="coreaudio", label="Core Audio", platforms=("darwin",))

    def list_devices(self) -> tuple[list[Any], str | None]:
        return devices_avfoundation.list_input_devices()

    def chunks(self, device: str, chunk_seconds: float = CHUNK_SECONDS) -> Iterator[np.ndarray]:
        """Capture live mic audio via PyAV's avfoundation input, resampled the same way capture_dshow.py's `chunks` resamples
        one. `device` is resolved to FFmpeg's index fresh here, not before: a generator's body does not run until first
        iterated, so a name that no longer resolves raises on the first `next()`, exactly as the conformance suite requires for
        a missing device."""
        import av

        index = devices_avfoundation.resolve_index(device)
        container = av.open(file=f":{index}", format="avfoundation")
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


BACKENDS.register(CoreAudioBackend())
