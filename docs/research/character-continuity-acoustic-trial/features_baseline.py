"""Dependency-free acoustic features (character-continuity-review PRD, Open Question Q1
option A): pitch distribution, speaking rate, energy distribution, coarse spectral summary.

Hand-written, numpy-only (numpy is already a repository dependency; this trial script is
not the shipped implementation - the MVP is Go per ADR 0025 - it exists to decide whether
Q1 option A's *kind* of feature is worth building there at all). No torch, no scipy, no
librosa: consistent with ADR 0008 (no PyTorch dependency).
"""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

FRAME_MS = 40.0
HOP_MS = 10.0
MIN_F0 = 60.0
MAX_F0 = 400.0
VOICED_ENERGY_PERCENTILE = 40.0  # frames below this RMS percentile count as unvoiced/silence


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    return samples, sr


def _frame(samples: np.ndarray, sr: int) -> tuple[np.ndarray, int, int]:
    frame_len = int(sr * FRAME_MS / 1000)
    hop_len = int(sr * HOP_MS / 1000)
    if samples.shape[0] < frame_len:
        return np.zeros((0, frame_len)), frame_len, hop_len
    n_frames = 1 + (samples.shape[0] - frame_len) // hop_len
    frames = np.stack([samples[i * hop_len : i * hop_len + frame_len] for i in range(n_frames)])
    return frames, frame_len, hop_len


def _autocorrelation_f0(frame: np.ndarray, sr: int) -> float | None:
    """A minimal autocorrelation pitch tracker: the classic, explainable baseline the
    PRD's Q1 recommends (with the caveat that a hand-written tracker has known
    octave-error failure modes, which is exactly what this trial is meant to quantify)."""
    windowed = frame * np.hanning(frame.shape[0])
    corr = np.correlate(windowed, windowed, mode="full")[frame.shape[0] - 1 :]
    if corr[0] <= 1e-9:
        return None
    corr = corr / corr[0]
    lag_min = int(sr / MAX_F0)
    lag_max = min(int(sr / MIN_F0), corr.shape[0] - 1)
    if lag_max <= lag_min:
        return None
    search = corr[lag_min:lag_max]
    peak_lag = int(np.argmax(search)) + lag_min
    if corr[peak_lag] < 0.3:
        return None
    return sr / peak_lag


def _spectral_bands(frame: np.ndarray, sr: int) -> tuple[float, float, float, float]:
    """Coarse spectral summary: centroid plus energy fraction in three bands, from a
    hand-written FFT call (numpy.fft; a shipped Go build would hand-roll the FFT itself,
    per Q1 - the trial only needs the same *shape* of feature, not the same code)."""
    windowed = frame * np.hanning(frame.shape[0])
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(frame.shape[0], d=1.0 / sr)
    power = spectrum**2
    total = power.sum() + 1e-12
    centroid = float((freqs * power).sum() / total)
    low = float(power[(freqs >= 0) & (freqs < 1000)].sum() / total)
    mid = float(power[(freqs >= 1000) & (freqs < 3000)].sum() / total)
    high = float(power[freqs >= 3000].sum() / total)
    return centroid, low, mid, high


@dataclass
class ClipFeatures:
    path: str
    voiced_fraction: float
    f0_median: float | None
    f0_p10: float | None
    f0_p90: float | None
    rate_voiced_runs_per_s: float
    rms_mean: float
    rms_std: float
    spectral_centroid_mean: float
    band_low_mean: float
    band_mid_mean: float
    band_high_mean: float


def extract(path: Path) -> ClipFeatures:
    samples, sr = read_wav(path)
    frames, _, _ = _frame(samples, sr)
    duration_s = samples.shape[0] / sr if sr else 0.0

    rms = np.sqrt(np.mean(frames**2, axis=1)) if frames.shape[0] else np.zeros(0)
    voiced_thresh = np.percentile(rms, VOICED_ENERGY_PERCENTILE) if rms.shape[0] else 0.0
    voiced_mask = rms > max(voiced_thresh, 1e-4)

    f0_values: list[float] = []
    centroids: list[float] = []
    lows: list[float] = []
    mids: list[float] = []
    highs: list[float] = []
    for i, frame in enumerate(frames):
        if not voiced_mask[i]:
            continue
        f0 = _autocorrelation_f0(frame, sr)
        if f0 is not None:
            f0_values.append(f0)
        centroid, low, mid, high = _spectral_bands(frame, sr)
        centroids.append(centroid)
        lows.append(low)
        mids.append(mid)
        highs.append(high)

    voiced_runs = int(np.sum(np.diff(np.concatenate(([0], voiced_mask.astype(int), [0]))) == 1))

    return ClipFeatures(
        path=str(path),
        voiced_fraction=float(voiced_mask.mean()) if voiced_mask.shape[0] else 0.0,
        f0_median=float(np.median(f0_values)) if f0_values else None,
        f0_p10=float(np.percentile(f0_values, 10)) if f0_values else None,
        f0_p90=float(np.percentile(f0_values, 90)) if f0_values else None,
        rate_voiced_runs_per_s=voiced_runs / duration_s if duration_s > 0 else 0.0,
        rms_mean=float(rms.mean()) if rms.shape[0] else 0.0,
        rms_std=float(rms.std()) if rms.shape[0] else 0.0,
        spectral_centroid_mean=float(np.mean(centroids)) if centroids else 0.0,
        band_low_mean=float(np.mean(lows)) if lows else 0.0,
        band_mid_mean=float(np.mean(mids)) if mids else 0.0,
        band_high_mean=float(np.mean(highs)) if highs else 0.0,
    )


def feature_vector(f: ClipFeatures) -> np.ndarray | None:
    """A comparable numeric vector for distance-based separability tests. None when the
    clip had no measurable pitch (the PRD's "unavailable evidence" path, never a
    fabricated number)."""
    if f.f0_median is None:
        return None
    return np.array(
        [
            f.f0_median,
            (f.f0_p90 - f.f0_p10) if (f.f0_p90 is not None and f.f0_p10 is not None) else 0.0,
            f.rate_voiced_runs_per_s,
            f.rms_mean,
            f.spectral_centroid_mean,
            f.band_low_mean,
            f.band_mid_mean,
            f.band_high_mean,
        ]
    )


FEATURE_NAMES = [
    "f0_median_hz",
    "f0_p10_90_range_hz",
    "rate_voiced_runs_per_s",
    "rms_mean",
    "spectral_centroid_hz",
    "band_low_frac",
    "band_mid_frac",
    "band_high_frac",
]
