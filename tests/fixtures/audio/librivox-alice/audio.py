"""Decode, edit and write the corpus audio: MP3 in (PyAV, which faster-whisper already depends on), 16-bit WAV out.

Every join is a short equal-power crossfade at a quiet point, so an edit never adds a click of its own: a click in a
built file is one a recipe put there on purpose.
"""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

FADE_SECONDS = 0.01
FRAME_SECONDS = 0.03
HOP_SECONDS = 0.01


def decode(path: Path) -> tuple[np.ndarray, int]:
    """The file as mono float32 in [-1, 1] at its own sample rate."""
    import av

    with av.open(str(path)) as container:
        stream = container.streams.audio[0]
        rate = stream.codec_context.sample_rate
        resampler = av.AudioResampler(format="flt", layout="mono", rate=rate)
        chunks = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    return np.concatenate(chunks).astype(np.float32), rate


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.round(samples * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(pcm.tobytes())


def frame_levels(samples: np.ndarray, rate: int) -> np.ndarray:
    """RMS level in dBFS of a 30 ms window every 10 ms; index i is centred at i * 10 ms."""
    hop, width = int(rate * HOP_SECONDS), int(rate * FRAME_SECONDS)
    count = max(1, len(samples) // hop)
    padded = np.concatenate([np.zeros(width // 2, np.float32), samples, np.zeros(width, np.float32)])
    squares = np.concatenate([[0.0], np.cumsum(padded.astype(np.float64) ** 2)])
    starts = np.arange(count) * hop
    energy = (squares[starts + width] - squares[starts]) / width
    return 10 * np.log10(np.maximum(energy, 1e-12))


def quietest(levels: np.ndarray, start: float, end: float) -> tuple[float, float]:
    """The time and level of the quietest frame between start and end (seconds)."""
    lo = max(0, round(start / HOP_SECONDS))
    hi = min(len(levels), max(lo + 1, round(end / HOP_SECONDS) + 1))
    index = lo + int(np.argmin(levels[lo:hi]))
    return round(index * HOP_SECONDS, 2), float(levels[index])


def join(pieces: list[np.ndarray], rate: int) -> np.ndarray:
    """Concatenate with an equal-power crossfade of FADE_SECONDS at every join."""
    fade = int(rate * FADE_SECONDS)
    ramp = np.sin(np.linspace(0, np.pi / 2, fade, dtype=np.float32)) ** 2
    out = np.zeros(0, np.float32)
    for piece in pieces:
        piece = piece.astype(np.float32)
        if len(out) < fade or len(piece) < fade:
            out = np.concatenate([out, piece])
            continue
        mixed = out[-fade:] * ramp[::-1] + piece[:fade] * ramp
        out = np.concatenate([out[:-fade], mixed, piece[fade:]])
    return out


def room_tone(samples: np.ndarray, rate: int, levels: np.ndarray, seconds: float) -> np.ndarray:
    """`seconds` of the recording's own room tone: its longest quiet stretch, tiled with crossfades."""
    speech = float(np.percentile(levels, 90))
    quiet = np.append(levels < speech - 35, False)
    best, run_start, best_span = 0, None, (0, 1)
    for i, flag in enumerate(quiet):
        if flag and run_start is None:
            run_start = i
        elif not flag and run_start is not None:
            if i - run_start > best:
                best, best_span = i - run_start, (run_start, i)
            run_start = None
    margin = int(rate * 0.03)
    lo, hi = int(best_span[0] * HOP_SECONDS * rate) + margin, int(best_span[1] * HOP_SECONDS * rate) - margin
    tile = samples[lo:hi] if hi - lo > rate * 0.1 else np.zeros(int(rate * 0.1), np.float32)
    needed = int(seconds * rate)
    step = max(1, len(tile) - int(rate * FADE_SECONDS))
    return join([tile] * (needed // step + 2), rate)[:needed]


def gain(samples: np.ndarray, decibels: float) -> np.ndarray:
    return samples * np.float32(10 ** (decibels / 20))
