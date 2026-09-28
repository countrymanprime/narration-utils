# 0353. The resume prompt goes away when REAPER plays, and a bounded host poll follows the cursor only while it shows

**Status:** Proposed (REAPER's own behaviour is an owner check on #510, D65)
**Date:** 2026-09-27
**Supersedes:** none. It delivers the last phase of Read Aloud Resume from the DAW (PRD deleted, delivered; steady state in [the teleprompter architecture](../architecture/manuscript-teleprompter.md#resume-where-reaper-is-and-where-the-prompter-was)), Phase 5, on top of [ADR 0349](0349-the-resume-locate-reads-reapers-live-cursor-and-items-first-and-falls-back-to-the-saved-project-never-to-a-guess.md) (the live locate), [ADR 0305](0305-the-daw-heartbeat-carries-the-transport-and-is-sent-at-once-when-it-changes.md) (the transport on the heartbeat) and [ADR 0187](0187-the-resume-prompt-is-a-compact-notice-that-settles-once-per-dialog-open.md) (the prompt settles once per open).

## Context

The owner's report asked that the resume prompt "go away if we start playing". The PRD's RD7 (the recommendation D22 takes) makes REAPER playing or recording dismiss it when live state is available, and RD6 (b) re-runs the locate when the narrator moves REAPER's edit cursor onto the track while the dialog is idle, debounced, and never during a session. The PRD asked for a poll owned by the host, one per open dialog, cancelled on dismiss, and kept apart from the heartbeat.

Since the PRD was written, the heartbeat has gained the transport, pushed as `daw_transport_changed` the moment REAPER starts or stops (ADR 0305). That covers RD7 with no request and no Experimental command. It carries no edit cursor, though, so RD6 still needs `chapter_track_state`.

## Decision

1. **Dismissal (RD7) listens to two sources.** While the prompt shows, `ResumePrompt` settles as soon as `daw_transport_changed` reports playing or recording. It also settles on the host follow's `playing` or `recording` event, which covers a bridge script too old to put the transport on the heartbeat. Dismissal chooses nothing: Start reading keeps whatever it had, and listening never starts by itself (RD4).
2. **The follow is the host's, one at a time, bounded.** `TeleprompterResumeFollow(chapterId, trackGuid)` resolves the track as `TeleprompterLocate` does: the matched track, or a picked one the selected `.rpp` holds. It replaces any follow already running, then reads the Track state role (through the port) every second.
   - A tick while a teleprompter session runs asks REAPER nothing.
   - A read REAPER doesn't answer, or answers for another project, is skipped.
   - The follow ends on `TeleprompterResumeUnfollow`, a replacing follow, REAPER playing or recording, the app quitting (the app context), or after 30 minutes.
   - With no role (no DAW, REAPER not reachable, capability off) or no track, it answers `{following: false, reason}` and starts nothing.
3. **The cursor (RD6) is debounced by one read.** The first read sets a baseline. A cursor more than 0.01 s from it counts once two reads in a row agree, and it is reported (`cursor_moved` with `editCursor`) only when ADR 0349's rule puts it on the track's recorded audio. The prompt then re-runs the locate and may preset Start again. The locate costs a Whisper run, so it runs only when the cursor settled, never while it moves.
4. **The event is `teleprompter_resume_follow`** (`{chapterId, reason: playing | recording | cursor_moved, editCursor?}`), with a schema, goldens, a `wireContracts` row, and a mock that follows nothing (the demo still dismisses on the DAW mock's transport, `?mockDawPlayhead=`). The prompt ignores an event for another chapter. The two new bindings take `hostAPIVersion` to 72.
5. **The UI owns the lifetime.** `ResumePrompt` follows only while it is shown for an answered lookup with a track. It unfollows when it settles, when a session starts, when the lookup runs again, and on unmount.

## Consequences

- With track state on and REAPER reachable, an idle open prompt costs one `chapter_track_state` read a second (about 50 to 100 ms of REAPER's defer loop) and nothing once it goes away. With track state off (the default until the verification pass), only the heartbeat push dismisses it.
- The first read also reports REAPER already playing, so a dialog opened during playback loses its prompt at once, as the approved mockup `04-after-play-prompt-gone` shows.
- Reversing this means dropping the two bindings and the event (a `hostAPIVersion` bump). The heartbeat dismissal stands on its own.
