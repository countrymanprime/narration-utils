# 0031. REAPER integration stays a Lua file bridge, and Lua changes are verified by hand

- **Status:** Accepted
- **Date:** 2026-09-19
- **Related:** Point 3, and the sentence about the harness in its Consequences, are superseded by [ADR-0066](0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md). Point 1's dispatch through one `if/elseif` chain, and the Consequences sentence about every new command landing in the one dispatcher, are superseded by [ADR-0067](0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md)'s command registry.

## Context and problem

Everything the app needs from a running REAPER (selection, edit cursor, take markers, item extension data, regions) goes through one Lua ReaScript, `integrations/reaper/narration_ui_bridge.lua`, started by `NarrationUtils_Launcher.lua`. The Go host talks to it over files. The [REAPER automation research](../research/reaper-automation-surface.md) (sections 4 and 10) recommends replacing that with REAPER's web interface plus OSC, and lists a native extension for true push events as a later option. Its comparison table rates our file bridge "Fragile; replace" (section 4.1), and it notes that web or OSC would add a network dependency and a required user setting in REAPER. [daw-integration.md](../architecture/daw-integration.md) says the app has "no loopback server, REST endpoint, browser tab, or port override", and [ADR 0012](0012-media-route-for-track-playback.md) and [ADR 0022](0022-live-sidecar-events-over-wails-and-stop-file.md) rely on that rule. The user's recorded call (see the [REAPER automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md), decisions log) was manual checklist for now, with a stub-`reaper` harness as a later item.

## Decision drivers

- The app's "no loopback server, REST endpoint, browser tab, or port override" rule, which ADR 0012 and ADR 0022 rely on.
- Web or OSC would add a network dependency and a required user setting in REAPER.
- The user's recorded call: a manual checklist for now, with a stub-`reaper` harness as a later item.

## Considered options

1. A Lua ReaScript bridge over a file protocol
2. REAPER's web interface plus OSC (recommended by the REAPER automation research)
3. A native REAPER extension for true push events (listed by the research as a later option)

## Decision outcome

**Chosen option: a Lua ReaScript bridge over a file protocol**, because the web/OSC route would add a network dependency and a required REAPER setting and break the "no loopback" rule that ADR 0012 and ADR 0022 rely on.

1. REAPER integration is a Lua ReaScript bridge over a file protocol, and the app opens no loopback server, REST endpoint, browser tab, port, or OSC socket to talk to REAPER, and ships no native REAPER extension. The Go side is `apps/desktop/internal/bridge/bridge.go`: `Send` writes `commands/NNNNNNNN.cmd` atomically (temp file, then rename) as percent-encoded, `|`-separated fields led by `ProtocolVersion` (1), and `ReadEvents` reads `events.log`. The Lua side polls the commands folder from a `reaper.defer` loop (`narration_ui_bridge.lua`), removes each command as it reads it, and dispatches through one `if/elseif` chain.
2. Lua owns only state a running REAPER alone knows: selection, the edit cursor, take markers, item extension data, regions and undo. Anything derivable from the saved project file stays in Go, as the Tracks page does by parsing the `.rpp`.
3. Changes to `integrations/reaper` are verified by hand in REAPER, against a manual checklist kept with the feature (the current one is in [manuscript-line-identity.md](../architecture/manuscript-line-identity.md)). `CLAUDE.md` treats every Lua consumer as zero-coverage and requires manual verification when `integrations/reaper` changes. A stub-`reaper` Lua harness in CI is a later item, not part of this decision.
4. Moving to REAPER's web or OSC interfaces, or to a native extension, would need a new ADR that supersedes this one. The research says the web and OSC route needs its own ADR because it changes the "no loopback" wording: the app would become a client of REAPER's own interfaces.

### Consequences

- **Good:** No port to secure or firewall, no REAPER preference for the narrator to enable, and nothing to install beyond importing the launcher script. A REAPER launch needs only the script.
- **Bad:** Latency is bound by the `defer` cycle. Commands go one way as files and results come back through an append-only event log that Go re-reads. Research found comparable file bridges cost about 50 to 100 ms per call (a secondary source, unmeasured here). Live transport state, such as play position for the teleprompter, cannot be pushed to Go this way.
- **Bad:** Nothing automated proves Lua behavior. `stylua --check integrations/reaper` (`scripts/quality.mjs`) only checks formatting and syntax. The line-identity checklist has not been run by anyone yet, so those three commands are unverified in a real REAPER.
- **Bad:** Every new command lands in the one dispatcher, so parallel work on several features (review dashboard, take review, diagnostics, teleprompter integration) collides there. The REAPER automation follow-through PRD proposes a stub-`reaper` harness and a command registry to ease that (its Open Question 1); this ADR does not decide it, and adopting a harness does not change point 1.
- **Neutral:** Host reads are single-consumer: `ReadEvents` keeps one offset, so two independent readers would steal each other's events. That is a limit of the current protocol, not of the decision.

### Confirmation

Point 3: changes to `integrations/reaper` are verified by hand in REAPER against the manual checklist kept with the feature.

## Pros and cons of the options

### REAPER's web interface plus OSC

- Bad, because it would add a network dependency and a required user setting in REAPER.
- Bad, because it changes the "no loopback" wording: the app would become a client of REAPER's own interfaces.

### A native REAPER extension

- Good, because it allows true push events.
