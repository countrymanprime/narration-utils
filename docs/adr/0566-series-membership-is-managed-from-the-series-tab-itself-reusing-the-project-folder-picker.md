# 0566. Series membership is managed from the Series tab itself, reusing the project-folder picker

**Status:** Accepted
**Date:** 2026-09-28

## Context

Phase 9 (ADR 0450) built `internal/series.Store` (`List`/`Save`/`Delete`/`ForProject`) but added no binding and no UI - by design, left for whichever phase first needed it. Phase 11 is that phase: the Series tab has nothing to show unless some surface lets a narrator name a series and add books to it, and nothing else in the app does this today.

## Decision

- **The Series tab itself is the only management surface.** No separate dialog, settings page or nav entry (D79 already rules out a nav entry for the tab itself). `bindings_series.go` adds `SeriesList`, `SeriesSave` (create with an empty id, update in place with an existing one - the same create-or-update shape `character.Service.Approve` and `series.Store.Save` already use) and `SeriesDelete`; the Series tab calls them directly to create a series, add a book, or remove one.
- **Adding a book reuses the existing project-folder picker** (`ProjectSelectFolder` / `api.selectProjectFolder`), the same OS folder dialog "Open project" already uses, rather than a new picker or a free-text-only path field (a text field is kept too, as the fallback / manual-entry path, since a narrator may already know the folder).
- **No binding validates that an added path is a real, openable project.** `SeriesSave` stores whatever paths it is given (after `series.Store.Save`'s own trim/dedupe/clean); a path that turns out not to be a real project surfaces as that book's clips simply never appearing (no `references.json` to read) or, if genuinely unreadable, in `UnreadableBooks` (ADR 0565) - the same honest, non-fatal handling every other cross-project read in this feature already uses, rather than a second validation path with its own error messages.

## Consequences

- A series can be created with narrator-provided paths that do not point at real projects; this is functionally harmless (an empty or unreadable entry) rather than blocked at save time, keeping `SeriesSave` a thin wrapper with no new validation surface to maintain.
- Removing a book from a series only edits `series.json`'s member list; it never touches that project's own `references.json` or deletes anything, matching every other "remove" action in this feature.
