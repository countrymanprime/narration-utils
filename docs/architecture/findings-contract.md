# Shared Findings Contract

**Status: foundation delivered, one producer.** This contract is the interoperability boundary for all analyzers and the Review page. The Go record, validation, stable IDs, review state, and the project-sidecar `Store` are implemented in [`apps/desktop/internal/findings`](../../apps/desktop/internal/findings) (review-dashboard-and-findings-adoption.prd.md Phase 1); the measurement analyzer ([ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md)) is its first producer. Existing analyzers (Manuscript Guide, Transcript Compare) do not emit it yet; their Go adapters are later phases of the same PRD.

## Required finding shape

Each analyzer writes a versioned JSON finding record (schema v1) with these fields:

| Field | Purpose |
| --- | --- |
| `schema_version`, `id`, `analyzer` | Stable format, identity, and producer. |
| `project` | Project path/identity plus the sidecar-relative output location. |
| `source` | DAW-neutral audio source identity and optional REAPER track, item, and take GUIDs. |
| `time_range` | Start/end seconds in project time, plus optional `source_start`/`source_end` source-relative offsets. |
| `manuscript` | Chapter ID/title, expected text, recorded text, and an optional `span` (paragraph id, character offsets, and an ordinal for repeated matches within a paragraph). |
| `category`, `severity`, `confidence` | Filterable classification; `confidence` is nullable (an analyzer that cannot produce a numeric score reports `null`, never a fabricated one), and `confidence_reason` is always required, explaining the score or its absence. |
| `evidence` | Measurements, transcript alignment, reference IDs, excerpts, or file references supporting the claim. |
| `evidence_version` | A hash of the audio-side evidence a decision was made against (recorded text, source file identity, timing beyond a tolerance). The store keeps a decision only while `id` and `evidence_version` both match; a changed `evidence_version` returns the finding to `unreviewed` but keeps the narrator's earlier note. |
| `suggested_action` | A reversible proposed operation, its parameters, and whether explicit confirmation is required. |
| `review` | `unreviewed`, `accepted`, `dismissed`, or `deferred`, with optional narrator note and timestamp. |
| `not_in_latest_run` | Set only by the store's merge, never by an analyzer: true when the latest run did not reproduce this finding. It is kept, not deleted, for audit. |

## Identity

A finding's `id` is manuscript-anchored: chapter, paragraph, kind, expected span text, and an ordinal for repeats (`findings.StableID`), so it survives a different ASR model or timing jitter that an audio-anchored id would not. `evidence_version` is a separate value carried alongside the id for exactly the case an id-only scheme cannot express: the same line, re-recorded to say something different.

## Sidecar layout

Only the Go host writes to the project's findings sidecar; REAPER Lua and the Python sidecars never touch it. Every write is temp-file-then-rename (`findings.Store`, mirroring `transcript.Service.SaveHints`):

- `<project>/narration-utils/findings/<analyzer>/<scope>.json` — one analyzer's findings for one scope (typically a chapter id), fully regenerated on each `Store.SaveAnalyzerFindings` call. Findings absent from the fresh set are kept, marked `not_in_latest_run`, rather than deleted.
- `<project>/narration-utils/findings/review.json` — one append-only decision history shared by every analyzer, written by `Store.RecordDecision`. Later entries for the same finding id supersede earlier ones; nothing is edited or pruned.

`resetDerived` (`apps/desktop/internal/manuscript/service.go`) removes the whole `narration-utils/findings` directory on a confirmed manuscript replace and on Clear, because findings are anchored to chapter and paragraph ids that no longer mean the same thing afterward.

## Rules

- Audio and manuscript paths remain local and are never embedded in a report intended for sharing unless the user asks.
- GUIDs are preferred for REAPER navigation; positional data is retained as a fallback for stale projects.
- A finding can suggest one action but cannot execute it. The REAPER adapter owns execution and undo blocks.
- An analyzer must identify uncertain or unavailable evidence rather than fabricate a score.
- Dismissed findings remain auditable and are not regenerated as new IDs unless source evidence materially changes.

## Initial categories

`transcript_discrepancy`, `pronunciation`, `entity`, `pickup`, `duplicate_read`, `take_comparison`, `character_continuity`, `pacing`, `audio_quality`, `delivery_qc`, `silence_cleanup`, and `level_consistency`. The planned silence cleanup, and clause split and level normalize, tools that would produce the last two are specified in [diagnostics-delivery-and-cleanup-tools.prd.md](../prds/diagnostics-delivery-and-cleanup-tools.prd.md).

## Acceptance criteria

- Transcript Compare can map every current marker row to a finding without losing manuscript or recorded snippets.
- New analyzers can create findings without importing REAPER APIs.
- The dashboard can navigate a valid REAPER finding and safely mark a stale one unavailable.
- A decision survives a host restart and a re-run with unchanged evidence, and returns to `unreviewed` (keeping its note) only when `evidence_version` changes.
