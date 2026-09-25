# 0209. Chapter sync asks once per project, and with consent every link path runs one sync

**Status:** Accepted
**Date:** 2026-09-25

## Context

`docs/prds/daw-chapter-track-auto-sync.prd.md` asks for the narrator to be told, once, that the app will now sync chapters to tracks, as soon as a project has both a manuscript and a linked DAW project. After that, confident matches should be linked without a click. Phase 2 built the pure planner (`chaptersync.Build`) and the store's auto-links (ADR 0202, 0203), and nothing called them. D39 takes the PRD's recommended answers: S1 (A: ask when the project has a manuscript and a linked `.rpp`, from any link path, whichever came second), S2 (A: "Not now" is stored and not asked again, and sync is turned on later from Tracks) and S12 (a toast per batch with Undo, and unmatched new tracks listed quietly). ADR 0207 found that the matcher's candidate pool is every chapter, so a chapter removed from recording could otherwise be auto-linked.

## Decision

- **The consent is a project decision on the manifest.** `project.Manifest.ChapterSync{enabled, decidedAt}` is additive with `omitempty`, and it survives Replace manuscript like the DAW link and the credits values. Nil means not asked. `ChapterSyncSetEnabled(true|false)` stores Sync or Not now; the Tracks page's later toggle uses the same call.
- **When to ask.** `ChapterSyncState` answers `ask` when the consent is undecided, a manuscript is imported, and the project has a linked DAW project. That last fact is `dawLinkFacts`, the same one Bootstrap's `dawFileLinked` reports. Every link path sends the state, so the UI asks at whichever moment comes second. Those paths are the DAW link (`ProjectLinkDawFile`), choosing the `.rpp` on Tracks, a successful import (the manuscript service's job end) and a project attach.
- **With consent, each of those paths runs one sync.** `runChapterSync` reads the narration chapters only (ADR 0207) and the saved `.rpp`, runs `chaptersync.Build`, writes the confident two-way matches through `MappingStore.AutoLink` (which refuses to overwrite anything) and stores the snapshot. Syncs are serialised. None runs while an import job is open (the import's own end runs one after). A sync never fails the path that triggered it: a failure is logged.
- **The preview writes nothing.** `ChapterSyncPreview` is the plan a sync would carry out now, with the links it keeps. It is what the consent dialog lists.
- **Undo is the store's.** `ChapterSyncUndo(trackGuid)` removes an automatic link and records the pair as rejected (ADR 0203). It refuses a manual link.
- **One live event.** `chaptersync:state` carries the same payload as `ChapterSyncState` after every link path, sync and Undo. It includes `batch` (the links just made, and new tracks that match no chapter) only when a sync did something, and the UI toasts once per batch. The payload's schema is `chapterSyncStateSchema`, and the goldens are `chapter-sync-state-{ask,synced}.json` and `chapter-sync-preview.json`. It is a host-to-UI event, not a REAPER one, so it has no `wire.go` row. `hostAPIVersion` is 53.
- **The import-end callback is kept per project.** `configureLocked` rebuilds the manuscript service for each project, and it now registers `importJobEnded` on the rebuilt service. Before, an attached project's imports sent no `job:ended` (ADR 0076), and they would never have reached sync.

## Consequences

- Linking a REAPER project, or importing into a project that has one, asks once. After Sync, conventionally named chapters are linked with no further click, and the toast says what was linked, with Undo.
- Watching the saved `.rpp` for changes (a new track picked up within seconds) is Phase 4. Until then a new track is linked at the next link path or attach.
- The mock asks only with `?mockChapterSync=ask`. It otherwise boots as if sync was already on and had run, so the dialog and the toast never cover other screens.
- `job:ended` for manuscript imports now reaches the UI in an attached project, as ADR 0076 intended.
