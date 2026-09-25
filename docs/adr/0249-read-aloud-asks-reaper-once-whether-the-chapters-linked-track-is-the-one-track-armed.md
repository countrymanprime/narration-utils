# 0249. Read Aloud asks REAPER once whether the chapter's linked track is the one track armed

**Status:** Accepted
**Date:** 2026-09-25

## Context

The Read Aloud control bar ([read-aloud-control-bar PRD](../prds/read-aloud-control-bar.prd.md) Phase 6) shows, beside its REAPER toggle, whether REAPER is ready to record this chapter. Phase 7 then records only under the rule the owner approved for Q7 (D28): record on the chapter's linked track, never another chapter's. The read-only `chapter_track_state` ([ADR 0231](0231-chapter-track-state-is-one-read-only-answer-of-the-transport-the-arms-the-input-device-and-one-tracks-items.md)) already answers the transport, whether a named track is armed and how many tracks are. It is experimental until the verification pass ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)). Nothing in the host called it yet. [ADR 0122](0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md) says a page asks REAPER only on an action and treats a refusal as an answer.

## Decision

- **One binding, `ReadAloudReaperState(chapterId)`** (host API 56, `apps/desktop/readaloudreaper.go`), answers `{status, reason?, message, trackGuid?, armedCount?, playing, recording}`. The UI calls it when the dialog opens, when the REAPER toggle is turned on, before Play and on Refresh, never on a timer.
- **The track is the chapter's one confirmed link**, from the narrator-confirmed track map ([ADR 0100](0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md)), not a name match. No link, or more than one, answers `no_link` (`unlinked`, `several_links`) without asking REAPER. A linked track REAPER no longer has (`TRACK_STALE`) answers `no_link`/`track_missing`.
- **The comparison, in order:**
  - REAPER already recording → `recording_elsewhere`.
  - Nothing armed → `not_armed`.
  - More than one armed → `several_armed`.
  - One armed and it is not the chapter's → `other_armed`.
  - Otherwise → `ready`.

  `ready` means exactly the state Phase 7 may record in. The other statuses name what the "Arm Chapter N only" action (D28) would change.
- **Availability comes first and is an answer.** The heartbeat is read before anything is sent: no bridge answers `unavailable`/`standalone`, a silent REAPER `not_running`. The experimental switch being off answers `unavailable`/`experimental_off`, a timeout `not_running`, and anything else `failed`, each with a message in the narrator's words. Only a chapter the manuscript does not have is an error.
- **Nothing is written to REAPER** and nothing is cached. The answer carries no item or path, only what the bar shows.

## Consequences

- The bar can say why recording is not ready ("2 tracks are armed in REAPER…") before the narrator presses Play, and Phase 7's guard reuses the same comparison.
- `chapter_track_state` answers counts, not the other armed tracks' names, so `other_armed` and `several_armed` cannot name them. Phase 7's arm command disarms them anyway.
- Until the verification pass switches the command on, the real app answers `experimental_off` (D24/D38). The mock answers every status (`?mockReaperState=`).
- The REAPER state in the bar is the UI half, built on this binding by the UI lane. What the fake cannot prove, REAPER's own `GetPlayState` and `I_RECARM` values, is the owner's scripted check (#510).
