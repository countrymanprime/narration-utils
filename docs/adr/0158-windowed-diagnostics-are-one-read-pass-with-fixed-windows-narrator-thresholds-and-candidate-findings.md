# 0158. Windowed diagnostics are one read pass with fixed windows, narrator thresholds and candidate findings

**Status:** Proposed
**Date:** 2026-09-23

## Context

Phase 4 of [the diagnostics PRD](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) asks for shared, tested
detectors for clipping, level shifts, silence and room tone, in Go beside `measure`, that emit findings. The PRD says
what they detect and that every threshold is the narrator's. It does not say how each is measured, what a threshold
means before the narrator sets one, or how severe each finding is. Those choices decide what Phases 6 (the Diagnostics
view), 7 (the report) and 9 (silence cleanup, which reuses the silence map) build on. Other choices constrained this one:
Phase 1 is changing `measure.Analyze` and its `Report` at the same time, [ADR 0025](0025-delivery-measurements-in-go-profiles-deferred.md)
rules out any delivery specification's numbers, and a long pause must never be called a defect by default.

## Decision

1. **A separate entry point.** `measure.Diagnose` / `DiagnoseFile` (`apps/desktop/internal/measure/diagnostics.go`)
   read the WAV once, optionally a `Range`, check a `context` between blocks, and return a `Diagnostics` value. They do
   not add to `Report` and do not change `Analyze`. The caller must say whether the audio is a `raw_recording` or a
   `processed_render`. Nothing is inferred.
2. **Fixed windows.**
   - **Clipping:** runs of 3 or more samples at or above the ceiling in one channel, the same run rule as `Report`. Runs
     in any channel less than 50 ms apart merge into one region (`clipregions.go`). The first 200 regions are listed and
     every one is counted.
   - **Loudness:** EBU R128 short-term loudness (ungated, K-weighted, 3 s) every 1 s (`shortterm.go`).
   - **Level shift:** the mean short-term loudness of the read in the 10 windows before a point, compared with the 10
     after it. Pause windows are left out by BS.1770's gates applied to the series, and each side needs at least 5 read
     windows. Only the largest step in a run of neighbouring candidates is kept.
   - **Silence map:** 50 ms windows of unweighted RMS below the silence floor, kept when they last at least the minimum
     silence (`silencemap.go`). A region of exact zeros is digital silence and has no level.
   - **Room tone:** the RMS of the silence regions that hold signal. A region at least the room-tone step away from the
     running segment's level starts a new segment.
3. **Thresholds are the narrator's, with starting values.** `DiagnosticOptions` holds the clip ceiling (0 dBFS, meaning
   the format's full scale), the silence floor (-50 dBFS), the minimum silence (0.3 s), the level-shift step (4 LU),
   the room-tone step (6 dB) and the pause thresholds (`DefaultPauseOptions`: 0.3 s and 2 s). The defaults exist so the
   analyzers can run before anything is configured. They are not a delivery specification. Each finding records the
   thresholds that raised it, and an invalid threshold is an error, never silently replaced.
4. **Findings are candidates.** The analyzer is `diagnostics`, and every finding starts unreviewed:
   - Clipping is `audio_quality` / `warning` with confidence 1, because it is deterministic.
   - A level shift is `audio_quality` / `warning` with a null confidence.
   - A room-tone change is `audio_quality` with a null confidence: `warning` for a raw recording, and `info` for a render,
     whose room tone may have been changed on purpose.
   - A long pause is `pacing` / `info` with a null confidence, and only when valid transcript timing exists. The silence
     map alone raises no finding. Transcript timing that is missing, malformed or longer than the audio makes pacing
     unavailable with a reason; it is not an error and is never guessed.
   - Every finding's evidence names its `kind` and `source_kind`.
5. **Identity and time.** A finding's id is the file, the kind and its source start to the millisecond. The thresholds
   are not part of the id, so the same event keeps its id between whole-file and range runs and after a threshold
   change. A file measured on its own has no project, so `time_range` holds source seconds in both its project and
   source fields. A caller that knows where the audio sits in a project re-bases the project fields.

## Consequences

- Phases 6, 7 and 9 have one detector set to bind, report and reuse, and it is tested on generated fixtures: a clean
  read, an intentional silence, clipping, a room-tone change, a level shift and unresolved transcript timing. Each
  reported range reproduces its condition when `AnalyzeRange` measures that range again.
- Phase 1's job and `Report` are untouched, so the two phases merge independently. Running diagnostics as a job with
  progress is left to the phase that binds it (Phase 6, which added `DiagnosticInput.Progress` beside the ctx hook).
- The starting thresholds are judgement calls and have not been checked against real chapters. A narrator who finds
  them wrong will change them once settings keys carry them, using
  [ADR 0155](0155-settings-gain-a-number-kind-with-a-declared-range-and-delivery-limits-are-the-narrators-own.md)'s
  number kind. Phase 6 (the Diagnostics view, read-only) shows them with every check and on every finding; the keys
  arrive with Phase 9, which brings the analyzer thresholds into the layered settings.
- The id ignores the audio's content (like `measure.Evaluate`'s). A re-render that moves an event keeps or changes its
  id with its start time, and stale-dismissal handling stays with the fingerprint evidence of Open Question 5.
- Changing a window, the id or the severity policy needs a new ADR that supersedes this one.
