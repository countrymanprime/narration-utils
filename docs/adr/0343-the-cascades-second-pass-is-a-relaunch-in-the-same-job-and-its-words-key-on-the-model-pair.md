# 0343. The cascade's second pass is a relaunch in the same job, and its words key on the model pair

**Status:** Proposed
**Date:** 2026-09-27
**Amends:** ADR-0128 (the words cache key)

## Context

The model cascade ([PRD](../prds/recording-check-model-cascade.prd.md), Phase 4) adds the Go
planner and the host orchestration that turns a first pass's missing regions into a second,
stronger-model pass: a window planner (`plan.go`), and `internal/coverage/service.go`/`run.go`
running both passes as the PRD's "one check (one job, one cancel, one `job:ended`)". Three
questions came with wiring that into the existing single-sidecar-launch `job`/`watch`/`finish` (ADR
0127) without changing the wire (Phase 5 owns the settings, dialog and result label; Phase 4 must
not touch `coverage:state`'s shape):

- **How one job runs more than one sidecar process.** `job.child` was always the run's one
  process; the cascade needs up to three in sequence (a first pass, then either a windows-only
  `--recheck` and an `--align-only` realign, or one whole-chapter fallback pass), sharing one run
  id, one results file and one cancel.
- **What the words cache key does with a re-check model.** The PRD's Architecture notes say a
  cascade's spliced words must "never seed a single-model check" (a plain check of the first pass's
  own model reusing words a stronger model has already touched, unlabelled as such).
- **How a region's bounds become a window when they cross an item.** ADR 0168's `before`/`after`
  are each an item and a source time; a region can span two items, or a whole muted-free item can
  sit wholly between them with no matched word of its own.

## Decision

- **The job gains a `stage` and relaunches in place.** `job.child` is replaced, not the job: a new
  `stage` (`stageFirstPass`, `stageRecheckWindows`, `stageRecheckWhole`, `stageRealign`) picks the
  next sidecar's arguments (`Service.stageArgs`), and `watch`'s loop calls `Service.advance` on
  every clean exit to decide whether to launch it. Every stage after the first reuses the same
  `progressPath` (so a `.cancel` written between two stages is seen by the next one immediately,
  with no extra plumbing) and the same `--out`/`--words-dir`, so `finish` still reads
  `resultsPath()` exactly once, from whichever stage's process wrote it last. The reported `State`
  resets its `Stage` and `Percent` at each relaunch: a new process's own progress is a new phase of
  the job, not a continuation of the percentage the one before it reached.
- **A Go-side failure between stages (currently: writing the windows file) is `job.stageErr`,**
  read by `finish` before the child's exit code, since such a failure has nothing to do with the
  process that just exited cleanly.
- **`wordsParamHash` takes the cascade's re-check model** (empty for a run that never re-checks) as
  one more part of its hash. A cascade's words - spliced or not, since the key is set once for the
  whole run - are cached apart from a plain check of the same first-pass model, and apart from a
  cascade that pairs that model with a different second one. The coarser-than-per-file granularity
  (every item's cache entry moves, not only the ones a splice actually touched) was chosen over
  tracking which items were actually spliced: the PRD's own wording ("the model pair") reads as
  run-level, and per-item tracking would need the cache to understand `spans` (ADR 0341), which
  Phase 4 does not touch.
- **The planner windows a region per item it spans** (`regionWindows`, `plan.go`): one window when
  `before` and `after` sit in the same item, one per item between them otherwise (each edge item
  clipped to its own bound, any item wholly between windowed in full), and a nil bound (a chapter
  edge, or nothing said on that side, ADR 0168) runs to that item's own played edge instead of a
  bound. Padding (`padWindow`) never reads outside the item it is windowing: a shortfall on one
  side shifts onto the other before the window is clamped, so a window away from both edges still
  reaches the minimum size and one that cannot (a short item) is the whole item instead.

## Consequences

- A narrator who turns the cascade off after using it re-transcribes with the first-pass model
  once, rather than silently inheriting a stronger model's words under a plain check's own label.
  The reverse also holds: turning the cascade on for the first time re-transcribes rather than
  reusing a plain check's cache entry.
- `coverage:state`'s shape is unchanged; a cascade run's stages are visible only as the existing
  `Stage`/`Message` fields restarting partway through, not as a new field naming which pass is
  running. Phase 5's dialog and result labelling need their own wire change to say which models ran.
- Nothing yet reads a spliced file's `spans` on the host side: the realign stage's `--align-only`
  pass reads the words a splice already merged, and the result's `Model` field still names the
  first pass's own model (the PRD's "stays the first-pass model for compatibility"), unchanged by
  this phase.

## Alternatives considered

- **A second `job` chained after the first**, rather than one job relaunching in place. Rejected:
  the PRD asks for one job, one cancel and one `job:ended`; a second job would need its own
  cancel-forwarding and either a second `job:ended` (against the PRD) or bespoke suppression of it.
- **Keying the words cache per span** rather than per run. Rejected for Phase 4 as more machinery
  than the phase needs; left as a possible refinement once the host reads `spans` at all.
