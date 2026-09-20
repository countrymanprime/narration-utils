# 0032. Analyzers report findings and never change the narrator's audio or manuscript on their own

**Status:** Proposed
**Date:** 2026-09-19

## Context

The suite analyzes a narrator's manuscript and recordings and could, in principle, fix what it finds: comp takes, delete silences, rewrite text, classify a voice. A wrong automatic edit to a finished recording is expensive and often invisible until delivery, and a tool that judges acting or ships audio to a cloud service would not be trusted with a narrator's work. The rule has been stated in several places without one record: the roadmap's product boundary (`docs/roadmap.md:10`) and dependency rules (`docs/roadmap.md:64-67`), the [findings contract](../architecture/findings-contract.md), and [daw-integration.md](../architecture/daw-integration.md). Related boundaries already recorded are [ADR 0019](0019-detected-manuscript-is-offered-not-imported.md) (a manuscript is offered, never imported automatically) and [ADR 0020](0020-entity-extraction-precision-over-recall.md) (extraction prefers a miss to a wrong entry).

## Decision

1. An analyzer's output is a finding: a record with evidence, a stated confidence and reason, an optional suggested action, and a review state (`unreviewed`, `accepted`, `dismissed`, `deferred`). A finding may suggest one action and cannot execute it; the REAPER adapter owns execution and undo blocks. Analyzers do not edit audio or the manuscript themselves.
2. Every action that changes the project is triggered by the narrator, names its target explicitly (an item GUID, or a run's own item mapping), is one REAPER undo step, and does nothing, and creates no undo point, when there is nothing to change. Take creation, when it is built, follows the same rule (`docs/roadmap.md:66`).
3. Character and voice analysis uses only clips the narrator has explicitly approved (`docs/roadmap.md:67`).
4. Analysis is local. No audio or manuscript is sent to a cloud service, and models are fetched only through the explicit first-use flow.

## Consequences

**Enforced by code today**

- The findings record is data only: `shell/internal/findings/findings.go` has no method that executes a `SuggestedAction` (`:98-103`), rejects a record without a `confidence_reason` (`Validate`), and keeps a finding's ID when the narrator reviews it (`WithReview`). Its only producer so far is the delivery measurement analyzer ([ADR 0025](0025-delivery-measurements-in-go-profiles-deferred.md)).
- The three commands in `shared/reaper/narration_ui_bridge.lua` that change a project run only when the host sends them, and none writes audio or the manuscript. Marker export is sent only by `TranscriptExportMarkers` (`shell/internal/transcript/service.go:274`), whose UI button is disabled with nothing to export (`shared/ui/src/components/proofing/Results.tsx:68`). Stamping line IDs targets items by GUID and reports a stale GUID without touching a neighbour (`:392-401`). Region creation is one undo block (`:501-505`).
- Only model downloads leave the machine: the one HTTP request in the Go host is the catalog download (`shell/internal/assets/store.go:110`), and the desktop host passes a verified local model directory so inference does not reach the network (`shell/internal/transcript/service.go:392`, `tools/transcript-compare/core/compare.py:503`).
- The Manuscript Guide and Transcript Compare write only to output paths the caller supplies (`tools/manuscript-guide/core/manuscript_guide.py:3-5`); this was read, not audited line by line.

**A stated boundary, not yet enforced**

- Transcript Compare and the Manuscript Guide do not emit findings yet, so their output does not carry review state or a suggested action, and the dashboard that would show review state does not exist.
- The undo rule is not uniform. Marker export calls `Undo_OnStateChange` after the markers are written, and only if some were added (`narration_ui_bridge.lua:278,292`), while the other two commands use `Undo_BeginBlock2` and `Undo_EndBlock2`. Both give the narrator one undo step, but the first is a snapshot taken afterwards rather than a bracketed block, and `daw-integration.md` says "undo blocks". The `jump_to_compare_marker` command changes item selection and the edit cursor with no undo point (`:537-539`), which is navigation, not an edit.
- Marker export targets the item and take captured when the run was prepared (`run.mapping`, an in-memory pointer), not a persisted GUID, and region creation targets project time ranges rather than an item. The GUID rule in the findings contract is met by stamping only.
- Take creation and character or voice analysis do not exist, so points 2 (takes) and 3 are commitments to keep when they are built. Nothing in code prevents a later analyzer from writing files.
- Analysis being local is a property of what exists today; nothing prevents a future feature from adding a network call, and the Python sidecar's legacy path (no `model_dir`) can still download a model on first use.

Changing this boundary, for example allowing an analyzer to apply an edit without review, needs a new ADR that supersedes this one.
