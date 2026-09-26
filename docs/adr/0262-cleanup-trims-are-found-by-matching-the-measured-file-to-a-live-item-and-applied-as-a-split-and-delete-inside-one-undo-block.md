# 0262. Cleanup trims are found by matching the measured file to a live item and applied as a split-and-delete inside one undo block

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Diagnostics, Delivery Reports and Cleanup Tools](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) Phase 10 asks
for preview markers and approve-to-apply trims in REAPER over the `silence_cleanup` findings ADR 0238 already raises,
plus a Go client and the manual REAPER checklist. Three things the PRD's own Architecture Notes leave open turned out
to need a decision before any of it could be built:

- A `silence_cleanup` finding's `Source` carries only the measured file (`measure.Diagnostics.newFinding` sets
  `Source: findings.Source{File: d.File}` and nothing else), never a REAPER item, track or take GUID. Every other
  bridge command that touches an item (`narration_navigation.lua`, `narration_line_identity.lua`) resolves by GUID
  and refuses to guess from a position or a neighbour; cleanup has no GUID to resolve by at all, so something has to
  say which live item plays the measured file before a candidate can become a marker or a trim.
- The PRD calls for "new Lua commands ... keyed by item GUID with stale handling like `stamp_item_lines`", but
  `stamp_item_lines` (`narration_line_identity.lua`) and `navigate_item` (`narration_navigation.lua`) are two
  different shapes: one is a batch over a payload file with per-row stale events plus one summary, the other is a
  single command with one answer. Cleanup's own candidates arrive in batches (a chapter has hundreds of pauses, ADR
  0238), so which shape it follows changes both the Lua command and the Go client behind it.
- "Every trim only moves item or take edges: source media is never rendered or deleted" (the PRD's Architecture
  Notes) does not by itself say what happens to the *timeline* around a cut: closing the gap (moving every later item
  earlier, a ripple edit) is a materially different, harder-to-verify operation than leaving one, and nothing here can
  be checked against a real REAPER (the harness fakes `reaper`; ADR 0066 point 3's own limits still apply) - the
  owner's manual checklist is what actually proves an edit correct.

## Decision

1. **A new package, `apps/desktop/internal/cleanupmap`, maps a cleanup candidate's file and cut range onto live
   items**, reading only the parsed `.rpp` (`internal/tracks`), never REAPER. `ForFile(project, sourceFile,
   cutStartSeconds, cutEndSeconds)` matches `sourceFile` against each item's active take's resolved `SourceFile`
   (case-insensitive, after `filepath.Clean`, the same identity check `internal/takecompare` already uses) and
   answers a `Candidate` (track, item and take GUID) for every item whose take plays the whole cut range, or a
   `Refusal` naming why not: `outside-played-range` (the item plays the file, but not this part of it) or
   `unreliable-mapping` (the take has stretch markers, or its source is a trimmed `SECTION` wrapper - either breaks
   the constant-rate seconds-to-project-time mapping every bridge command relies on). A file no item plays at all is
   neither a candidate nor a refusal: it was never eligible to refuse.
2. **Two new commands, `preview_cleanup_markers` and `apply_cleanup_trims`** (`integrations/reaper/
   narration_cleanup_preview.lua`, a new feature file per the PRD's own preference "to limit merge conflicts"), each
   take a **payload file** of `item_guid|take_guid|class|cut_start|cut_end|finding_id` rows (source-file-relative
   seconds, `stamp_item_lines`'s own convention) and answer with `CLEANUP_STALE` once per candidate whose item, take
   or cut range no longer resolves (reason `item`, `take` or `range`, `navigate_item`'s own vocabulary and its own
   `project_time`/`EDGE_TOLERANCE` mapping), plus one terminal summary event (`CLEANUP_PREVIEWED` or
   `CLEANUP_APPLIED`). A stale candidate is skipped, reported, and never falls back to a neighbour, matching
   `navigate_item`'s rule. The Go client, `bridge.CleanupClient` (`internal/bridge/cleanup.go`), is `Navigator`'s
   request/response pattern extended to accumulate every `CLEANUP_STALE` event for a run before its terminal event
   answers - `Navigator` itself settles on the first event and cannot serve a batch answer.
3. **Preview only adds take markers** (one at the cut's start, one at its end, named for the candidate's class and
   finding id, deduplicated by `core.existing_take_marker` exactly as `add_finding_marker` already does) and opens an
   undo block only when at least one is actually added - a repeat preview over unchanged candidates makes no undo
   point. **Apply splits each candidate's item at its cut's start and end and removes the middle piece with
   `DeleteTrackMediaItem`**, which only forgets the item's reference to that stretch of the take: the source file on
   disk is never rendered, trimmed or deleted, so undoing a mistake is an ordinary REAPER undo. It **leaves a gap**
   where the cut was rather than closing it: every candidate in a batch, and every item **not** in it, keeps its
   timeline position exactly as it was, so "declining a candidate leaves the item byte-for-byte unchanged" holds for
   every item a call did not name, and one call's worth of trims is always exactly one undo step (a batch, or one
   candidate sent alone). Closing the gap (a ripple edit moving later items) is out of scope for this first cut: nothing
   here can verify a ripple's effect on items a call never named without a real REAPER, and shortening a pause instead
   of only removing it is not what any Phase 10 success signal asks for.
4. Every row on the same item is resolved and reported in the payload's own order (so a caller sees stale results in
   the order it asked), but the plan `apply_cleanup_trims` executes is re-sorted by descending cut-start first: a
   split only ever shortens an item from its right edge and gives the removed stretch a new GUID, so applying the
   right-most cut on an item first keeps that item's own GUID naming its left-most remaining part, valid for every
   candidate still to its left in the same call.
5. No host binding is added in this phase. The PRD's own Phase 10 scope is Lua commands, a Go client and the manual
   checklist; a narrator-facing trigger is later work (Phase 11 shares this preview/apply mechanism, and any UI for it
   is lane C's).

## Consequences

- A `silence_cleanup` finding still carries only a file and a cut range; `cleanupmap.ForFile` is the one place that
  turns that into item identity, so it never has to be duplicated at the call site, and a finding never needs an
  ADR 0238 shape change to gain a GUID it does not otherwise need (Phase 9's Diagnostics tab still reads unchanged).
- A file played by several items (a duplicate render, a pickup) maps to a `Candidate` for each: nothing here picks
  one, so a caller (not built in this phase) decides which to send.
- Leaving a gap means "silence cleanup" shortens nothing on the timeline in this phase; it only removes the audio a
  candidate names. Superseding this to close the gap needs a new ADR, because a ripple changes items a call never
  named, and the manual REAPER checklist (`docs/architecture/reaper-navigation.md`'s pattern) would need to grow a
  case for it, which the owner has not yet run.
- The harness (`integrations/reaper/tests/cleanup_preview_test.lua`, `fake_reaper.lua`'s new `DeleteTrackMediaItem`,
  `mutations.json`) proves the Lua's own logic against a fake `reaper`; it does not prove REAPER itself splits and
  deletes the way the fake models it, or that a narrator reads the resulting gap as intended. The PRD's own manual
  REAPER checklist (marker equals eventual trim boundary, decline leaves the item unchanged, one undo step) is still
  the owner's to run before this is "verified", not something this change can claim on its own.
