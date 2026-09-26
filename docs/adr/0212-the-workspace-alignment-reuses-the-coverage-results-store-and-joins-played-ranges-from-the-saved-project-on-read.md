# 0212. The workspace alignment reuses the coverage results store and joins played ranges from the saved project on read

**Status:** Accepted
**Date:** 2026-09-26

## Context

[ADR 0242](0242-the-recording-check-writes-the-chapters-word-alignment-as-additive-lines-and-align-again-never-transcribes.md) (stream B3) has the sidecar write `COVERAGE_TOKEN` and `COVERAGE_EXTRA` lines after its measurement lines, and hands lane A the host side of [edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) Phase 1: store the alignment beside the report, join `item` to item and take GUIDs, treat a results file with no token lines as "align again", and add a read binding with a Zod schema, golden and mock.

The PRD's architecture section says the host "stores it next to the report... with the same hash and staleness" (Technical Approach, "Alignment artifact (Phase 1)"). `internal/coverage` already has that hash-and-staleness machinery for the report itself: `Report` is parsed from the same tagged-line results file (`report.go`), wrapped in a `StoredResult` keyed by ledger record id (`results.go`), and read back through `Service.Result`, which answers `current`, `stale` or `never` against the saved project, the manifest's item GUIDs and the manuscript hash (`read.go`). Building a second store for the alignment would mean a second staleness computation that could disagree with the first, for data written by the same run.

## Decision

1. **The alignment is not a new store.** `Report` (`report.go`) gains two more fields, `Tokens []TokenLine` and `Extras []ExtraLine` (`alignment.go`), parsed from `COVERAGE_TOKEN` and `COVERAGE_EXTRA` lines the same way `COVERAGE_ITEM` and `COVERAGE_REGION` already are: an unrecognized tag is skipped, so an old results file with none reads with empty `Tokens`. `StoredResult` already embeds `Report`, so the alignment gets the report's own ledger record, hash and staleness for free, and `Report.HasAlignment()` (`len(Tokens) > 0`) is the "align again" signal the PRD asked for: `false` for a report stored before this line shipped.
2. **Played ranges are joined live, not stored.** `Service.Alignment` (`workspace.go`) calls `Result` for the state, reasons, basis and stored report, then re-reads the saved project (`savedProject`) and looks up each analyzed item's current `TakeGUID`, `SourceStart` and `PlayRate` (ADR 0242 §5) by item GUID (`tracks.Project.ItemByGUID`). An item the saved project no longer holds by that GUID answers `Live: false` with no played range: the existing staleness evaluator already flags an item edit as `stale`, so a live re-read only ever adds freshness, never disagrees with it.
3. **A new binding, not new fields on `CoverageResult`.** `WorkspaceAlignment` (`bindings_coverage.go`) is its own read, sharing `CoverageResult`'s state, reasons and basis shape but never sending the report's full items, paragraphs and regions to a caller that only wants tokens: `AlignmentView` carries the chapter's paragraphs (read fresh from the manuscript, since `Report` never held their text) and the joined items alongside the tokens and extras.
4. **Token lines keep the sidecar's short keys on the wire.** `TokenLine`'s JSON tags (`i`, `p`, `w`) match `COVERAGE_TOKEN`'s own (ADR 0242 §1) end to end, including in `WorkspaceAlignment`'s answer: a chapter has thousands of tokens, the same size concern the sidecar's own tags were chosen for, and a decode step at either end would spend cycles renaming keys the UI can just document instead (`apps/ui/src/api/contracts/workspace.ts`).

## Consequences

- One staleness computation, in one place, for the report and the alignment together: a stale coverage result and a stale alignment always agree, because they are the same `evaluate` call.
- The Zod schema, golden and mock live beside `coverage.ts`'s own (`schemas/workspace.ts`, `contracts/workspace.ts`, `workspaceMock.ts`), reusing `CoverageResult`'s reason list rather than declaring a second one.
- `hostAPIVersion` moves to 60 for the new binding.
- Phase 2 (lane C) still has to build the workspace UI on this: the mock's played-range join is honestly `live: false` for now, since the coverage mock's synthetic item GUIDs and the tracks mock's real ones are not the same fixture universe — wiring them together is that phase's job once a screen exists to use it.
- A later phase that needs the alignment to survive independently of the coverage report (for example, an alignment kept after the report itself is superseded) would need a new ADR to split them apart.
