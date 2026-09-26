# 0251. Tool runs are logged as JSON lines through `slog` with a run id, and content is never logged

**Status:** Accepted
**Date:** 2026-09-26
**Supersedes:**

## Context

`docs/prds/tool-run-logging.prd.md` (owner decisions of 2026-09-23) found that a tool run leaves almost no trace on
disk. `hostlog.Log` (ADR 0069) records only failures — 16 call sites, no level, no run id — and its package comment
says outright that it records "where data went wrong and never what the data was". Nothing else in the Go host uses a
leveled logger. The batch sidecars' stderr is thrown away (`process.Supervisor.Start` copies both pipes to
`io.Discard`); the two sidecars that mirror a log to a file (`narration_common.logging_utils.log`) write unleveled,
sparse text. No id ties a host job, a sidecar's log file and the bridge commands it sends together, so a run that
finishes with a wrong or surprising result cannot be reconstructed, and an agent handed "it looked wrong" has nothing
to read.

The owner answered the PRD's five open questions on 2026-09-23: debug detail is switched on by **both** a global
Settings toggle and `NARRATION_DEBUG=1` (Q1); content is **never** logged, at any level (Q2); the run log is capped at
**5 MiB plus two backups** (Q3, larger than `host.log`'s 1 MiB plus one backup, since debug runs write far more);
`host.log` folds into the run log in **phase 7**, once the new file has shipped once (Q4); "Copy diagnostics" saves a
`.jsonl` file and copies its path (Q5, phase 7). This ADR covers phase 1 only: the run log itself, its levels and
rotation, run ids, `Begin`/`End`, and the debug switch.

## Decision

1. **A new package, `apps/desktop/internal/runlog`,** writes JSON lines through Go's `log/slog` (standard library, no
   new dependency) to `%APPDATA%\narration-utils\logs\run.jsonl`, next to `host.log`. Rotation follows `hostlog`'s
   shape (`rotateLocked`, checked before each write) but keeps **two** backups (`run.jsonl.1`, `run.jsonl.2`) at a
   5 MiB cap (Q3), not `hostlog`'s one.
2. **Every record carries `ts`, `level`, `run`, `tool`, `event` and `msg`,** plus attributes. `ts` and `level` replace
   `slog`'s own `time` and `level` keys (`ReplaceAttr`) so the clock is a test seam and the level reads lower case
   (`"debug"`, `"info"`, ...) rather than `slog`'s default upper case.
3. **`Logger.Begin(tool, attrs...) *Run` writes `run.start`; `Run.End(outcome, attrs...)` writes `run.end`** with a
   duration. `Run.Decision(event, msg, attrs...)` writes a debug-level record for phases 4 to 6's decision points. A
   nil `*Logger` returns a nil `*Run`, and every `*Run` method is a no-op on nil — the same pattern as `hostlog.Log`,
   so tests and a failed setup need no checks, and phase 3's guard test can tell a launch path that never called
   `Begin` from one that did by whether records ever land.
4. **The level is a `slog.LevelVar`,** shared by every run through one handler, so `Logger.SetDebug(bool)` takes
   effect immediately for a run already in progress — no restart, no rebuilt logger.
5. **The debug switch is both a global setting and an environment variable (Q1).** `General.debug_logging` (`bool`,
   `apps/desktop/app.go`'s `fieldSchemas`, global scope only — `saveSettings` refuses it at project scope, since it is
   a switch for this machine) calls `SetDebug` on save. `NARRATION_DEBUG=1`, read once at `runlog.New`, forces debug
   on and makes `SetDebug` a no-op in either direction from then on: a scripted or agent run must not be silently
   defeated by a stale setting.
6. **Content is never logged, at any level (Q2).** Record helpers take ids, counts, booleans, durations, hashes and
   paths — never manuscript or transcript text. Phase 1 states the rule and follows it in every call this phase adds
   (`Begin`/`End`'s own attributes); the guard test that scans call sites and the sentinel test that runs a tool on a
   fixture with sentinel words are phase 4's and phase 5's job, once there are decision records to scan.

## Consequences

- `host.log` is unchanged until phase 7: two files exist side by side for the length of this PRD, as the Decisions Log
  accepted ("One place to look; waits until the new file has shipped once").
- Every host job and sidecar launch still writes nothing today — phase 3 wraps them in `Begin`/`End` with a guard test
  that fails a new launch path that skips it. Phase 2 gives sidecars stderr kept per run and a leveled `log()` in
  `narration_common`; phases 4 to 6 add the decision records this phase's `Run.Decision` exists to carry.
- A run's records answer "what tool, what id, when it started, when it ended, how" from phase 1 alone; "what it
  decided" waits on later phases.
- To change the logging library, the record shape or the content rule, write a new ADR that supersedes this one.
