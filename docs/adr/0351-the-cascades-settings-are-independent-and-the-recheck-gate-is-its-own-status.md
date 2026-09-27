# 0351. The cascade's settings are independent, and the re-check gate is its own status

**Status:** Proposed
**Date:** 2026-09-27
**Amends:** none

## Context

The model cascade (recording-check-model-cascade PRD, deleted, delivered) reaches the narrator in
Phase 5: settings to turn it on, the missing-model choice (MC4), and the dialog's and result's
labels (MC5). Three things needed a real answer that Phase 4 deliberately left open (it changed
neither `coverage:state` nor `CoverageStartResult`):

- **Where the cascade's two models live.** `CoverageStart` already resolves a model from
  `TranscriptCompare.model_size` (`resolveWhisperModelID`, Q7 A) for every check, cascade or not.
  MC2 asks for two settings, "from the approved list"; whether those reuse `model_size` for the
  first pass or stand apart from it changes what turning the cascade on does to a narrator's
  existing Transcript Compare default.
- **What a missing re-check model answers.** The first-pass model already has a first-use gate
  (`asset_required`, shared with `TranscriptStart`): not installed, the check cannot run at all.
  MC4's recommendation is different - offer the download *or* "Check with tiny only" - so reusing
  the same answer shape would need the UI to guess, from context alone, which of two installs a
  generic `asset_required` was for.
- **How the dialog names a running pass without waiting for the result.** The PRD's user flow
  describes "First pass (tiny)", then "Re-checking 3 passages (large-v3-turbo)" while the check is
  still running. `coverage:state` (`State`, `service.go`) carries only `Stage`/`Message`, the
  sidecar's own raw progress text (ADR 0015): it says nothing about which of the job's own stages
  (`stageFirstPass`, `stageRecheckWindows`, `stageRecheckWhole`, `stageRealign`, ADR 0344) is
  running, or which model each one uses.

## Decision

- **`RecordingCoverage` gains its own three settings** (`cascade_enabled`, `cascade_first_pass_model`,
  `cascade_recheck_model`; `coverage.CascadeSettings`), read the same layered way as the tool's four
  existing ones. `cascade_first_pass_model` is independent of `TranscriptCompare.model_size`: while
  the cascade is off, `CoverageStart` keeps resolving `model_size` exactly as before this phase (no
  narrator sees any change from turning Transcript Compare's own model around); once it is on, both
  cascade models come from these new settings and `model_size` plays no further part in a check.
- **A missing re-check model answers `recheck_asset_required`**, not `asset_required`: the same
  shape (`model`, `installState`, `downloadSize`, `diskSize`, `installPath`) under its own status
  literal. `RecordingCheck.tsx` renders it with `AssetInstallPrompt`'s existing `ask.alternative`
  slot (already used for the Story Bible's language-model gate) as "Check with tiny only", which
  calls `CoverageStart` again with `options["skipRecheck"] = "true"` - a narrator's per-run choice,
  never a settings change, so it needs no new persisted state and the very next plain "Check
  recording" still tries the cascade again.
- **`State` gains `Pass`, `FirstPassModel`, `RecheckModel` and `RecheckWindows`**, set only for a
  run that asked for a re-check (`Request.Recheck.Model` non-empty) and derived from `job.stage`
  (`stage.label()`) at each relaunch, not parsed from the sidecar's own progress text. The UI
  layers a friendly pass label ahead of the sidecar's own message (`passLabel`,
  `recordingCheckText.ts`) rather than replacing it, so a stalled or slow pass still shows the
  sidecar's own detail underneath.
- **`StoredResult`/`ReportView` gain `Recheck` (`{model, wholeChapter, windows, seconds}`)**,
  set once, at `finish`, from the job's own resolved plan (`recheckSummary`, `run.go`): nil when
  nothing was re-checked. `Model` keeps naming the first pass only (ADR 0344's "stays the
  first-pass model for compatibility"); `Recheck` is the other one. Every region left in a report
  that carries a `Recheck` was seen by both models - the planner windows every region the first
  pass reports (or, `wholeChapter`, re-transcribes the whole chapter) - so the UI marks a pickup
  "Confirmed missing by ..." from the report-level field alone, with no separate per-region flag.

## Consequences

- Turning the cascade on is a Settings-page decision with an immediate effect on every following
  check; the narrator sees no gate for the first-pass model beyond the one they already know
  (`asset_required`), and a new, distinct gate only for the re-check model, with its own escape
  hatch.
- `hostAPIVersion` moves to 68: `CoverageStart` gained a second parameter (`options`), the same
  shape `TranscriptStart` already takes.
- A stored result from before this phase reads with no `recheck` field (`omitempty`), the same
  compatibility `before`/`after` (ADR 0168) established for additive report fields.

## Alternatives considered

- **Reusing `TranscriptCompare.model_size` as the cascade's first-pass model**, rather than a
  dedicated setting. Rejected: MC2 asks for two settings "from the approved list", and coupling the
  cascade to a proofing setting would silently change Transcript Compare's own default the moment a
  narrator repurposed it for the cascade, or vice versa.
- **A `tinyOnly: true` field alongside `asset_required`**, instead of a distinct
  `recheck_asset_required` status. Rejected: a discriminated union keeps the UI's branch explicit
  (no reading a second field to know which prompt to show), and the wire schema documents the two
  gates as the genuinely different things they are - one blocks the check outright, the other has a
  safe way past it.
