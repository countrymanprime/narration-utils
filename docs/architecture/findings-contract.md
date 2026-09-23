# Shared Findings Contract

**Status: foundation delivered, two producers.** This contract is the interoperability boundary for all analyzers and the Review page. The Go record, validation, stable IDs, review state, and the project-sidecar `Store` are implemented in [`apps/desktop/internal/findings`](../../apps/desktop/internal/findings) (review-dashboard-and-findings-adoption.prd.md Phase 1); the measurement analyzer ([ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md)) is its first producer. Transcript Compare's Go adapter (Phase 2, [`apps/desktop/internal/transcript/findings_adapter.go`](../../apps/desktop/internal/transcript/findings_adapter.go)) is its second: it reads `results_<run>.txt` directly for `confidence`/`timing_gap_seconds` (never forwarded by the Lua bridge) and joins those to the bridge-built rows by the same `<item_index>@<srcpos>` id the bridge uses, saving on `COMPARE_INSPECTED`; since Phase 6 each row also carries the item, take and track GUIDs the bridge appends to `COMPARE_MARKER`, which the adapter puts in `source`. Manuscript Guide does not emit it yet; its Go adapter is a later phase of the same PRD. The read-aloud dialog's live flags are another ([`apps/desktop/internal/liveflags`](../../apps/desktop/internal/liveflags), analyzer `teleprompter`, [ADR 0117](../adr/0117-live-flags-are-kept-as-suspected-findings-merged-per-chapter-when-a-session-ends.md)): suspected, `confidence: null`, anchored to the manuscript span until a take is known.

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

- `<project>/narration-utils/findings/<analyzer>/<scope>.json` — one analyzer's findings for one scope (typically a chapter id), fully regenerated on each `Store.SaveAnalyzerFindings` call. Findings absent from the fresh set are kept, marked `not_in_latest_run`, rather than deleted. An analyzer whose runs each cover only part of a scope (a live read-aloud session) calls `Store.MergeAnalyzerFindings` instead, which writes the fresh findings over the stored ones by id and keeps the rest unchanged, never marked `not_in_latest_run`.
- `<project>/narration-utils/findings/review.json` — one append-only decision history shared by every analyzer, written by `Store.RecordDecision`. Later entries for the same finding id supersede earlier ones; nothing is edited or pruned.

`resetDerived` (`apps/desktop/internal/manuscript/service.go`) removes the whole `narration-utils/findings` directory on a confirmed manuscript replace and on Clear, because findings are anchored to chapter and paragraph ids that no longer mean the same thing afterward.

## Reading and deciding findings

The UI reads and decides every analyzer's findings through four bindings in `apps/desktop/bindings_findings.go` ([ADR 0120](../adr/0120-findings-are-read-and-decided-through-four-generic-bindings-and-a-decision-carries-the-evidence-version-it-was-made-against.md)); none of them names an analyzer, so an analyzer that saves into the store needs no binding of its own:

- `FindingsList(query)` answers `{findings, total}`: one page of the matches, filtered, sorted and paged in Go by `findings.Query` (`apps/desktop/internal/findings/query.go`). Filters are analyzer, category, severity, review status, chapter id, a minimum confidence and whether to include findings not in the latest run; sort keys are `chapter` (the default), `time`, `confidence` and `severity`, and a finding with no value for the key sorts last either way. A filter the store cannot answer fails the call.
- `FindingsGet(id)` answers one finding, or fails when the project no longer has it.
- `FindingsReview(id, evidenceVersion, status, note)` appends the decision and answers the finding as stored. It is refused, and nothing is recorded, when `evidenceVersion` is not the stored finding's (the analyzer ran again since the page showed it) or the finding is gone. `unreviewed` reopens a decision; the host stamps the time.
- `FindingsSummary()` answers the latest run's counts by review status (the navigation badge is `unreviewed`), how many findings the latest run did not reproduce, and the analyzers, categories and chapters present.

The finding itself crosses the boundary in this document's snake_case; the envelopes around it are camelCase like every other binding. The UI's schema is `apps/ui/src/api/schemas/findings.ts`, the golden payloads are `tests/fixtures/contracts/findings-{list,review,summary}.json`.

## Rules

- Audio and manuscript paths remain local and are never embedded in a report intended for sharing unless the user asks.
- REAPER navigation uses GUIDs only: a finding is found by its `source.item_guid` (and `take_guid`) and its source-relative time. Project-time data is kept for sorting and display, never as a navigation fallback: a finding whose GUID no longer resolves is reported stale and nothing is moved ([going to and looping a finding](reaper-navigation.md), [ADR 0121](../adr/0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md)).
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
