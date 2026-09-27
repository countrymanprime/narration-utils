"""Generate a synthetic "solo dramatic reading" corpus for the character-continuity acoustic trial.

Fallback route (docs/research/local-dependency-evaluation.md, Phase 1 of
docs/prds/character-continuity-review.prd.md): the sandbox's egress proxy denies
librivox.org and archive.org (403 policy denial, not a fixable client/cert issue -
see docs/research/character-continuity-acoustic-trial.md "Corpus route"), so this
script builds controlled pitch/rate/formant variants of one source voice instead of
downloading a real LibriVox reading.

Every character is a deterministic parameter set (F0, formants, speaking rate,
energy). Nothing here is a recording of a real person; there is no provenance to
hand-check because the labels are exact by construction. Output is 16-bit mono PCM
WAV, written under an output directory that must be outside the repository (the
corpus and every derived feature file are local scratch data, never committed).
"""

from __future__ import annotations

import json
import math
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SAMPLE_RATE = 22050


@dataclass(frozen=True)
class VoiceParams:
    """One "character" (or narration): a fixed, reproducible acoustic identity."""

    name: str
    f0_mean: float  # Hz
    f0_jitter: float  # fraction of f0_mean, per-syllable random walk step
    formants: tuple[float, float, float]  # F1, F2, F3 in Hz
    formant_bandwidths: tuple[float, float, float]
    syllable_dur_mean: float  # seconds
    syllable_dur_std: float
    gap_dur_mean: float  # seconds, between syllables
    gap_dur_std: float
    amplitude: float  # 0..1, target RMS-ish level


# Five clearly differentiated characters plus narration, all derived from one
# synthesis engine ("one source voice" in the fallback-route sense: the same
# glottal-pulse-plus-formant-filter model, with different control parameters).
VOICES: dict[str, VoiceParams] = {
    "narration": VoiceParams(
        name="narration",
        f0_mean=140.0,
        f0_jitter=0.02,
        formants=(700.0, 1220.0, 2600.0),
        formant_bandwidths=(80.0, 90.0, 120.0),
        syllable_dur_mean=0.18,
        syllable_dur_std=0.03,
        gap_dur_mean=0.06,
        gap_dur_std=0.02,
        amplitude=0.55,
    ),
    "the_captain": VoiceParams(
        name="the_captain",
        f0_mean=95.0,
        f0_jitter=0.015,
        formants=(600.0, 1000.0, 2300.0),
        formant_bandwidths=(70.0, 80.0, 110.0),
        syllable_dur_mean=0.22,
        syllable_dur_std=0.04,
        gap_dur_mean=0.05,
        gap_dur_std=0.015,
        amplitude=0.70,
    ),
    "young_ellen": VoiceParams(
        name="young_ellen",
        f0_mean=255.0,
        f0_jitter=0.03,
        formants=(850.0, 1700.0, 2900.0),
        formant_bandwidths=(90.0, 100.0, 130.0),
        syllable_dur_mean=0.14,
        syllable_dur_std=0.025,
        gap_dur_mean=0.04,
        gap_dur_std=0.015,
        amplitude=0.50,
    ),
    "old_marlow": VoiceParams(
        name="old_marlow",
        f0_mean=110.0,
        f0_jitter=0.05,
        formants=(650.0, 1100.0, 2450.0),
        formant_bandwidths=(100.0, 110.0, 150.0),
        syllable_dur_mean=0.26,
        syllable_dur_std=0.06,
        gap_dur_mean=0.09,
        gap_dur_std=0.03,
        amplitude=0.45,
    ),
    "widow_hart": VoiceParams(
        name="widow_hart",
        f0_mean=205.0,
        f0_jitter=0.02,
        formants=(780.0, 1500.0, 2750.0),
        formant_bandwidths=(75.0, 85.0, 115.0),
        syllable_dur_mean=0.17,
        syllable_dur_std=0.03,
        gap_dur_mean=0.055,
        gap_dur_std=0.02,
        amplitude=0.60,
    ),
    "page_boy": VoiceParams(
        name="page_boy",
        f0_mean=300.0,
        f0_jitter=0.04,
        formants=(900.0, 1900.0, 3100.0),
        formant_bandwidths=(95.0, 105.0, 140.0),
        syllable_dur_mean=0.12,
        syllable_dur_std=0.02,
        gap_dur_mean=0.035,
        gap_dur_std=0.01,
        amplitude=0.48,
    ),
}

CHARACTER_NAMES = [name for name in VOICES if name != "narration"]


def _resonant_biquad(freq: float, bandwidth: float, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """A single resonant (formant) filter, direct-form II biquad band-pass."""
    r = math.exp(-math.pi * bandwidth / sr)
    theta = 2 * math.pi * freq / sr
    a = np.array([1.0, -2 * r * math.cos(theta), r * r])
    b = np.array([1 - r])
    return b, a


def _apply_iir(x: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    """A one-zero, two-pole resonator: y[n] = b0*x[n] - a1*y[n-1] - a2*y[n-2]."""
    y = np.zeros_like(x)
    y1 = y2 = 0.0
    b0 = b[0]
    a1, a2 = a[1], a[2]
    for n in range(x.shape[0]):
        yv = b0 * x[n] - a1 * y1 - a2 * y2
        y[n] = yv
        y2, y1 = y1, yv
    return y


def _glottal_pulse_train(f0_track: np.ndarray, sr: int, rng: np.random.Generator) -> np.ndarray:
    """A band-limited impulse train at the instantaneous F0, shaped -12 dB/oct."""
    n = f0_track.shape[0]
    phase = np.cumsum(f0_track) / sr
    pulses = (np.diff(np.floor(phase), prepend=0.0) > 0).astype(np.float64)
    # Spectral tilt: a simple one-pole low-pass approximates the glottal source's rolloff.
    tilt = np.zeros(n)
    prev = 0.0
    alpha = 0.9
    for i in range(n):
        prev = alpha * prev + (1 - alpha) * pulses[i]
        tilt[i] = prev
    tilt += rng.normal(0.0, 0.01, size=n)  # breath noise floor
    return tilt


def synthesize_line(voice: VoiceParams, n_syllables: int, rng: np.random.Generator) -> np.ndarray:
    """One utterance: a run of voiced syllables separated by short gaps."""
    chunks: list[np.ndarray] = []
    f0 = voice.f0_mean
    for _ in range(n_syllables):
        dur = max(0.04, rng.normal(voice.syllable_dur_mean, voice.syllable_dur_std))
        n = int(dur * SAMPLE_RATE)
        f0 *= math.exp(rng.normal(0.0, voice.f0_jitter))
        f0 = min(max(f0, voice.f0_mean * 0.6), voice.f0_mean * 1.6)
        vibrato = 1.0 + 0.01 * np.sin(2 * np.pi * 5.5 * np.arange(n) / SAMPLE_RATE)
        f0_track = np.full(n, f0) * vibrato
        source = _glottal_pulse_train(f0_track, SAMPLE_RATE, rng)
        signal = np.zeros(n)
        for freq, bw in zip(voice.formants, voice.formant_bandwidths):
            b, a = _resonant_biquad(freq, bw, SAMPLE_RATE)
            signal += _apply_iir(source, b, a)
        signal /= max(np.abs(signal).max(), 1e-9)
        envelope = np.hanning(n)
        chunks.append(signal * envelope * voice.amplitude)

        gap = max(0.01, rng.normal(voice.gap_dur_mean, voice.gap_dur_std))
        chunks.append(np.zeros(int(gap * SAMPLE_RATE)) + rng.normal(0.0, 0.002, int(gap * SAMPLE_RATE)))
    return np.concatenate(chunks) if chunks else np.zeros(0)


def write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())


@dataclass
class ManifestLine:
    chapter: int
    character: str
    line_index: int
    path: str
    duration_s: float
    is_reference_eligible: bool  # narrator-approved-reference stand-in: True for all synthetic lines


@dataclass
class Manifest:
    sample_rate: int = SAMPLE_RATE
    lines: list[ManifestLine] = field(default_factory=list)


def generate_corpus(out_dir: Path, n_chapters: int = 4, seed: int = 20260927) -> Manifest:
    """Deterministic corpus: same seed -> byte-identical WAVs, so re-runs (including the
    owner's own re-run with real recordings substituted) are directly comparable."""
    rng = np.random.default_rng(seed)
    manifest = Manifest()
    for chapter in range(1, n_chapters + 1):
        # Each chapter: narration lines interleaved with 2-4 of the characters speaking,
        # mirroring a solo dramatic reading's "he said" / dialogue structure.
        speakers_this_chapter = ["narration"] + list(rng.choice(CHARACTER_NAMES, size=min(4, len(CHARACTER_NAMES)), replace=False))
        for character in speakers_this_chapter:
            voice = VOICES[character]
            n_lines = int(rng.integers(4, 7))
            for line_index in range(n_lines):
                n_syllables = int(rng.integers(5, 14))
                samples = synthesize_line(voice, n_syllables, rng)
                rel = Path(f"chapter{chapter:02d}") / character / f"line{line_index:02d}.wav"
                write_wav(out_dir / rel, samples)
                manifest.lines.append(
                    ManifestLine(
                        chapter=chapter,
                        character=character,
                        line_index=line_index,
                        path=str(rel),
                        duration_s=samples.shape[0] / SAMPLE_RATE,
                        is_reference_eligible=True,
                    )
                )
    return manifest


def write_manifest(out_dir: Path, manifest: Manifest) -> Path:
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "sample_rate": manifest.sample_rate,
                "route": "synthetic-fallback",
                "voices": {name: vars(v) for name, v in VOICES.items()},
                "lines": [vars(line) for line in manifest.lines],
            },
            indent=2,
        )
    )
    return manifest_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out_dir", type=Path, help="Output directory OUTSIDE the repository")
    parser.add_argument("--chapters", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260927)
    args = parser.parse_args()

    manifest = generate_corpus(args.out_dir, n_chapters=args.chapters, seed=args.seed)
    write_manifest(args.out_dir, manifest)
    print(f"Wrote {len(manifest.lines)} lines across {args.chapters} chapters to {args.out_dir}")


if __name__ == "__main__":
    main()
