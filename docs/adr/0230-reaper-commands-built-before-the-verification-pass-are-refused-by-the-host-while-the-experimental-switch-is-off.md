# 0230. REAPER commands built before the verification pass are refused by the host while the experimental switch is off

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** the owner

## Context and problem

Owner decision D38 ([implementation plan](../prds/implementation-plan.md), section 6) has the REAPER bridge commands of stack S28 built in full now and verified together later: each has harness tests and its ReaScript calls documented ([the calls](../research/reaper-api-for-planned-commands.md)), ships behind an "Experimental REAPER actions" Settings switch that is off, and is switched on only after the owner and Claude run [the verification pass](../operations/reaper-verification-pass.md) on a copy of a project. The harness ([ADR 0066](0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)) proves the Lua's logic against a fake; only a real REAPER shows what a call does, and some of these commands arm tracks, record, split items and add FX.

The switch has to live somewhere. The Lua cannot read the app's settings, and the narrator imports the Lua into REAPER themselves, so an older or newer script may be running.

## Decision drivers

- Owner decision D38: the S28 commands are built in full now, verified together later, and ship behind an "Experimental REAPER actions" Settings switch that is off.
- The harness proves the Lua's logic against a fake; only a real REAPER shows what a call does, and some commands arm tracks, record, split items and add FX.
- The Lua cannot read the app's settings.
- The narrator imports the Lua into REAPER themselves, so an older or newer script may be running.

## Considered options

1. One global Settings switch, enforced by the host in `bridge/actions.go`
2. Gate the commands in the Lua

## Decision outcome

**Chosen option: one global Settings switch, enforced by the host in `bridge/actions.go`**, because the Lua cannot read the app's settings, and an older or newer script may be running.

1. The switch is one global Settings row, `DAW.experimental_reaper_actions` ("Experimental REAPER actions", a bool), defaulting to `"false"` in `config/defaults.json` and in `internal/settings`'s built-in defaults.
2. The host enforces it, in one place: `apps/desktop/internal/bridge/actions.go`. `Actions` sends the S28 commands, and every command on its `experimentalCommands` list is refused with `ErrExperimentalOff` **before any command file is written** unless the `enabled` function the host passes to `NewActions` answers true. A nil `enabled` is off.
3. A command leaves `experimentalCommands` in the PR that records its verification pass. The PR that empties the list removes the switch and its default.
4. The Lua registers the commands unconditionally: a command the host never sends does nothing, and the registry test pins the full list.

### Consequences

- **Good:** One switch, read by the host on every request, gates every unverified command. No UI, binding or Lua change is needed to switch a verified command on: it is one line in `actions.go`.
- **Bad:** A forged command file (threat row 5a) is not stopped by the switch, since the Lua does not know it. That is the same boundary as every other command: the folder ACL, not the app, protects the command folder.
- **Neutral:** The Settings page shows the row as soon as the host offers it; its tooltip and any wording around it are lane C's (the Settings UI), and the mock gains the row with it.

### Confirmation

Point 4: the registry test pins the full list. Point 3: a command leaves `experimentalCommands` in the PR that records its verification pass.

## Pros and cons of the options

### Gate the commands in the Lua

- Bad, because the Lua cannot read the app's settings.
- Bad, because the narrator imports the Lua themselves, so an older or newer script may be running.
