# 0253. Bridge commands carry the host's run id as trailing fields, and Lua logs them to bridge.jsonl at debug level

**Status:** Accepted
**Date:** 2026-09-26

## Context

[Tool Run Logging](../prds/tool-run-logging.prd.md) Phase 6 asks the REAPER bridge to carry the host's run id (`runlog.Run.ID()`, [ADR 0251](0251-tool-runs-are-logged-as-json-lines-through-slog-with-a-run-id-and-content-is-never-logged.md)) on its commands, so a "Copy diagnostics" bundle can show what the Lua bridge did for a run next to the host's `run.jsonl` and a sidecar's stderr, at debug level only, with the same content rule (ids, counts, tags and refusal reasons; never manuscript or transcript text).

The bridge's outbound wire (`bridge.Client.Send`, `apps/desktop/internal/bridge/bridge.go`) already carries a *different*, pre-existing run id: a per-request correlation id each command's own caller generates (`newRunID()` in `cleanuptools`, `retakelanes`, and others) to match an async answer to its request. Confusingly reusing that name for `runlog`'s id would conflate two different concepts. Lua's dispatch loop (`narration_ui_bridge.lua`) also parses a command line with `core.split(line, 8)` — a fixed field count matching today's widest command (six of its own fields) — so any change to the wire shape has to fit inside that budget or raise it for every command at once.

## Decision

- **Additive, per-command, not a global wire change.** Only the two commands with a `*runlog.Run` already in hand from phase 4 (`launch_cleanup_tool`, `pick_retake_lane`) send it, as two new *trailing* fields — `run.ID()` and `run.Level()` (both already exist, phase 2) — appended after the command's own existing fields. Lua's handlers read them as new trailing `args[N]`, so every existing argument index is unchanged and no other command's wire shape moves. `core.split(line, 8)`'s field budget is untouched: both commands stay at 4-5 total fields, well under its ceiling. Widening this to the rest of the bridge's ~20 commands is left to later phases, one command at a time, the same way.
- **`bridge.jsonl`, one line per command received and one per its outcome.** A new `core.debug_log(session_dir, run_id, level, event_name, fields)` helper (`narration_bridge_core.lua`, beside the existing `core.event`) writes one hand-built JSON line — Lua has no JSON library here — when `level == "debug"` and a run id is present; otherwise it is a no-op, so a normal (non-debug) session never creates the file. `fields` is an ordered list of `{key, value}` string pairs, not a Lua table, so records (and their tests) have a deterministic field order. Every value is a JSON string, including counts (`"lane":"1"`, not `"lane":1`): a hand-rolled encoder for this narrow, human/agent-readable diagnostic file does not need to reproduce `run.jsonl`'s typed JSON, only to be valid JSON and free of content.
- **A refusal logs its reason key, never the message shown to the narrator.** `launch_cleanup_tool.refused` and `pick_retake_lane.refused` records carry a fixed reason (`unknown_tool`, `no_selection`, `retake_not_found`, …), the same shape as the host's own decision records, not the free-text `ERROR` event string REAPER already sends over `events.log`.
- **Harness tests first** (ADR 0066): `cleanup_test.lua` and `retake_lanes_test.lua` each gained three cases — a received/outcome pair at debug level, no file at all when the host did not ask for debug, and a refusal's reason — before the Lua changes landed.

## Consequences

- The other ~18 registered bridge commands still write nothing to `bridge.jsonl`; a "Copy diagnostics" bundle only shows REAPER's side of a run for the two wired commands until a later phase widens it. That is an acceptable, visible gap for a Should-priority phase, not a silent one: each future command adopts the same `host_run`/`level` trailing-argument convention.
- `core.split(line, 8)`'s field budget is shared by every command; a future command that needs the two new trailing fields *and* is already near six of its own must raise the shared constant for everyone, which is safe (existing commands are unaffected by a higher ceiling) but is not done speculatively here.
- Threat-model row 5a is updated for the new file Lua writes and the new field on two commands.
