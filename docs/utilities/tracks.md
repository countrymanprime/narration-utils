# Tracks

**Status: Implemented.**

## User problem

A narrator wants to see what a REAPER project actually contains - which tracks exist, which have audio, which are muted or point at missing files - and listen through them without switching to REAPER, including when the app was launched standalone with no REAPER session running.

## Workflow

Open a project folder. The Tracks page finds the project's `.rpp` file, lists its tracks, offers play/pause, skip back/forward 30 seconds, and previous/next track, and lists every chapter's confirmed link to a track. See [Using the app: Tracks](../guides/using-the-app/tracks.md) for screenshots.

## How it works

- **Static `.rpp` parsing, not the REAPER bridge.** `apps/desktop/internal/tracks` reads the project file directly (REAPER's nested `<TAG ... >` chunk text format), so it works with REAPER closed. The file-session Lua bridge (`integrations/reaper/narration_ui_bridge.lua`) only works while REAPER has the launcher script running, which a standalone launch (see [standalone launch](../architecture/standalone-launch.md)) does not have. Live-session state (the edit cursor, selection) is out of scope here.
- **Discovery.** Only top-level `*.rpp` files in the project folder count. `.rpp-bak` files and anything inside a subfolder (such as REAPER's Backups folder) are ignored. One file is used automatically; with several, the narrator picks one and the choice is saved as `Tracks.selectedRpp` in `<project>/narration-utils/settings.json`. A saved choice that no longer exists is dropped rather than followed.
- **What is read.** Per track: GUID, name, color (`PEAKCOL`, decoded from REAPER's native color), mute/solo. Per item: position, length, name, and its source, which describe the item's *active* take, not necessarily its first one. `SECTION` sources (trimmed regions) are unwrapped to the file they wrap.
- **Every take, not just the active one (the parser superset).** `Item` also carries its own GUID (`IGUID`; the item's identity across edits that don't change its take content), every `Take` in file order (each with its own GUID, name, source, `SOFFS`/`PLAYRATE`, `SECTION` offsets, FX-chain presence and stretch-marker count, and its own extension data), and which one is active. This is not yet on the `TracksList` wire contract or shown in the UI - no page or binding consumes it yet - but `Project.ItemByGUID` lets a caller re-resolve an item by its own GUID regardless of which take is active, the identity the take-review PRD's scans and take-creation actions target (no manuscript line-identity stamp needed for that - see [take-review-pickups-duplicates-take-intelligence.prd.md](../prds/take-review-pickups-duplicates-take-intelligence.prd.md) Q6).
- **Unavailable and unsupported are states, not errors.** An item whose source file is missing on disk is reported as unavailable; a non-audio source (MIDI, embedded subproject, video) is reported as unsupported. The track is still listed, flagged, and its playable count shown (for example `0/1`).
- **Empty and failure states.** A folder with no `.rpp` shows a "No REAPER project file found" message rather than a blank page. If audio that was available at load time can't be played (moved or deleted since), playback stops and the page says so; a playback request interrupted by switching tracks is not treated as a failure.
- **Playback.** A track's playable items play back to back in project-time order. Previous/next moves between tracks, not items. Audio is streamed through the `/media` route - see [ADR 0012](../adr/0012-media-route-for-track-playback.md) - which serves any take's source (not only each item's active take) that the current project's selected `.rpp` references, and supports HTTP Range requests so skipping doesn't load a whole chapter into memory.
- **Chapter links.** The `Chapter links` list (analysis evidence ledger PRD, Phase 7) shows one row per narration chapter (reference chapters are hidden, since they have no audio to link) against the `chapter-track-map.json` store built in Phase 5: **Linked** with the track's name when the confirmed `trackGuid` still resolves to a track in the current project, **Not linked** with nothing confirmed, and **Track missing** when a confirmed `trackGuid` no longer resolves (the track was deleted, or the selected `.rpp` changed). A reusable `MappingConfirm` widget (`apps/ui/src/components/mapping/MappingConfirm.tsx`) drives the pick-a-track/Confirm/Change/Clear flow in each row, so the same prompt can sit beside a future check (a Home row's "Check recording", an evidence view) without the narrator visiting Tracks first. Linking never chooses for the narrator: a suggested match (TM Phase 8's matcher, not built yet) is a proposal only, and this page shows confirmed links, made through `ChapterTrackMapList`/`Confirm`/`Clear`.

## Non-goals and review boundary

Read-only: nothing edits the `.rpp`, moves media, or changes REAPER state. Track-to-chapter *matching* (scoring a suggestion) is TM Phase 8; this page and the mapping store only record and show the narrator's own confirmation of a link, never a computed guess. Measured recorded duration is planned in [diagnostics-delivery-and-cleanup-tools.prd.md](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) (Phase 8); transcript and waveform views are recorded there as later work. Both can build on this parser instead of a new bridge action.

## Known limits

- Quoted values that contain all of `"`, `'` and a backtick (REAPER falls back to its own escape format) are read as plain tokens; this affects display names only.
- Only the first occurrence of a given scalar attribute *within one take* is read; a multi-take item's per-take attributes (`NAME`, `SOFFS`, `PLAYRATE`, `GUID`, `SM`, `<SOURCE>`, `<TAKEFX>`, `<EXT>`) are each read once per take by walking the take boundaries (`TAKE` lines), not once for the whole item.
- Item volume/pan (`VOLPAN`/`TAKEVOLPAN`), item notes, and the `PLAYRATE` line's reverse/pitch fields beyond the rate itself are not read yet (see `apps/desktop/internal/tracks/testdata/reaper/README.md`).
- The browser-only mock mode has no `/media` route. It plays a generated silent 10-minute WAV for every playable item instead, so the transport, skip, and time readout can be exercised and screenshotted; the desktop app is needed to hear real audio.

## Acceptance

- One `.rpp` is used without prompting; several prompt for a choice, and the choice persists per project.
- A missing or non-audio item flags its track without failing the page.
- The media route refuses any path that is not a source of the selected project's tracks (of any take of any item, not only the active take).
- Covered by `apps/desktop/internal/tracks` and `apps/desktop/media_test.go` (Go), `TracksPage.test.tsx`/`useTrackPlayback.test.tsx`/`App.test.tsx` (UI), and the `tracks` states in the Playwright visual suite (default, playing, skipped-forward, unplayable-track-selected, last-track-selected, rpp-picker, no-rpp; the audio-failure message is covered by unit tests only, since the mock always serves playable audio).
