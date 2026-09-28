# 0545. Native takes join take review as a parallel, line-scoped panel, not the repeats scan

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none (extends [ADR 0485](0485-a-native-takes-line-identity-lives-in-a-project-owned-sidecar-file-mirroring-but-not-sharing-code-with-adr-0026.md) and [ADR 0455](0455-the-built-in-recorder-records-each-take-to-a-partial-file-in-the-projects-recordings-folder-and-links-it-to-its-take-name.md); neither is superseded)

## Context

`docs/prds/native-recording-suite.prd.md` Phase 4 ("Take review integration") asks for "native takes appear in the same take-review UI as REAPER takes, with keeper marking and undo, so there is one take-review experience whatever the source." Phase 3 ([ADR 0485](0485-a-native-takes-line-identity-lives-in-a-project-owned-sidecar-file-mirroring-but-not-sharing-code-with-adr-0026.md)) built the line-identity sidecar and `Service.SetTakeLine`, with no UI caller, and left one gap on record: `internal/repeats`'s finding-id and evidence-version keys (`adapter.go`'s `memberKey`) lean on REAPER's item/take GUIDs for uniqueness between reads. Closing that gap to let a native take become a *member of a REAPER-sourced pickup/duplicate finding* would reshape every existing take-review finding's id and evidence version, silently orphaning narrators' stored review decisions (ADR 0485's own Consequences section flags this and leaves it unfixed).

The existing take-review UI (`apps/ui/src/components/proof/{TakeReviewReads,TakeComparisonView,TakeComparisonDialog,TakeReviewScanDialog}.tsx`) is built entirely around that REAPER-sourced finding model: a "read" is `internal/repeats.Member`, keyed by `item_guid`/`take_guid`, produced by the `compare.py --find-repeats` sidecar mode comparing REAPER track items against each other. Making a native take a "read" inside that model means the sidecar would need to transcribe and align a native WAV file the same way it does REAPER's, and the finding-id scheme above would need to change under every narrator's existing stored decisions. That is a detection-engine change, not a review-integration one, and it is not what this phase's Solution Detail row ("Should: Mark the keeper take among several; narrator-confirmed, undoable") or its success measure ("Playwright/visual coverage of the merged UI; narrator can mark a keeper and undo it") asks for.

D86 (2026-09-28) answered the PRD's open questions with "the PRD's recommended engine" and "record-and-organize only" (Q1): this phase is about organizing takes that already exist on disk, not about detecting duplicates across sources.

## Decision

Native takes get their own panel on the same Proof chapter page the REAPER-sourced take-review UI already lives on (`ProofChapterPage.tsx`), not a code path inside `TakeReviewReads`/`TakeComparisonView`. `NativeTakesPanel.tsx` sits beside `RecordingCheckCard` (the same per-chapter `Panel` precedent) and:

- lists the chapter's native takes (`RecorderTake`, matched by `lineId`'s entity id against `chapter.paragraphIds` and `chapter.id`), grouped by line;
- for a take not yet assigned to a line, offers assignment to one of the chapter's paragraphs through `RecorderSetTakeLine` - the first UI caller of Phase 3's `SetTakeLine` binding, added here as `bindings_recording.go`'s `RecorderSetTakeLine(takeName, entityId)`, which reads the manuscript's current source checksum itself (mirroring `bindings_preview.go`'s own small copy of the same lookup) so the UI can never stamp a stale or wrong one;
- lets the narrator mark one take the "keeper" of its line and undo it (`RecorderSetTakeKeeper`, backed by a new `internal/recording/keeper.go` sidecar, `Recordings/keeper.json`, the same shape and corruption handling as `identity.go`'s `line-identity.json`). Marking a take the keeper clears the mark on every other take sharing its line (an exclusive choice per line, mirroring what REAPER's single active take already means, without a REAPER active-take concept to lean on - Q5); a take with no line yet has no group to clear. Every change is narrator-confirmed (an explicit click) and always undoable (mark `false`, or mark a different take), matching D86's answer to Q5 that a native take's audio is never touched by any of this.

Assignment (the "Not yet assigned to a line" list) is offered only while the project's current recording engine is `builtin` (`RecorderState.engine`); a take already assigned - and its keeper mark - keeps showing regardless of the project's current engine, since Q2/D86 makes REAPER and native recording coexist, and a narrator who switches back to REAPER should not lose sight of native takes they already organized. This also keeps every REAPER-only chapter's existing Proof page unchanged in every case a project has never used the built-in recorder to record something.

`internal/repeats`'s finding-id gap stays exactly where ADR 0485 left it: unfixed, documented, and still unreachable in production (nothing here constructs a `Member` from a native take).

## Consequences

- A narrator gets one page (Proof's chapter view) where both REAPER-sourced take-review findings and native takes are reviewed, satisfying the phase's "one take-review experience whatever the source" goal at the UI layer, without a detection-engine change or a breaking id-scheme migration.
- `TakeReviewReads.tsx`, `TakeComparisonView.tsx`, `TakeComparisonDialog.tsx`, `TakeReviewScanDialog.tsx` and `FindingDetail.tsx` are unchanged: a native take is never a "read" of a REAPER-sourced finding, and `internal/repeats`'s deliberately-unfixed member-key gap (ADR 0485) is not touched by this phase.
- Unifying native takes into the actual pickup/duplicate *detection* (so a native take and a REAPER read of the same line can be flagged as duplicates of each other) is explicitly future work, gated on settling a stable per-member native identity in `internal/repeats` first (ADR 0485's own recommendation: the take's own file name is a candidate, since it is stable and never reused). This ADR does not attempt it.
- The keeper mark is new state with no REAPER equivalent (REAPER's "active take" is a per-item DAW concept; a native take has no item). A later phase that lets a keeper mark do something beyond bookkeeping (for example, auto-selecting it when a native take is later promoted into a REAPER project) needs a new decision - this one only records the choice.
- `RecorderSetTakeLine`/`RecorderSetTakeKeeper` are two new Wails bindings, so `hostAPIVersion` moved to 81 (from 80) and `Host.*` was regenerated.
