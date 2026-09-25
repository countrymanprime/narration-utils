# 0211. A changed chapter is re-checked in the background only on mains power, with REAPER quiet and not recording

**Status:** Accepted (supersedes part of ADR-0130)
**Date:** 2026-09-25

## Context

[ADR 0130](0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md) and Q14 of [the recording check](../utilities/recording-coverage.md) say a recording check runs only when the narrator presses **Check recording**. `docs/prds/daw-chapter-track-auto-sync.prd.md` asks for the opposite once a chapter's recording has changed: "stale chapters become measured without a press" (Phase 7). The owner's D27 answers S7: background checks run "only while REAPER is idle and not recording, and never on battery". Phase 6 already gives every chapter its check's freshness and when its track last changed ([ADR 0210](0210-chapter-sync-watches-the-saved-rpp-and-reapers-edit-counter-and-sends-reaper-nothing.md) for the watcher). A check costs about 10 s of CPU per audio minute, so a pickup costs seconds (the cache) and a new chapter costs minutes.

## Decision

- **The host may start a recording check on its own**, through the same `coverage.Service.Start` as a press. Progress, the ledger record, the stored result and `job:ended` are therefore the same (ADR 0015, ADR 0076). The run's state says `background: true`, so the UI can label it.
- **The rule is one pure function**, `coverage.NextBackground`. Every 30 s the host (`backgroundCheckTick`, `apps/desktop/coverage_background.go`) asks it, and nothing starts unless every condition holds, in this order:
  - `RecordingCoverage.background_checks` is on. It is a new setting, on by default (S7 B).
  - No job the narrator started is running (the host's own `idle`, which includes a check).
  - The Whisper model is installed. A background check never downloads one.
  - The computer is on **mains power**. On Windows this is read from `GetSystemPowerStatus`: a desktop with no system battery counts as mains. A power state the app cannot read counts as battery, so off Windows no background check runs yet.
  - **REAPER is closed, or known not to be recording.** The heartbeat does not say whether REAPER is recording yet, so a running REAPER counts as "may be recording", and background checks wait until it closes. A play-state bit on `PROJECT_STATUS` (lane B's, the same optional-field pattern as `changeCount`) will let them run while REAPER sits idle.
  - **Quiet for 3 minutes:** neither the saved `.rpp` nor REAPER's edit counter changed in that time (ADR 0210's watcher), and neither did the chapter itself.
- **Which chapter:** a linked chapter whose check is `stale` goes first, then one never checked whose track a sync saw change (a new recording). Within each group, the change that is oldest goes first, one at a time. A never-checked chapter whose track has not changed since the first sync is never checked on its own, so a whole book is never transcribed from scratch unasked.
- **The narrator comes first.** Pressing **Check recording** while a background check runs cancels it (the items it finished stay cached) and starts the narrator's own. A chapter the host has tried at its current change is not tried again until it changes, so a narrator's **Cancel** sticks, and a failing chapter is not retried in a loop.
- **The UI is told why nothing runs.** `chaptersync:state` carries `background {enabled, wait}`, where `wait` is `off`, `busy`, `model`, `battery`, `recording`, `quiet` or `nothing`.

## Consequences

- A chapter re-recorded or trimmed and saved becomes "Measured" on its own, once the narrator has closed REAPER (or, after lane B's bit, left it idle) for three minutes on mains power.
- Until the play-state bit exists, background checks run only with REAPER closed. That is conservative by design: D27 forbids CPU work while recording, and the host cannot yet tell recording from idle.
- The recording-coverage sidecar can now be started without a click. Its arguments are the same host-built ones as a press (threat model row 4e), so nothing new crosses the boundary.
- Q14's "the Home table never starts one" still holds for the table itself: the host starts the check, and reading any status never starts one.
