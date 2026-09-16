# Narration Diagnostics

**Status: Planned.**

## User problem

Narrators need a prioritized way to find measurable audio defects and pacing anomalies while keeping subjective performance assessment separate.

## Target workflow

Run diagnostics over selected items, a chapter, or render-ready output; inspect findings in the dashboard; listen in context; resolve or document each result before handoff.

## Inputs and outputs

- Inputs: local source/render audio, project/track timing, optional transcript timing, and a named generic measurement profile.
- Outputs: `audio_quality` and `pacing` findings plus chapter-level summary measurements.
- Narrator actions: choose scope/profile, configure thresholds, audition, and review or dismiss results.

## Planned features

### MVP

- Measure clipping, peak/level shifts, silence, room-tone changes, duration, and words-per-minute where aligned transcript data exists.
- Flag unusually long pauses and abrupt pickup joins with playback context.
- Report measurement values, thresholds, and source scope instead of a black-box quality grade.

### Later work

- Conservative mouth-noise/breath candidates, session-to-session environment comparison, and custom narrator baselines.
- Chapter pacing heatmaps and trends across a book.

## Non-goals and review boundary

The utility does not remove noise, master audio, diagnose voice health, or label normal artistic pauses as defects without a configurable and reviewable threshold.

## Acceptance and risks

- Reported timestamps reproduce the measured condition from the same source audio.
- Measurements distinguish raw source and processed render paths.
- Tests cover clean reads, intentional silence, clipped audio, room-tone changes, and unresolved transcript timing.
- Main risks: false positives from dramatic pacing and recordings with deliberate processing changes.
