# 0210. Chapter sync watches the saved .rpp and REAPER's edit counter, and sends REAPER nothing

**Status:** Accepted
**Date:** 2026-09-25

## Context

`docs/prds/daw-chapter-track-auto-sync.prd.md` asks that a track added in REAPER for the next chapter be linked and announced within seconds of the narrator saving, with no click (Phase 4). Until now nothing in the app watched anything: every reader parsed the saved `.rpp` when a page asked, and [Chapter Stage Recommendations](../prds/chapter-stage-recommendations.prd.md) Q5 chose "evaluate on read" because the app "cannot watch cheaply without REAPER". [ADR 0122](0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md) and threat model row 5f keep the app from sending REAPER a command without a click. S6 (answered by D39 with the PRD's recommendation) takes options A and B: poll the saved file's modification time, and add REAPER's edit counter to the heartbeat REAPER already sends unasked. Lane B's stream B1 added that counter (`PROJECT_STATUS`'s optional `changeCount`, `daw.Reachability.ChangeCount`). Option C, a read-only `list_tracks` command for unsaved tracks (Phase 5), is out under D39.

## Decision

- **The saved file is what a sync reads, and its modification time is what triggers one.** While the open project has chapter sync on (ADR 0209) and a `.rpp` to read (the same `selectedProjectFile` the sync reads), the host stats that file every 2 s (`chapterSyncWatchLoop`, `apps/desktop/chaptersync_watch.go`). It never reads the file to decide. When the modification time moves and then holds still for 1.5 s, the host runs one sync with trigger `watch`, through the same serialised `runChapterSync` as every other path. A further save within the 1.5 s restarts the wait, so a save written in steps is read once.
- **The first look is a baseline.** A different project folder or `.rpp` (a project switch, a different file chosen, sync turned on) starts again from what the file is now, and syncs nothing, because each of those paths already runs its own sync.
- **REAPER's edit counter only says "unsaved changes in REAPER".** When the heartbeat is live, names the watched file and carries a counter, a count that differs from the count at the last sync sets `unsavedEdits` on `chaptersync:state`. The sync that follows the next save clears it, and a lower count (REAPER reopened the project) is a new baseline. The counter never triggers a sync: without a command, the only tracks the host can see are the saved ones. The state is sent when `unsavedEdits` changes, and not otherwise.
- **The watcher sends REAPER nothing.** It reads a file's metadata and a heartbeat REAPER sends on its own, so row 5f and ADR 0122 hold unchanged.
- **The activity list is stored with the snapshot.** Each batch (a sync that linked something or found a new unmatched track) is written to `chapter-sync.json` beside the snapshot, in the same write, newest first, at most 20 entries. `chaptersync:state` carries it as `activity` for the Tracks page's Sync activity. It is derived data, cleared on a re-import with the snapshot.
- **The OS notification is the page's.** The host cannot tell whether the window has focus (`SystemNotify`'s rule), so the page raises a `watch` batch through `SystemNotify` when the window is not focused, under `General.notifications`.

## Consequences

- A new, conventionally named chapter track is linked and announced within about 4 s of a save (at most one 2 s poll plus the 1.5 s wait, then one parse), inside the PRD's 5 s target.
- A save that REAPER writes without the narrator (an autosave to the project file, if it does so) triggers a sync too. That is harmless: a sync only adds confident links and never removes one. Whether REAPER's autosave touches the `.rpp`, and whether a save itself moves the counter, are Phase 0's measurements. If a save does move the counter, the sync after it takes the new count as its baseline.
- A stat every 2 s runs only while sync is on and a `.rpp` is linked. A project that said Not now, or has no `.rpp`, costs one manifest read per tick.
- Unsaved tracks are still not seen until a save. That needs Phase 5's command, which D39 put out of scope.
