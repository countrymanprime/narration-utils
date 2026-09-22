# 0090. REAPER executable discovery, heartbeat mechanism and script-plus-project launch are resolved

**Status:** Accepted
**Date:** 2026-09-22

## Context

The project-workspace-and-daw-link PRD's Phase 6 spike existed to answer three Open Questions before Phases 7 and 8 (open-project
verification, launch DAW) could be scoped: W10 (can the app know REAPER is running and which project is open?), W11 (where is
`reaper.exe`?) and W12 (can REAPER auto-run a script when the app launches it?). `docs/research/reaper-spike-s6-daw-reachability.md`
records the method and evidence in full: two isolated REAPER 7.80 runs (`-cfgfile` under a temp folder, only a copy of
`Challenges_001.rpp`, owner decision D3), plus a registry read on this machine's real REAPER install. W12's citation
(`reaper-automation-surface.md:150`, "a project and a script can be passed together, unverified") is now verified.

## Decision

- **W11 (resolved).** `reaper.exe` is located via the Windows "Uninstall" registry key's `InstallLocation` value (both the native
  and `WOW6432Node` views), matching a `DisplayName` of exactly `REAPER` or `REAPER (<arch>)`; the `.rpp` file-association command
  (`Reaper.Project\shell\open64\command`) is the fallback when no Uninstall entry's location has a `reaper.exe` on disk. Both were
  confirmed against the real install (`REAPER (x64)`, `C:\Program Files\REAPER (x64)`). `apps/desktop/internal/daw` implements
  this (`LocateReaperExecutable`, Windows-only; `locate_other.go` reports "not found" elsewhere) and `Resolve(override, autoDetect)`
  lets a Settings override always win when it names a real file — auto-detect with a manual override, the owner's own
  recommendation. The Settings field, and the detached-launch action that calls this, are Phase 8's scope, not landed here.
- **W10 (resolved).** `EnumProjects(-1, '')` returns the active tab's path for a saved project and the exact empty string (never
  `nil`) for an unsaved one — the spike confirms the PRD's own evidence claim. A file-based heartbeat (one line, rewritten in
  place) is a viable mechanism with no new REAPER capability needed, but the recommended implementation for Phase 7 is an
  `events.log` event instead of a second polled file: `apps/desktop/internal/bridge/events.go`'s fan-out already delivers any
  event whose run-ID field is empty to every subscriber regardless of `Owns` (`Subscription.wants`), which is exactly the
  broadcast shape a "REAPER is running, here is the open project" heartbeat needs. This PR does not add the Lua defer loop, the
  wire-table row, or the `daw.Reachable()`/`daw.CurrentProject()` consumer — that is Phase 7's implementation, informed by this
  decision rather than left to guess at a mechanism.
- **W12 (resolved).** `reaper.exe -cfgfile <cfg> "<project.rpp>" "<script.lua>"` runs the script automatically at REAPER startup
  with the project already open (confirmed on REAPER 7.80, both with and without a project argument). This unblocks Phase 8's
  "auto-start the launcher when the app starts REAPER" flow. Per owner decision D10, that behavior ships behind a Settings toggle
  defaulting OFF, and only because this spike proved it works — this ADR records the technical proof, not a change to D10's own
  policy gate.

## Consequences

- Phases 7 and 8 can now be scoped from real evidence (a working registry lookup, a named event-fan-out mechanism, a confirmed CLI
  form) instead of "unverified"/"needs a spike," which is exactly what Phase 6's success signal ("a written decision") asked for.
- `apps/desktop/internal/daw` is new product surface landed ahead of the phase that will call it end-to-end (Phase 8); it is fully
  unit-tested (`locate_test.go`, pure parsing/selection functions plus a `Resolve` precedence test) and was also run once against
  the real Windows registry on the development machine to confirm the integration, but has no caller yet and no Settings field —
  it is inert until Phase 8 wires it in.
- The `events.log`-event recommendation for W10 is a design choice this ADR states in advance of Phase 7's own implementation; if
  Phase 7 finds a reason to prefer the polled-file heartbeat instead (for example, a case where an event cannot reach a subscriber
  that has not subscribed yet), that is a legitimate deviation to record in a new, superseding ADR rather than silently ignoring
  this one.
- Multi-tab REAPER sessions were not separately exercised beyond confirming `EnumProjects` enumerates exactly one tab in both spike
  runs (REAPER's own default); nothing observed suggests different behavior with more tabs open, but it was not directly tested.
