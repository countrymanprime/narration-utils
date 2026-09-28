# 0568. A sibling book's character names are read through a new, plain, never-quarantining `guide.ReadOnlyNames`

**Status:** Accepted
**Date:** 2026-09-28

## Context

The series voice bible (ADR 0565) needs a display name for each pooled character id, including a character whose approved reference lives in a sibling book. A character's canonical name lives in that book's own Story Bible (`<project>/ManuscriptGuide/manuscript_guide.json`, `internal/guide.Service`), which - like `references.json` before Phase 9 - had no cross-project read path.

## Decision

- **`apps/desktop/internal/guide/readonly.go`** adds `ReadOnlyNames(project string) (map[string]string, error)`, mirroring `character.ReadOnly` (ADR 0450) exactly: a plain `os.ReadFile` and `json.Unmarshal`, version-checked against the same `schemaVersion` the package's own service reads, and on any decode failure an error returned with the sibling's file left completely untouched - never quarantined, renamed, or otherwise written. It is not built on `guide.Service.document`/`Entities`, which go through `persist.Reporter` and can quarantine a corrupt file; that behavior belongs only to a project's own session acting on its own data, the same reasoning ADR 0450 already gives for `character.ReadOnly` not reusing `Service.readLocked`.
- **Only `id -> canonical_name` is extracted**, skipping a `Draft` entry (the same "not yet a real entry" rule `Guide.tsx`'s own list already applies) and any entity missing an id or name. No other Story Bible field crosses the project boundary - this function has no other consumer to justify carrying more.
- **A missing Story Bible file reads as an empty map, not an error** (a project with no rebuild yet), matching `character.ReadOnly`'s "a missing `references.json` is not an error" rule.

## Consequences

- `internal/series` (already depending on `internal/character`) now also depends on `internal/guide`, both leaf packages with no dependency on `internal/series` itself, so no import cycle.
- A second read-only cross-project function duplicates a small amount of decode logic with `character.ReadOnly` rather than sharing it, for the same auditability reason ADR 0450 gives: two short, independent, obviously-read-only functions are easier to verify than one shared helper carrying a "never write" mode flag that a future caller could pass incorrectly.
