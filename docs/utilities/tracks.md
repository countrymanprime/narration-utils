# Tracks

**Status: Implemented.**

## User problem

A narrator wants to see what a REAPER project actually contains - which tracks exist, which have audio, which are muted or point at missing files - and listen through them without switching to REAPER, including when the app was launched standalone with no REAPER session running.

## Workflow

Open a project folder. The Tracks page finds the project's `.rpp` file, lists its tracks, offers play/pause, skip back/forward 30 seconds, and previous/next track, and lists every chapter's confirmed link to a track. From there the narrator can also:

- scan the selected track for pickups and duplicate reads, audition two reads side by side, and add a read as a new take on an item (the Pickups & duplicates panel);
- stamp each chapter's identity onto the REAPER items that hold it, and read back what is stamped (**Link chapters…**);
- import a proofer's pickup CSV as pickup markers, step through the open ones, mark them done and export what is left (**Pickups…**);
- configure REAPER's render for one file per chapter region, without rendering (**Prepare chapter render…**);
- write ID3 chapter tags into a new copy of an already-rendered combined-book MP3 (**Embed chapter tags…**).

See [Using the app: Tracks](../guides/using-the-app/tracks.md) for screenshots and the exact steps.

## How it works

- **Static `.rpp` parsing, not the REAPER bridge.** `apps/desktop/internal/tracks` reads the project file directly (REAPER's nested `<TAG ... >` chunk text format), so it works with REAPER closed. The file-session Lua bridge (`integrations/reaper/narration_ui_bridge.lua`) only works while REAPER has the launcher script running, which a standalone launch (see [standalone launch](../architecture/standalone-launch.md)) does not have. Listing and playback never use the bridge; only the REAPER tools described under [Non-goals and review boundary](#non-goals-and-review-boundary) do, and they need REAPER running the launcher.
- **Discovery.** Only top-level `*.rpp` files in the project folder count. `.rpp-bak` files and anything inside a subfolder (such as REAPER's Backups folder) are ignored. One file is used automatically; with several, the narrator picks one and the choice is saved as `Tracks.selectedRpp` in `<project>/narration-utils/settings.json`. A saved choice that no longer exists is dropped rather than followed.
- **What is read.** Per track: GUID, name, color (`PEAKCOL`, decoded from REAPER's native color), mute/solo. Per item: position, length, name, and its source, which describe the item's *active* take, not necessarily its first one. `SECTION` sources (trimmed regions) are unwrapped to the file they wrap.
- **Every take, not just the active one (the parser superset).** `Item` also carries its own GUID (`IGUID`; the item's identity across edits that don't change its take content), every `Take` in file order (each with its own GUID, name, source, `SOFFS`/`PLAYRATE`, `SECTION` offsets, FX-chain presence and stretch-marker count, and its own extension data), and which one is active. The takes are not on the `TracksList` wire contract (which carries each item's GUID but only its active take's source), but the take-review scan (`apps/desktop/internal/takereview`) builds its scope from every take of the chapter track's items, and the page shows what it finds: the Pickups & duplicates panel (`TakeReviewPanel.tsx`) lists each finding's reads with their source file and coverage, auditions them over `/media`, and adds one as a take. `Project.ItemByGUID` lets a caller re-resolve an item by its own GUID regardless of which take is active, the identity the take-review PRD's scans and take-creation actions target (no manuscript line-identity stamp needed for that - see [take-review-pickups-duplicates-take-intelligence.prd.md](../prds/take-review-pickups-duplicates-take-intelligence.prd.md) Q6).
- **Unavailable and unsupported are states, not errors.** An item whose source file is missing on disk is reported as unavailable; a non-audio source (MIDI, embedded subproject, video) is reported as unsupported. The track is still listed, flagged, and its playable count shown (for example `0/1`).
- **Empty and failure states.** A folder with no `.rpp` shows a "No REAPER project file found" message rather than a blank page. If audio that was available at load time can't be played (moved or deleted since), playback stops and the page says so; a playback request interrupted by switching tracks is not treated as a failure.
- **Playback.** A track's playable items play back to back in project-time order. Previous/next moves between tracks, not items. Audio is streamed through the `/media` route - see [ADR 0012](../adr/0012-media-route-for-track-playback.md) - which serves any take's source (not only each item's active take) that the current project's selected `.rpp` references, and supports HTTP Range requests so skipping doesn't load a whole chapter into memory.
- **Chapter links.** The `Chapter links` list (analysis evidence ledger PRD, Phase 7) shows one row per narration chapter (reference chapters are hidden, since they have no audio to link) against the `chapter-track-map.json` store built in Phase 5: **Linked** with the track's name when the confirmed `trackGuid` still resolves to a track in the current project, **Not linked** with nothing confirmed, and **Track missing** when a confirmed `trackGuid` no longer resolves (the track was deleted, or the selected `.rpp` changed). A reusable `MappingConfirm` widget (`apps/ui/src/components/mapping/MappingConfirm.tsx`) drives the pick-a-track/Confirm/Change/Clear flow in each row, so the same prompt sits beside a check without the narrator visiting Tracks first (the Home [recording check](recording-coverage.md) shows it when a chapter has no confirmed track; a future evidence view can do the same). Linking never chooses for the narrator: a suggested match (the matcher below) is a proposal only, and this page shows confirmed links, made through `ChapterTrackMapList`/`Confirm`/`Clear`.
- **Chapter-to-track matching.** `apps/desktop/internal/chaptermatch` owns the one matcher every consumer shares ([ADR 0110](../adr/0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md), teleprompter-manuscript-integration PRD Phase 8): a Go port of Transcript Compare's `find_chapter_by_track_name` (number words, homophones, whole-token prefixes, the 0.75 fuzzy floor) with parity cases in `tests/fixtures/chapter-track-match/parity-cases.json` that both implementations must pass. `ChapterTrackMatch(chapterId)` answers `confirmed` (a link from the store above wins, by track GUID, so a renamed or reordered track stays linked and is flagged), `matched`, `uncertain`, `ambiguous` or `none`, from track names and project region names (the parser reads regions, not yet on the `TracksList` wire), and for a confirmed or matched track returns where its recorded audio ends: the last unmuted item's end in project time, and in its active take's source (SECTION start + `SOFFS` + length x `PLAYRATE`), as of the `.rpp`'s last save. It never creates a track or a link. The mapping store's suggestions use the same matcher. Its first UI is the read-aloud dialog's resume card (PRD Phase 10), which shows the match and lets the narrator pick the track when it is not confident. The other direction, track to chapter, is `ForTrack`, with the same candidates and statuses (parity-tested against `ForChapter`); `ChapterSuggestion()` applies it to the saved `.rpp`'s record-armed track (else its selected one) so the Teleprompter's chapter picker can preselect the chapter being recorded, and only a confirmed or matched one ([ADR 0113](../adr/0113-the-teleprompter-suggests-a-chapter-from-the-saved-armed-track-and-preselects-only-a-confident-match.md), teleprompter-engines-and-input-devices PRD Phase 11). Only an exact or single whole-token prefix name is ever `matched`: a fuzzy name stays `uncertain` whatever its ratio.

## Non-goals and review boundary

The track list, playback, the chapter links list and the take-review scan and audition are read-only: they never edit the `.rpp`, move media, or change REAPER state, and the chapter links are stored in the app's own project data. The actions that do write to REAPER go through the live bridge ([the REAPER bridge](../architecture/reaper-bridge.md)) into the project open in REAPER, never into the `.rpp` file on disk, and only after the narrator presses the action's own button:

- **Link chapters…** writes namespaced item extension data (`P_EXT:narration_utils_line_id` and `P_EXT:narration_utils_line_text`) on the chosen items, in one undo block. It never touches item notes or take names, and it leaves an item stamped with a different chapter alone unless the narrator ticks Overwrite. See [manuscript line identity](../architecture/manuscript-line-identity.md).
- **Pickups…** adds `PICKUP: <note>` project markers on import (one undo block; a tag goes in brackets before the note) and renames a marker to `PICKUP_DONE: <note>` when it is marked done; Next pickup moves the edit cursor. Export only reads the markers.
- **Prepare chapter render…** sets three render settings (the output folder, the `$region` file-name pattern, and bounds of all regions) and reads back the predicted file names. It never triggers a render or changes the render format.
- **Add as take** (Pickups & duplicates) adds one take to the chosen item in one undo block; it does not change the active take or the item's length.

**Embed chapter tags…** does not talk to REAPER: it reads the last chapter render's files and writes a new, tagged copy of the MP3 the narrator names, never changing that file. Track-to-chapter *matching* lives in `internal/chaptermatch` (see [How it works](#how-it-works)); this page and the mapping store only record and show the narrator's own confirmation of a link, never a computed guess. Measured recorded duration is planned in [diagnostics-delivery-and-cleanup-tools.prd.md](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) (Phase 8); transcript and waveform views are recorded there as later work. Both can build on this parser instead of a new bridge action.

## Known limits

- Quoted values that contain all of `"`, `'` and a backtick (REAPER falls back to its own escape format) are read as plain tokens; this affects display names only.
- Only the first occurrence of a given scalar attribute *within one take* is read; a multi-take item's per-take attributes (`NAME`, `SOFFS`, `PLAYRATE`, `GUID`, `SM`, `<SOURCE>`, `<TAKEFX>`, `<EXT>`) are each read once per take by walking the take boundaries (`TAKE` lines), not once for the whole item.
- Item volume/pan (`VOLPAN`/`TAKEVOLPAN`), item notes, and the `PLAYRATE` line's reverse/pitch fields beyond the rate itself are not read yet (see `apps/desktop/internal/tracks/testdata/reaper/README.md`).
- The browser-only mock mode has no `/media` route. It plays a generated silent 10-minute WAV for every playable item instead, so the transport, skip, and time readout can be exercised and screenshotted; the desktop app is needed to hear real audio.

## Acceptance

- One `.rpp` is used without prompting; several prompt for a choice, and the choice persists per project.
- A missing or non-audio item flags its track without failing the page.
- The media route refuses any path that is not a source of the selected project's tracks (of any take of any item, not only the active take).
- Nothing is written to REAPER until the narrator presses the action's own button, and Prepare chapter render never starts a render.
- Covered by `apps/desktop/internal/tracks`, `chaptermatch` (with `sidecars/transcript-compare/tests/test_chapter_track_parity.py` on the Python side), `lineidentity`, `pickups`, `renderconfig`, `chaptertags`, `takereview` and `repeats`, and `apps/desktop/media_test.go` (Go); the bridge harness in `integrations/reaper/tests` for the Lua commands (`line_identity_test.lua`, `pickups_test.lua`, `render_test.lua`, `take_review_test.lua`); the tests beside each component in `apps/ui/src/components/tracks/` and `App.test.tsx` (UI); and the `tracks` states in the Playwright visual suite:
  - page and playback: default, unplayable-track-selected, rpp-picker, no-rpp, no-daw-link, playing, skipped-forward, last-track-selected;
  - chapter links: chapter-link-confirmed, chapter-link-missing;
  - Link chapters: link-chapters-preview, link-chapters-success, link-chapters-conflict, link-chapters-error;
  - Pickups: pickups-empty, pickups-imported, pickups-import-errors, pickups-next, pickups-error;
  - Prepare chapter render: render-config-prefilled, render-config-success, render-config-no-regions, render-config-error;
  - Embed chapter tags: chapter-tags-idle, chapter-tags-ready, chapter-tags-not-rendered, chapter-tags-success, chapter-tags-error;
  - Pickups & duplicates: take-review-results, take-review-empty, take-review-audition.

  The audio-failure message is covered by unit tests only, since the mock always serves playable audio.
