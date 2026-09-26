# 0252. Level normalize ships without clause split, because word timing is not persisted anywhere

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Diagnostics, Delivery Reports and Cleanup Tools](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) Phase 11
bundles two capabilities under one goal, "split on transcript boundaries and match loudness, reversibly": clause
split (propose boundaries from transcript word timing, let the narrator adjust them, then split) and level normalize
(measure each resulting item's LUFS or RMS, propose a gain to match the narrator's target, apply it via item volume).
Its own Scope line already flags the split half as depending on "persisted word timing (TBD)", and its Technical
Approach repeats it: "Source-time to project-time mapping ... breaks with stretch markers, sections and reversed
sources (research doc section 6, inference)" and clause boundaries come "from transcript word timestamps" whose
persistence is unresolved.

Checking that gap turned up a firm answer, not just an open question: **no code anywhere persists word-level
timestamps**. `sidecars/transcript-compare/core/compare.py`'s `transcribe_chunked` writes each chunk's per-word
`(word, start, end)` list to a *temporary* `chunk_XXXX.json` under a working directory it deletes once the chunks are
merged into `all_words` in memory (`compare.py`, chunk write and later `os.remove`/`os.rmdir`). The only artifact that
survives a run, `results_<run>.txt`, holds `SUMMARY`, a `DIFF` path and one `MARKER|...|srcpos|...` row **per
discrepancy only** - a single point in time per marker, not a timeline, and nothing for text that matched cleanly.
Nothing in `libs/python/**` or the Go host writes or reads a word-level timeline either.

Deciding to persist it is not a small addition: it is a new artifact in a sidecar contract other work already
depends on (`internal/transcript`, `docs/architecture/manuscript-line-identity.md`'s own reading of `results_<run>.txt`),
it needs its own shape, storage location and lifecycle decision (per run? per chapter? kept until the next run
overwrites it, like `results_<run>.txt`, or something else?), and turning a timeline into clause boundaries is a
heuristic (sentence-ending punctuation, a minimum split length, what to do with "clauses with no clear transcript
timing" - the PRD's own Phase 11 success signal names this as something tests must cover) that drives a REAPER
`SplitMediaItem` call. A wrong boundary is not merely a wrong finding on a page; committed, it changes a narrator's
project. The PRD's own Technical Risks table rates "item-to-source mapping wrong for trimmed, stretched or reversed
items" High for Phases 10-11 for the same reason, and the mitigation it names, "manual REAPER checklist", is the
owner's to run - not something a single unsupervised change should assume passes.

## Decision

Phase 11 ships only its **level-normalize** half in this change:

1. `apps/desktop/internal/levelnormalize.GainDeltaDB(measured *float64, target Target)` decides whether an item's
   measured level (from `internal/measure.AnalyzeRange`, already used the same way by
   `internal/measure/takemetrics.go`) needs a gain change to reach the narrator's target (`Target{Metric,
   ValueDB, ToleranceDB}`, integrated LUFS or RMS) - no change when already within tolerance, no fabricated value
   when the measurement itself is unavailable (nil).
2. A new command, **`apply_item_gain`** (`integrations/reaper/narration_level_normalize.lua`), resolves each
   candidate item by GUID (never a neighbour) and multiplies its current `D_VOL` by `10^(deltaDB/20)` - on top of
   whatever volume the item already has, so a narrator's own manual trim is compounded onto, not overwritten - in one
   undo block per call, reporting each item's volume before and after (so a before/after report needs no second
   measurement) and `GAIN_STALE` for an item that no longer resolves. This is the shape ADR 0251 already established
   for Phase 10's `preview_cleanup_markers`/`apply_cleanup_trims`: a payload-file batch, GUID resolution with no
   fallback, one undo block, a Go client (`bridge.LevelMatchClient`) that accumulates every event for a run before
   its terminal answer.
3. **Clause split is deliberately not built in this change.** Proposing a boundary needs word timing that nothing
   persists yet; inventing a persistence format for it is a sidecar-contract decision with its own lifecycle and
   consumer questions, and the boundary heuristic itself needs fixtures ("no clear transcript timing", "short
   interjections near the minimum split length" - the PRD's own success signal) this change has no access to
   validate against real recordings. Building it now would mean guessing at a product decision the PRD itself marks
   unresolved, behind an operation (`SplitMediaItem` on a narrator's project) where a wrong guess is expensive to
   discover only from the harness fake.
4. No host binding is added, matching ADR 0251's Phase 10 precedent: this is the Lua command, the Go client and their
   own tests. A narrator-facing trigger, and clause split once word timing is persisted, are later work.

## Consequences

- A narrator can level-match items today (any item, not only ones a future clause split would produce), reversibly,
  the moment something calls `GainDeltaDB` and `LevelMatchClient.Apply` - no host binding yet, so that caller does
  not exist in this app release, but the mechanism is proven by its own tests.
- Phase 11's "clause split" half stays open. Building it needs, in order: a decision on what to persist from
  `transcribe_chunked`'s `all_words` and where (a new ADR, since it changes a sidecar contract other code reads), a
  Go reader for that artifact, a boundary-proposal algorithm with fixtures for the PRD's own edge cases, and the
  preview/apply wiring this change's `apply_item_gain` already demonstrates the shape of. None of that is invented
  here.
- Superseding point 3 (building clause split) needs a new ADR that names the persisted format and its owner, not an
  edit to this one: this ADR's Decision recorded what shipped, not a plan for what comes next.
