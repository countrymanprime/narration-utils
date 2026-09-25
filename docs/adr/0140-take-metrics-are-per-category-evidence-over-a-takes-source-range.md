# 0140. Take metrics are per-category evidence measured over a take's source range

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

Take Intelligence (`docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md`, phase 8) compares the takes of one span with separate text, timing and technical evidence per take. The owner settled three things in advance: measurement stays in Go and reads WAV only, and a measurement that cannot be made is reported as unavailable, never guessed ([ADR 0025](0025-delivery-measurements-in-go-profiles-deferred.md)); there is no composite "best take" score (PRD Q9); and a take's audio is the part of its source file the take-aware item model says it plays (`apps/desktop/internal/tracks`, phase 2). Before this change `measure.Analyze` read a whole file only and reported no clipping. `diagnostics-delivery-and-cleanup-tools.prd.md` also needs a range entry point in the same package, so its shape had to be settled once.

## Decision drivers

- Measurement stays in Go and reads WAV only, and a measurement that cannot be made is reported as unavailable, never guessed (ADR 0025).
- No composite "best take" score (PRD Q9).
- A take's audio is the part of its source file the take-aware item model says it plays.
- The diagnostics PRD needs a range entry point in the same package, so its shape had to be settled once.

## Considered options

1. Per-category take metrics measured over a take's source range

No alternatives were recorded when this decision was made.

## Decision outcome

**Chosen option: per-category take metrics measured over a take's source range**, because the owner settled that measurement stays in Go, that what cannot be measured is reported as unavailable rather than guessed, and that there is no composite score.

- **Range API.** `measure.Range` is `{start_seconds, length_seconds}` in source time. `AnalyzeRange(io.Reader, Range)` and `AnalyzeFileRange(path, Range)` convert it to whole frames at the file's own rate (nearest frame), skip the audio before it without decoding (`WAVReader.Skip`), and measure exactly those frames. Measuring a range gives the same `Report` as a file holding only those frames, and a fuzz test checks that. A range that runs past the end measures what exists (`duration_seconds` says how much). A range entirely after the end measures nothing. The report records the requested range.
- **Clipping** is measured in every report: `full_scale_samples` counts samples at the format's limit (the largest positive PCM code, or 1.0 for float). A clip run is 3 or more consecutive full-scale samples in one channel. `clip_run_count` counts every run and `clip_runs` lists the first 200, timed from the start of the measured audio.
- **A take's source range** (`measure.TakeSourceRange`) starts at `SOFFS` (plus a `SECTION` wrapper's `STARTPOS`) and lasts the item length times `PLAYRATE` (1 when no rate is recorded). The function refuses to approximate what it cannot derive exactly: stretch markers, a negative offset, a range that runs past its section (REAPER loops the section there), or an unusable length or rate.
- **Take metrics** (`measure.MeasureTake`) are five categories, each `measured` or `unavailable` with a reason: `clipping`, `noise` (floor of the quietest 500 ms window), `level_consistency` (integrated loudness against the median of the caller's measurable neighbouring items), `duration` (item, source range, audio that exists, speech span and words per minute) and `pause_profile` (silences between transcript words, with the thresholds that defined a pause and a long pause shown alongside). An unavailable category carries no figures. `coverage` counts the measured categories and names the rest. Nothing combines categories into one number. Only caller mistakes (no such take, malformed word timings or thresholds) are errors. A missing, unsupported (non-`WAVE`), unreadable or out-of-range source is reported as unavailable. So is a missing transcript. The full range `Report` is kept with the metrics so every figure can be reproduced from it.

### Consequences

- **Good:** An MP3 or FLAC take, a stretched take, or a take without a transcript still gets every figure that can honestly be given: the project duration always, and the pause profile whenever there are words. Coverage shows what is missing, and nothing about a missing category counts against the take.
- **Good:** The diagnostics PRD reuses `AnalyzeRange` for per-item analysis instead of adding a second entry point. Its frame-accurate `[start, end)` wish is met at frame granularity through seconds.
- **Neutral:** `measure` now imports `internal/tracks` (allowed by ADR 0046's depguard rule). A take whose timing is non-linear (stretch markers) gets no audio metrics until a later change maps stretch markers.
- **Bad:** Clipping by the full-scale rule cannot see clipping that happened before a gain change (a clipped recording normalised down). Detecting that needs a flat-top heuristic and a new decision.
- **Neutral:** Changing the categories, adding a combined score, or measuring non-WAV sources needs a new ADR that supersedes this one (and ADR 0025 for formats).

### Confirmation

A fuzz test checks that measuring a range gives the same `Report` as a file holding only those frames.
