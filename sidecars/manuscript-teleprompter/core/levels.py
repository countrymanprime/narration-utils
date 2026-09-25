"""Input level for the Read Aloud meter (read-aloud-control-bar PRD Phase 4, Q6 A).

The meter measures exactly what the recognizer hears: the capture path's own 16 kHz mono chunks, after resampling. Each
chunk (0.32 s) is too coarse for a meter, so the samples are cut into 50 ms windows and reported every 100 ms as

    {"type": "level", "peak": -12.3, "rms": -24.1}

`peak` is the largest absolute sample in the 100 ms and `rms` the loudest of its two 50 ms windows, both in dBFS, rounded
to 0.1 dB, clamped to 0.0 above full scale and to FLOOR_DBFS in silence (JSON has no -inf). That is about ten events a
second, whatever the chunk size; samples left over wait for the next chunk. A session reports levels beside its words,
and `live_asr.py --meter` reports only levels, with no model, so the narrator can check the microphone before Start.
"""

import math
from collections.abc import Callable, Iterable, Iterator

import numpy as np

SAMPLE_RATE = 16000
WINDOW_SAMPLES = SAMPLE_RATE // 20  # 50 ms
REPORT_SAMPLES = 2 * WINDOW_SAMPLES  # 100 ms
FLOOR_DBFS = -100.0


def dbfs(value: float) -> float:
    """An amplitude (1.0 is full scale) in dBFS, between FLOOR_DBFS and 0.0."""
    if value <= 0:
        return FLOOR_DBFS
    return round(min(0.0, max(FLOOR_DBFS, 20 * math.log10(value))), 1)


class LevelMeter:
    """Turns chunks of any size into one `level` event per 100 ms of audio."""

    def __init__(self) -> None:
        self._pending = np.zeros(0, dtype=np.float32)

    def feed(self, chunk: np.ndarray) -> list[dict]:
        samples = np.concatenate([self._pending, np.asarray(chunk, dtype=np.float32)])
        whole = len(samples) - len(samples) % REPORT_SAMPLES
        self._pending = samples[whole:]
        events = []
        for start in range(0, whole, REPORT_SAMPLES):
            report = samples[start : start + REPORT_SAMPLES].astype(np.float64)
            windows = report.reshape(-1, WINDOW_SAMPLES)
            rms = float(np.sqrt(np.mean(windows * windows, axis=1)).max())
            events.append({"type": "level", "peak": dbfs(float(np.abs(report).max())), "rms": dbfs(rms)})
        return events


def metered(chunks: Iterable[np.ndarray], meter: LevelMeter, report: Callable[[dict], None]) -> Iterator[np.ndarray]:
    """Pass chunks through, reporting each one's levels as it arrives, before the engine sees it."""
    for chunk in chunks:
        for event in meter.feed(chunk):
            report(event)
        yield chunk
