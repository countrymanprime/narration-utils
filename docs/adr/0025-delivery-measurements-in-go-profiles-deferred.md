# 0025. Delivery measurements are computed in Go, and no distributor profile ships yet

- **Status:** Superseded by [ADR-0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)
- **Date:** 2026-09-19
- **Related:** Superseded by [ADR-0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md) in the "no distributor profile ships" decision; the measurement in Go stands.

## Context and problem

The REAPER automation research ranked an ACX-style check per chapter as a high-value item that needs no running REAPER. REAPER itself can supply integrated loudness (`CalculateNormalization`, dry-run `RENDER_STATS`), but it has no noise-floor API, its dry-run stat keys are undocumented, and calling it requires the Lua bridge, so it would not work in a standalone launch ([standalone-launch.md](../architecture/standalone-launch.md)). No maintained Go library for BS.1770 loudness or true peak exists, and a third packaged Python sidecar would add a runtime for a few hundred lines of DSP.

The roadmap (milestone 4) says delivery reports start generic and that distributor profiles are added only after their rules are independently specified and validated. The research itself found that published guidance disagrees on ACX room-tone lengths.

## Decision drivers

- An ACX-style check per chapter should need no running REAPER and work in a standalone launch.
- No maintained Go library for BS.1770 loudness or true peak exists.
- A third packaged Python sidecar would add a runtime for a few hundred lines of DSP.
- The roadmap says distributor profiles are added only after their rules are independently specified and validated, and published guidance disagrees on ACX room-tone lengths.

## Considered options

1. Compute measurements in Go from the WAV files, and ship no distributor profile yet
2. Measure through REAPER (`CalculateNormalization`, dry-run `RENDER_STATS`)
3. A third packaged Python sidecar
4. Ship a distributor profile (ACX) now

## Decision outcome

**Chosen option: compute measurements in Go from the WAV files, and ship no distributor profile yet**, because REAPER would require the Lua bridge and fail in a standalone launch, a Python sidecar would add a runtime for a few hundred lines of DSP, and distributor rules are not yet independently specified and validated.

`shell/internal/measure` reads WAV files directly and computes integrated loudness (BS.1770-4 K-weighting with absolute and relative gating), RMS, sample peak, true peak (polyphase windowed-sinc oversampling) and the noise floor of the quietest non-silent 500 ms window. Measurements that cannot be made (silence, audio shorter than the measurement window) are reported as unavailable, serialised as JSON `null`, and never as a fabricated number.

Compliance is expressed only through a caller-supplied `measure.Profile`; `measure.Evaluate` turns a report into `delivery_qc` findings via `shell/internal/findings`. The package ships no distributor profile. A profile (ACX or any other) is added only in a change that cites the distributor's own published specification and validates the thresholds against it.

`shell/internal/findings` implements the record shape from [findings-contract.md](../architecture/findings-contract.md) and is the required output format for this analyzer.

### Consequences

- **Good:** Delivery measurement works with no REAPER and no extra runtime, and is fully covered by automated tests using analytically known signals (a stereo 997 Hz sine at -23 dBFS peak reads -23.0 LUFS; a 45-degree fs/4 sine reads about 0 dBTP).
- **Neutral:** Only mono and stereo PCM/float WAV is supported. Surround channel weights and compressed formats are refused with a clear error rather than guessed.
- **Bad:** The DSP is ours to maintain and has been checked against BS.1770's published 48 kHz coefficients and analytic signals, not against the EBU's official test files, which were not available offline. Adding those files as fixtures would strengthen validation.
- **Neutral:** Nothing in the app calls this package yet; exposing it through the Wails host and a UI is separate work.
- **Neutral:** Adding a distributor profile, or moving measurement into REAPER or a sidecar, needs a new ADR that supersedes this one.

### Confirmation

Automated tests using analytically known signals (a stereo 997 Hz sine at -23 dBFS peak reads -23.0 LUFS; a 45-degree fs/4 sine reads about 0 dBTP), and a check against BS.1770's published 48 kHz coefficients. A distributor profile is added only in a change that cites the distributor's own published specification and validates the thresholds against it.

## Pros and cons of the options

### Measure through REAPER

- Good, because REAPER can supply integrated loudness.
- Bad, because it has no noise-floor API and its dry-run stat keys are undocumented.
- Bad, because calling it requires the Lua bridge, so it would not work in a standalone launch.

### A third packaged Python sidecar

- Bad, because it would add a runtime for a few hundred lines of DSP.

### Ship a distributor profile (ACX) now

- Bad, because the roadmap adds distributor profiles only after their rules are independently specified and validated, and published guidance disagrees on ACX room-tone lengths.
