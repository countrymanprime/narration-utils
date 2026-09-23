# 0144. A launch names its DAW with `--daw`, and an Audacity launch opens no REAPER bridge

**Status:** Proposed
**Date:** 2026-09-23

## Context

The [Audacity integration PRD](../prds/audacity-integration.prd.md) Phase 5 asks the app to accept `--daw Audacity`, the way `NarrationUtils_Launcher.lua` starts it with `--daw REAPER`, and to prove the layered settings store serves an Audacity project with no new code. Until then `--daw` was a free-form label: the host kept whatever string it was given and showed it in the UI. Two places read it: `dawLinkFacts` (`daw == "REAPER"` counts as linked, W18) and `Startup`, which explained a missing project folder with REAPER-specific text for any non-empty label.

The Audacity pipe client (Phase 4) waits on the owner's `mod-script-pipe` spike S-A1, so an Audacity launch has nothing to review through yet. Without a decision the review workflow would either take the standalone path (no adapter, "the REAPER bridge is unavailable") or, when a `--session-dir` came along, write REAPER bridge commands that no REAPER will read. Command-line arguments are a trust boundary ([threat model](../architecture/threat-model.md), section 6).

## Decision

- `--daw` stays a free-form label for display, and `dawadapter.Classify` is the only thing the host branches on: `REAPER` or `Audacity`, ignoring case and surrounding spaces; any other label (`Standalone`, empty, unknown) is `KindNone` and selects no behaviour.
- An Audacity launch never opens the REAPER file bridge, even when a session directory is passed, so none of the REAPER-only services (pickups, line identity, project state, render config, take creation, reachability) reach a REAPER session from it.
- The review workflow gets its adapter from `dawadapter.ReviewForDAW(label, client)`. On an Audacity launch that is an adapter that refuses every request with `dawadapter.ErrAudacityNotAvailable`, a sentence the run shows as its message ("Audacity support is not available yet. …"). Phase 4 replaces that adapter with the pipe client in the same function; nothing else in the host changes.
- Only a REAPER launch with no project folder gets the "this REAPER project…" startup reason; any other lands on the picker silently.
- The settings store gets no Audacity code. Its one REAPER-worded message (a project save with no project open) now names no DAW.

## Consequences

- `--daw Audacity` reaches `Bootstrap` as the `daw` label and the Settings page shows it; the rest of the DAW Settings copy (reachability, "Launch REAPER") is still REAPER-shaped until the dashboard phase (PRD Phase 9).
- A mistyped `--daw` cannot switch anything on: it behaves as a standalone launch with an odd label. A lower-case `--daw reaper` now counts as REAPER for the startup reason; `dawLinkFacts` still compares the exact `REAPER` label the launcher passes, unchanged here.
- The Audacity macro launcher (Phase 10) passes `--daw Audacity` and a project folder and gets this behaviour with no host change.
- Audacity stays out of the DAW catalog (`dawcatalog.Catalog`): it has no working adapter to advertise yet.
