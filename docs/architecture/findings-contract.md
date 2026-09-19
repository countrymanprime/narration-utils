# Shared Findings Contract

**Status: Planned—foundation.** This contract is the interoperability boundary for all analyzers and the REAPER dashboard. The Go record, validation, stable IDs, and review state are implemented in [`shell/internal/findings`](../../shell/internal/findings); the measurement analyzer ([ADR 0024](../adr/0024-delivery-measurements-in-go-profiles-deferred.md)) is its first producer. Existing analyzers (Manuscript Guide, Transcript Compare) do not emit it yet.

## Required finding shape

Each analyzer writes a versioned JSON finding record with these fields:

| Field | Purpose |
| --- | --- |
| `schema_version`, `id`, `analyzer` | Stable format, identity, and producer. |
| `project` | Project path/identity plus the sidecar-relative output location. |
| `source` | DAW-neutral audio source identity and optional REAPER track, item, and take GUIDs. |
| `time_range` | Start/end seconds in project time; source-relative offsets when applicable. |
| `manuscript` | Chapter ID/title, text span, expected text, and recorded text when relevant. |
| `category`, `severity`, `confidence` | Filterable classification; confidence is numeric and the analyzer's reason must be available. |
| `evidence` | Measurements, transcript alignment, reference IDs, excerpts, or file references supporting the claim. |
| `suggested_action` | A reversible proposed operation, its parameters, and whether explicit confirmation is required. |
| `review` | `unreviewed`, `accepted`, `dismissed`, or `deferred`, with optional narrator note and timestamp. |

## Rules

- Audio and manuscript paths remain local and are never embedded in a report intended for sharing unless the user asks.
- GUIDs are preferred for REAPER navigation; positional data is retained as a fallback for stale projects.
- A finding can suggest one action but cannot execute it. The REAPER adapter owns execution and undo blocks.
- An analyzer must identify uncertain or unavailable evidence rather than fabricate a score.
- Dismissed findings remain auditable and are not regenerated as new IDs unless source evidence materially changes.

## Initial categories

`transcript_discrepancy`, `pronunciation`, `entity`, `pickup`, `duplicate_read`, `take_comparison`, `character_continuity`, `pacing`, `audio_quality`, `delivery_qc`, `silence_cleanup` (see [Silence Cleanup](../utilities/silence-cleanup.md)), and `level_consistency` (see [Clause Splitting and Level Normalization](../utilities/clause-split-and-level-normalize.md)).

## Acceptance criteria

- Transcript Compare can map every current marker row to a finding without losing manuscript or recorded snippets.
- New analyzers can create findings without importing REAPER APIs.
- The dashboard can navigate a valid REAPER finding and safely mark a stale one unavailable.
