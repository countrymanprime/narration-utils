# 0402. Proofer notes join the shared findings store instead of a second merge layer

**Status:** Proposed
**Date:** 2026-09-26

## Context

The [audiobook studio benchmark](../research/audiobook-studio-benchmark.md) rates "a two-way link: resolving a note in the DAW updates the proof list, and the reverse" as this app's strongest possible differentiator, and asks (recommendation 3) that proofer, AI and self notes merge into one list with resolutions.

`apps/desktop/internal/findings` already implements exactly that mechanic for two of the three sources: `CategoryTranscriptDiscrepancy` (AI, from Transcript Compare) and `CategoryPickup` (self, from `internal/repeats`' duplicate/restart detection and `internal/liveflags`' live teleprompter flags) both flow into one store, partitioned by an `analyzerName`, and the Review dashboard already merges every partition into one list ([review-dashboard-and-findings-adoption.prd.md](../prds/review-dashboard-and-findings-adoption.prd.md), Milestone 1, shipped). `apps/desktop/internal/guide/findings_adapter.go` already proves the "reverse direction" half of the differentiator: a finding disappears from the merged list on its own once the condition that produced it (an entity's `review_state`, here) no longer holds — no separate "resolve" call is needed on the findings side.

The proofer's CSV import (`internal/pickups`'s `import_pickups`) is the one source that never reaches this store: it writes REAPER markers only, worked through in a separate screen, `PickupsDialog.tsx`. Two designs were possible for [Closed-Loop Proofing](../prds/closed-loop-proofing.prd.md) to merge it in: build a second, proofing-specific merge layer that reads both the findings store and the REAPER marker state and reconciles them at render time; or make the proofer import itself a producer of `findings.Finding` records, the same way `internal/repeats` and `internal/liveflags` already are, and let the existing merge do the rest.

## Decision

The proofer's CSV import writes to `findings.Store` in addition to REAPER markers, under a new category (`CategoryProoferNote`) and a new analyzer partition (`proofer-import`), using `SaveAnalyzerFindings` exactly as `internal/repeats` and `internal/guide/findings_adapter.go` already do. The REAPER-marker write stays, since it is still how a narrator jumps to the spot in REAPER through `PickupsDialog.tsx`; the two are additive, not a replacement of one by the other. No second merge layer is built: the existing Review dashboard, `FindingsList.tsx` and every analyzer-partition mechanic (resolution, "disappears once resolved") apply to proofer notes with no new code beyond the one new category and one new producer.

## Consequences

- A proofer's note, an AI-found discrepancy and a live session flag on the same line show up together on the Review page with no new merge, filter or reconciliation code; the dashboard already does this for every category it knows about.
- Adding `CategoryProoferNote` is additive to the wire schema `findings-contract.md` describes; an older client that does not recognize the category treats it as an unrecognized value, the same tolerance every category addition since the contract shipped has relied on.
- The pickup-readiness signal (`internal/proofing`), which already reads specific `findings.Category` values to decide whether a chapter's pickups are clear, must be told explicitly whether proofer notes count toward that signal (a phase decision, not automatic, so a proofer note does not silently start blocking a chapter's stage transition the day this ships).
- `PickupsDialog.tsx` and the REAPER-marker-only workflow are unaffected and stay available; this decision does not retire them.
- If a future feature needs proofer notes to behave differently from other findings categories (a different retention rule, a different export format), that difference is a new ADR, since this one commits proofer notes to the same lifecycle every other finding category already has.
