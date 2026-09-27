# 0380. Record in REAPER is a project-scope setting, and arming is a separate click from Play

**Status:** Accepted
**Date:** 2026-09-27

## Context

[Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) Phase 7 (Q7-Q9, D28) and [Booth Actions Enablement](../prds/booth-actions-enablement.prd.md) Phase 2 wire the read-aloud control bar's Record in REAPER toggle to the already-built `arm_only`, `record_start` and `record_stop` (`bridge.Actions`, `dawport.Recorder`). Two open questions needed one answer each before writing the caller:

- **Q9 (the toggle's memory):** "The per-project flag goes in the project's manifest or project-scope settings … the ADR picks one."
- **Q7 A (arming):** "the arm change is a visible, clicked action (REAPER's arm is not in its undo history, so an unasked change could not be undone)" - so Play cannot silently arm a track on the narrator's behalf.

## Decision

- **`ReadAloud.record_in_reaper` and `ReadAloud.record_confirmed`** are two fields of the existing three-layer settings store (`internal/settings`), saved and read at **project scope only** (`saveSettings` refuses any other scope, the way `Teleprompter` and `Keymap` already refuse project or global respectively). This reuses `SystemSaveSettings`/`SystemSettingsForScope`, already wired end to end with their own wire contract, instead of a new manifest field or a new pair of bindings: no host change beyond one `fieldSchemas` row. Like `Keymap.overrides`, no Settings category names `ReadAloud`, so it stays off the generic Settings page (the read-aloud control bar's own toggle is where a narrator sets it); a project that never turned it on reads back off and unconfirmed, matching Q9's recommended default.
- **Arming is never implicit in Play.** `ReadAloudArmOnly(chapterId)` is sent only from the bar's own "Arm `<chapter>` only" button (shown while the toggle is on and the chapter's track is not the one armed), never from `ReadAloudRecordStart`. `RecordStart` still refuses with the same named reasons (`not_armed`, `other_armed`, `several_armed`) when the track was never armed - Play does not retry the arm on the narrator's behalf, it just says why nothing started.
- **`ReadAloudRecordStart`/`ReadAloudRecordStop`/`ReadAloudArmOnly`** (`apps/desktop/bindings_readaloud_record.go`, host API 64) are the only callers of `dawport.Recorder`, resolved through `dawport.Role[dawport.Recorder]` the same way `ReadAloudReaperState` resolves `TrackStateReader` - never a concrete `bridge.Actions` method, so promoting the `record` capability later is the one-line declaration change [Booth Actions Enablement](../prds/booth-actions-enablement.prd.md) describes.
- **Play with the toggle on** calls `ReadAloudRecordStart` (a 3 s deadline) before `TeleprompterStart`; a refusal or timeout starts nothing and shows why in the bar's status line. **Stop** always stops listening first, then calls `ReadAloudRecordStop` only when this app's own `beforeStart` actually started a recording this session (`useRecordInReaper.ts`), so a toggle left on from an earlier, REAPER-idle session never sends a stop REAPER would refuse anyway. The host also stops a recording it started when the app quits (`ServiceShutdown`), so REAPER is never left recording with nothing open to stop it.

## Consequences

- A narrator's "Record in REAPER" choice and whether they have seen the confirm travel with the project file's settings, the way every other project-scope preference does; opening the project on another machine keeps the choice, matching a manifest field's persistence without adding one.
- REAPER's arm state (not in its own undo history) only ever changes from a narrator's click on "Arm only", never as a side effect of turning the toggle on or pressing Play.
- A REAPER stopped or disconnected mid-session (the narrator's own Stop button in REAPER, a crash) is not pushed to the UI as a live event: `bridge.Actions.OnRecordEnded` clears the host's own bookkeeping (so shutdown never double-stops), but the bar's REAPER state only catches up on its next ask (open, toggle, Play, Refresh - ADR 0122 unchanged). A narrator mid-session sees no visible change until then; a follow-up may add a push event if this proves confusing in practice.
- `record` stays Experimental (off by default) until [Booth Actions Enablement](../prds/booth-actions-enablement.prd.md)'s Phases 6-7 verification pass promotes it; this phase changes no default behaviour for a narrator who has not turned the setting on.
