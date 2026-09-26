# 0212. The resume locate prefers REAPER's live edit cursor over the saved project, and labels which one answered

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Read Aloud Resume from the DAW](../prds/read-aloud-resume-from-daw.prd.md) Phase 4 (RD2) asks the resume locate to
prefer REAPER's live state - the edit cursor on the chapter's linked track, or that track's live end when the cursor
sits elsewhere - over the saved `.rpp`'s own recorded end (Phases 1-3, ADR 0111), whenever that live state can be
trusted. `chapter_track_state` (ADR 0231, `apps/desktop/internal/bridge/track_state.go`) already answers a track's
live transport, arms and items, built by Read Aloud Control Bar Phase 6 (ADR 0249) and Teleprompter Manuscript
Integration Phase 11's shared command; nothing further was needed from the bridge or the Lua harness.

A live `TRACK_ITEM` (ADR 0231) carries no section or stretch-marker facts, and the bridge does not report a source
file's kind, so a live answer cannot reproduce every nuance of `tracks.Track.RecordedEnd` (`internal/tracks/recorded.go`)
over the saved project.

## Decision

1. `recordedEndFor` (`apps/desktop/teleprompterlivedaw.go`) tries a live answer first, through the same
   `trackStateReader` interface and `reaperConnected` trust level `readaloudreaper.go` (Phase 6) already established,
   and falls back to the saved project's own `chaptermatch.RecordedEnd` on anything else: no reader, REAPER not
   connected, an experimental switch left off, a stale or unknown track, or a track with no live items. None of these
   is an error; the saved project is always a usable answer.
2. A track a chapter shares with others through a region (`candidate.Region != nil`) always reads the saved project.
   A live answer carries no region bounds, so it cannot tell which part of a shared track belongs to this chapter.
3. The live position (RD2): the edit cursor, when it lies within a played item on the track; otherwise the live end of
   the track's last item (by `Position + Length`). Project time maps into the item's source at `SourceOffset + (cursor
   - Position) * PlayRate`, mirroring `tracks.Track.RecordedEnd`'s own arithmetic without the fields a live answer
   cannot supply: `Approximate` is always false, and `Supported` is optimistic (true whenever the item names a
   source file), since the bridge does not report a live item's source kind. An unplayable file still fails, in the
   sidecar's own refusal, the same class of error a corrupt saved-project source already raises.
4. While REAPER reports the track recording, the locate answers a new status, `recording_live`: the file underneath
   is still growing, so nothing is located and the saved project is not consulted either (REAPER is plainly reachable
   and simply mid-take).
5. `TeleprompterLocate`'s result gains `live: boolean` (`hostAPIVersion` 58), true only when a live answer was used.
   `withResumeVerdict` labels the reconciled verdict's DAW place accordingly: `teleprompter.DAWSourceLive` ("in REAPER
   now") instead of `teleprompter.DAWSourceSaved` ("as of the project's last save"); `teleprompter.Reconcile` itself
   never makes this choice, so ADR 0206 stands unchanged.

## Consequences

- No Lua or bridge change: Phase 4's read-only command was already built and harness-tested by the sibling streams
  named above; this ADR only wires the host's resume locate to call it.
- A narrator with the experimental switch off, or without REAPER connected, sees exactly today's behaviour: the
  saved project, unchanged, with `live: false`.
- Binding-level tests of the "REAPER connected and live" branch are not included: `hostServices.actions` is a
  concrete `*bridge.Actions`, not an interface, so exercising it end to end needs a real or file-protocol-fake bridge
  client, which `readaloudreaper.go`'s own `ReadAloudReaperState` binding also leaves untested at that level (only its
  pure `_In` helper is). `recordedEndFor` and its helpers are instead unit-tested directly with a `trackStateReader`
  fake, at the same boundary.
- Proposed, for the owner: whether an item's mute state should exclude it from the live end search once the bridge
  reports mutes (ADR 0231 does not carry one today); until then a live end search treats every item as audible, unlike
  the saved-project path, which already skips muted items.
