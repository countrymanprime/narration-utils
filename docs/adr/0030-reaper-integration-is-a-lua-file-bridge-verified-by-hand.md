# 0030. REAPER integration stays a Lua file bridge, and Lua changes are verified by hand

**Status:** Proposed
**Date:** 2026-09-19

## Context

Everything the app needs from a running REAPER (selection, edit cursor, take markers, item extension data, regions) goes through one Lua ReaScript, `shared/reaper/narration_ui_bridge.lua`, started by `NarrationUtils_Launcher.lua`. The Go host talks to it over files. The [REAPER automation research](../research/reaper-automation-surface.md) (sections 4 and 10) recommends replacing that with REAPER's web interface plus OSC, and lists a native extension for true push events as a later option. Its comparison table rates our file bridge "Fragile; replace" (section 4.1), and it notes that web or OSC would add a network dependency and a required user setting in REAPER. [daw-integration.md](../architecture/daw-integration.md) says the app has "no loopback server, REST endpoint, browser tab, or port override", and [ADR 0012](0012-media-route-for-track-playback.md) and [ADR 0022](0022-live-sidecar-events-over-wails-and-stop-file.md) rely on that rule. The user's recorded call (see the [REAPER automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md), decisions log) was manual checklist for now, with a stub-`reaper` harness as a later item.

## Decision

1. REAPER integration is a Lua ReaScript bridge over a file protocol, and the app opens no loopback server, REST endpoint, browser tab, port, or OSC socket to talk to REAPER, and ships no native REAPER extension. The Go side is `shell/internal/bridge/bridge.go`: `Send` writes `commands/NNNNNNNN.cmd` atomically (temp file, then rename) as percent-encoded, `|`-separated fields led by `ProtocolVersion` (1), and `ReadEvents` reads `events.log`. The Lua side polls the commands folder from a `reaper.defer` loop (`narration_ui_bridge.lua:511-560`), removes each command as it reads it, and dispatches through one `if/elseif` chain.
2. Lua owns only state a running REAPER alone knows: selection, the edit cursor, take markers, item extension data, regions and undo. Anything derivable from the saved project file stays in Go, as the Tracks page does by parsing the `.rpp`.
3. Changes to `shared/reaper` are verified by hand in REAPER, against a manual checklist kept with the feature (the current one is in [manuscript-line-identity.md](../architecture/manuscript-line-identity.md)). `CLAUDE.md` treats every Lua consumer as zero-coverage and requires manual verification when `shared/reaper` changes. A stub-`reaper` Lua harness in CI is a later item, not part of this decision.
4. Moving to REAPER's web or OSC interfaces, or to a native extension, would need a new ADR that supersedes this one. The research says the web and OSC route needs its own ADR because it changes the "no loopback" wording: the app would become a client of REAPER's own interfaces.

## Consequences

- No port to secure or firewall, no REAPER preference for the narrator to enable, and nothing to install beyond importing the launcher script. A REAPER launch needs only the script.
- Latency is bound by the `defer` cycle. Commands go one way as files and results come back through an append-only event log that Go re-reads. Research found comparable file bridges cost about 50 to 100 ms per call (a secondary source, unmeasured here). Live transport state, such as play position for the teleprompter, cannot be pushed to Go this way.
- Nothing automated proves Lua behavior. `stylua --check shared/reaper` (`scripts/quality.mjs:172`) only checks formatting and syntax. The line-identity checklist has not been run by anyone yet, so those three commands are unverified in a real REAPER.
- Every new command lands in the one dispatcher, so parallel work on several features (review dashboard, take review, diagnostics, teleprompter integration) collides there. The REAPER automation follow-through PRD proposes a stub-`reaper` harness and a command registry to ease that (its Open Question 1); this ADR does not decide it, and adopting a harness does not change point 1.
- Host reads are single-consumer: `ReadEvents` keeps one offset, so two independent readers would steal each other's events. That is a limit of the current protocol, not of the decision.
