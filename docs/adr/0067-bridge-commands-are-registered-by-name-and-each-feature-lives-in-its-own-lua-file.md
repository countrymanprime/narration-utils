# 0067. Bridge commands are registered by name, and each feature lives in its own Lua file

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

`narration_ui_bridge.lua` held every bridge command, dispatched by one `if/elseif` chain, in a single 563-line file. Four planned PRDs (the REAPER automation follow-through, the teleprompter integration, take review and diagnostics) each add commands there, so they would collide in one dispatcher and one file. The owner decided (implementation plan, D2, 2026-09-20) to do a behaviour-preserving registry before any new Lua command, with the harness of [ADR 0066](0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md) written first so the refactor had something to prove it against.

## Decision drivers

- Four planned PRDs (the REAPER automation follow-through, the teleprompter integration, take review and diagnostics) each add commands, and would collide in one dispatcher and one file.
- The owner's decision D2 (2026-09-20): a behaviour-preserving registry before any new Lua command, with the ADR-0066 harness written first so the refactor has something to prove it against.

## Considered options

1. Commands registered by name, with each feature in its own Lua file
2. Keep the status quo: one `if/elseif` chain in a single 563-line `narration_ui_bridge.lua`

## Decision outcome

**Chosen option: commands registered by name, with each feature in its own Lua file**, because four planned PRDs each add commands and would otherwise collide in one dispatcher and one file.

1. **A command is a handler `function(ctx, args)` registered under its name** in a registry (`new_registry()` in `narration_bridge_core.lua`). `ctx` carries `session_dir`, `event(tag, ...)` and `stop()`; `args` are the command's fields after its name. A name can be registered once, so two features cannot shadow each other. The loop in `narration_ui_bridge.lua` reads each `.cmd` file, answers `ERROR|Unsupported hub protocol` or `ERROR|Unsupported workspace command` exactly as before, and calls the handler. `close` is registered in the same way.
2. **Each feature is one file that returns `function(registry)`,** `narration_compare.lua` and `narration_line_identity.lua` today, and receives the shared helpers as the chunk argument. The bridge lists them in `FEATURE_FILES` and `loadfile`s them when it loads, so a missing or broken file fails the launcher's `dofile` (its "Could not load Narration Utils shared libraries" message) before the app starts. The bridge finds its own folder from `debug.getinfo` and falls back to the running action's path; loading the registered bridge was checked in a scripted REAPER 7.80 run, from the repository and from a folder whose path has spaces and a non-ASCII character. The launcher's message now includes the load error, so a missing feature file is named.
3. **The list is enforced.** `scripts/release/reaper-files.mjs` is the list of Lua files the installer check requires; `reaper-files.test.mjs` fails when it and the folder disagree, and a registry test fails when a Lua file exists that is neither shared infrastructure nor loaded by the bridge, or when the set of registered command names changes without the test being updated.
4. **The launcher's path and name, the file protocol and every command's behaviour are unchanged** (the launcher only gained the load error in its message). All 76 characterization tests written before the split pass unchanged on the new layout.

### Consequences

- **Good:** A new command is a new file plus one line in `FEATURE_FILES` and one in `reaper-files.mjs`, and harness tests; PRDs that add commands no longer edit one chain.
- **Neutral:** The bridge loads three more files, so a packaging mistake is possible in a new way; the installer check and its test cover it.
- **Neutral:** The protocol did not change. Attaching a run ID to `ERROR` events is a separate change (the event fan-out) that sits on top of this.
- **Neutral:** To go back to a single file, or to discover feature files by scanning the folder, write a new ADR that supersedes this one.

### Confirmation

`reaper-files.test.mjs` fails when `scripts/release/reaper-files.mjs` and the folder disagree; a registry test fails when a Lua file is neither shared infrastructure nor loaded by the bridge, or when the set of registered command names changes without the test being updated. The 76 characterization tests of the ADR-0066 harness pinned the behaviour across the split.
