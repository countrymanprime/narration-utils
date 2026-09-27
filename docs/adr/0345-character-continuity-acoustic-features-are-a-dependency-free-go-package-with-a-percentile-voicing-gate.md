# 0345. Character-continuity acoustic features are a dependency-free Go package with a percentile voicing gate

**Status:** Accepted
**Date:** 2026-09-27

## Context

`docs/prds/character-continuity-review.prd.md` Phase 4 ("Feature extraction engine") needs range-limited pitch, speaking-rate, energy and spectral features for later phases (baselines and findings, Phase 5) to compare candidate dialogue lines against narrator-approved references. Open Question Q1 was already decided, provisionally, by the Phase 1 trial (`docs/research/character-continuity-acoustic-trial.md`): adopt a dependency-free feature design (option A) over Praat (deferred) and Resemblyzer (rejected, and this repository's first PyTorch dependency). The trial's own Python (`features_baseline.py`) exists only to validate that design, not to ship - "the Go MVP implementation (Phase 4) still needs its own analytic-signal validation, this trial only validates the feature *design*, not the Go port."

The repository has no DSP or numerics dependency (ADR 0008 keeps it that way), and `shell/internal/measure` (ADR 0025) already establishes the precedent of hand-written, analytically-tested Go DSP with no third runtime.

## Decision

A new package, `apps/desktop/internal/acoustic`, ports the trial's feature design to Go:

- 40 ms analysis frames every 10 ms (matching the trial), read from a WAV file via `measure.WAVReader`, optionally limited to a `measure.Range`. Stereo is downmixed to mono (per-frame channel average) before analysis, since pitch, rate and spectral shape describe one voice, not a channel.
- A relative voicing gate: a frame counts as voiced when its RMS is at or above the 40th percentile of the clip's own frame RMS distribution (floored at a small absolute minimum so digital silence is never "voiced"). This is a percentile-relative threshold, not an absolute loudness check, so even a sustained, constant-amplitude tone leaves its own quietest frames - the natural RMS variance from partial periods at frame boundaries - below the cut. That is by design, matching the trial.
- A minimal autocorrelation pitch tracker searching lags for 60-400 Hz, accepting a peak only above a normalized-correlation confidence floor (0.3, matching the trial) - otherwise a frame contributes no F0 reading rather than a fabricated one.
- A coarse spectral summary (centroid, and power fraction in <1 kHz / 1-3 kHz / >=3 kHz bands) from a hand-rolled radix-2 FFT (`fft.go`), zero-padding each Hann-windowed frame to the next power of two. This gives a coarser frequency-bin spacing than the trial's exact-length `numpy.fft.rfft`, which the trial's own record anticipates ("a shipped Go build would hand-roll the FFT itself... the trial only needs the same *shape* of feature, not the same code").
- `Features.OctaveAmbiguousFraction`: the fraction of accepted F0 readings within 3% of exactly double or half the clip's own F0 median - a confidence signal quantifying the tracker's documented octave-error failure mode (Technical Risks in the PRD), for Phase 5 to weigh, not a correction applied here.
- `FeatureVersion`, an exported constant Phase 5's derived-features cache can key alongside source identity and range, so a later change to this package's algorithm or output shape invalidates old cache entries instead of silently mixing with them.

Range conversion (seconds to whole frames at the file's sample rate) is duplicated from `measure.Range`'s own unexported logic rather than exported from `measure`, keeping this package's only shared surface with a future TR-8 range API the already-public `measure.Range` type itself, with no new touch to `measure`'s own files.

Validated with analytic-signal tests only (synthetic tones, a linear sweep, and a Parseval's-theorem check on the FFT): known-frequency tones recover their frequency within the tracker's own lag-quantization resolution, a frequency sweep is tracked per-range near its instantaneous value, spectral bands separate a low tone from a high one, digital silence yields no pitch and zero voiced activity, and a range past the end of the audio or shorter than one frame yields the package's explicit "nothing measured" zero value. Per the owner's standing rules (D70/D71), no LibriVox or other recorded speech was used: validating this engine's arithmetic against known frequencies and rates needs no real speech, and the Phase 1 trial's own required real-corpus re-run is the place calibration against real narration happens.

## Consequences

- Phase 5 can call `acoustic.Extract`/`ExtractFile` directly against an approved reference's or a candidate's audio range with no new runtime dependency.
- The percentile voicing gate's relative nature means "voiced fraction" is not directly a loudness measure and should not be read as one outside this package; Phase 5's baseline and confidence design should treat it as the trial does (a coarse activity/reliability signal, not an absolute level).
- The hand-rolled FFT's zero-padding means `SpectralCentroidHz` and the band fractions are not numerically identical to the trial's Python outputs for the same audio, only comparable in shape - expected and already anticipated by the trial's own record.
- All Q1/Q6 calibration numbers this package's output will eventually feed into baselines remain provisional (D70/D71) until the Phase 1 trial's required real-corpus re-run.
