# Tracks

**Status: Implemented.**

## User problem

A narrator wants to see what a REAPER project actually contains - which tracks exist, which have audio, which are muted or point at missing files - and listen through them without switching to REAPER, including when the app was launched standalone with no REAPER session running.

## Workflow

Open a project folder. The Tracks page finds the project's `.rpp` file, lists its tracks, and offers play/pause, skip back/forward 30 seconds, and previous/next track. See [Using the app: Tracks](../guides/using-the-app/tracks.md) for screenshots.

## How it works

- **Static `.rpp` parsing, not the REAPER bridge.** `apps/desktop/internal/tracks` reads the project file directly (REAPER's nested `<TAG ... >` chunk text format), so it works with REAPER closed. The file-session Lua bridge (`integrations/reaper/narration_ui_bridge.lua`) only works while REAPER has the launcher script running, which a standalone launch (see [standalone launch](../architecture/standalone-launch.md)) does not have. Live-session state (the edit cursor, selection) is out of scope here.
- **Discovery.** Only top-level `*.rpp` files in the project folder count. `.rpp-bak` files and anything inside a subfolder (such as REAPER's Backups folder) are ignored. One file is used automatically; with several, the narrator picks one and the choice is saved as `Tracks.selectedRpp` in `<project>/narration-utils/settings.json`. A saved choice that no longer exists is dropped rather than followed.
- **What is read.** Per track: GUID, name, color (`PEAKCOL`, decoded from REAPER's native color), mute/solo. Per item: position, length, name, and its source. `SECTION` sources (trimmed regions) are unwrapped to the file they wrap.
- **Unavailable and unsupported are states, not errors.** An item whose source file is missing on disk is reported as unavailable; a non-audio source (MIDI, embedded subproject, video) is reported as unsupported. The track is still listed, flagged, and its playable count shown (for example `0/1`).
- **Empty and failure states.** A folder with no `.rpp` shows a "No REAPER project file found" message rather than a blank page. If audio that was available at load time can't be played (moved or deleted since), playback stops and the page says so; a playback request interrupted by switching tracks is not treated as a failure.
- **Playback.** A track's playable items play back to back in project-time order. Previous/next moves between tracks, not items. Audio is streamed through the `/media` route - see [ADR 0012](../adr/0012-media-route-for-track-playback.md) - which only serves files the current project's selected `.rpp` references, and supports HTTP Range requests so skipping doesn't load a whole chapter into memory.

## Non-goals and review boundary

Read-only: nothing edits the `.rpp`, moves media, or changes REAPER state. Track-to-chapter matching and measured recorded duration are planned in [diagnostics-delivery-and-cleanup-tools.prd.md](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) (Phase 8); transcript and waveform views are recorded there as later work. Both can build on this parser instead of a new bridge action.

## Known limits

- Quoted values that contain all of `"`, `'` and a backtick (REAPER falls back to its own escape format) are read as plain tokens; this affects display names only.
- Only the first occurrence of an attribute per chunk is read, which matches how REAPER writes every attribute used here.
- The browser-only mock mode has no `/media` route. It plays a generated silent 10-minute WAV for every playable item instead, so the transport, skip, and time readout can be exercised and screenshotted; the desktop app is needed to hear real audio.

## Acceptance

- One `.rpp` is used without prompting; several prompt for a choice, and the choice persists per project.
- A missing or non-audio item flags its track without failing the page.
- The media route refuses any path that is not a source of the selected project's tracks.
- Covered by `apps/desktop/internal/tracks` and `apps/desktop/media_test.go` (Go), `TracksPage.test.tsx`/`useTrackPlayback.test.tsx`/`App.test.tsx` (UI), and the `tracks` states in the Playwright visual suite (default, playing, skipped-forward, unplayable-track-selected, last-track-selected, rpp-picker, no-rpp; the audio-failure message is covered by unit tests only, since the mock always serves playable audio).
