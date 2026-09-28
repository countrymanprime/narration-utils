"""From a device's native blocks to the capture port's chunks (ADR 0357).

A WASAPI shared-mode stream delivers ``(frames, channels)`` blocks at the device's own rate (usually 48 kHz), in whatever
block size the engine picks. The recorder writes those unchanged. The capture port's ``chunks()`` instead promises 1-D
``float32`` mono at 16 kHz, each exactly ``chunk_samples`` long except the last (``narration_common.ports.capture``), so:

- ``downmix`` averages the channels to mono;
- ``LinearResampler`` converts the rate as a stream, carrying its position across blocks so no sample is lost or repeated
  at a block boundary. Going down it first averages over one output step (a box filter), which keeps most of what is
  above the new Nyquist out of the result. This feeds speech recognition, not the take: the take is never resampled;
- ``Framer`` cuts the result into whole chunks and keeps the rest for the next block; ``flush()`` gives the last, shorter
  chunk (never an empty one).
"""

import math

import numpy as np


def downmix(block: np.ndarray) -> np.ndarray:
    """A ``(frames,)`` or ``(frames, channels)`` block as 1-D ``float32`` mono."""
    frames = np.asarray(block, dtype=np.float32)
    if frames.ndim == 1:
        return frames
    if frames.ndim != 2 or frames.shape[1] < 1:
        raise ValueError(f"a block is (frames,) or (frames, channels), not {frames.shape}")
    return frames.mean(axis=1, dtype=np.float32)


class LinearResampler:
    """Streams mono audio from ``source_rate`` to ``target_rate`` by linear interpolation."""

    def __init__(self, source_rate: int, target_rate: int):
        if source_rate <= 0 or target_rate <= 0:
            raise ValueError(f"rates are positive, not {source_rate} and {target_rate}")
        self.step = source_rate / target_rate
        self._taps = max(1, round(self.step)) if self.step > 1 else 1
        self._history = np.zeros(self._taps - 1, dtype=np.float64)
        self._buffer = np.zeros(0, dtype=np.float64)
        self._position = 0.0  # of the next output sample, in samples from the start of _buffer

    def _smooth(self, samples: np.ndarray) -> np.ndarray:
        if self._taps == 1:
            return samples
        padded = np.concatenate([self._history, samples])
        self._history = padded[len(padded) - (self._taps - 1) :]
        return np.convolve(padded, np.full(self._taps, 1.0 / self._taps), mode="valid")

    def feed(self, samples: np.ndarray) -> np.ndarray:
        if self.step == 1:
            return np.asarray(samples, dtype=np.float32)
        buffer = np.concatenate([self._buffer, self._smooth(np.asarray(samples, dtype=np.float64))])
        last = len(buffer) - 1
        if last < 1 or self._position > last - 1:
            self._buffer = buffer
            return np.zeros(0, dtype=np.float32)
        # Every output whose right neighbour has arrived: position + k * step <= last - 1.
        count = math.floor((last - 1 - self._position) / self.step) + 1
        positions = self._position + self.step * np.arange(count)
        index = positions.astype(np.int64)
        fraction = positions - index
        out = buffer[index] * (1.0 - fraction) + buffer[index + 1] * fraction
        next_position = self._position + count * self.step
        drop = min(math.floor(next_position), len(buffer))  # the next output may lie past what has arrived
        self._buffer = buffer[drop:]
        self._position = next_position - drop
        return out.astype(np.float32)


class Framer:
    """Cuts a stream of 1-D samples into chunks of ``chunk`` samples."""

    def __init__(self, chunk: int):
        if chunk < 1:
            raise ValueError(f"a chunk holds at least one sample, not {chunk}")
        self.chunk = chunk
        self._pending = np.zeros(0, dtype=np.float32)

    def feed(self, samples: np.ndarray) -> list[np.ndarray]:
        pending = np.concatenate([self._pending, np.asarray(samples, dtype=np.float32)])
        whole = len(pending) - len(pending) % self.chunk
        self._pending = pending[whole:]
        return [pending[start : start + self.chunk] for start in range(0, whole, self.chunk)]

    def flush(self) -> np.ndarray | None:
        """The last, shorter chunk, or None when nothing is left."""
        rest, self._pending = self._pending, np.zeros(0, dtype=np.float32)
        return rest if len(rest) else None
