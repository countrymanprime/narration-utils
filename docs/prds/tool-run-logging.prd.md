# Tool Run Logging

**Source:** New work; nothing is superseded. It extends the host log of [ADR 0069](../adr/0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md) (`apps/desktop/internal/hostlog`) and stays inside the no-upload rule of [ADR 0032](../adr/0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md) and the threat model's row 7a and "no telemetry" rule. Not to be confused with [Diagnostics, Delivery Reports and Cleanup Tools](diagnostics-delivery-and-cleanup-tools.prd.md), which is about *audio* diagnostics.

Citations are `file:line` on `main` at dd006030 for anything checked in code; "TBD - needs <what>" marks an unknown.

## Problem Statement

When a tool runs (a transcript compare, a recording check, a take review scan, a Story Bible build, a teleprompter session, a REAPER bridge command), nothing on disk says what it did. The host records only a handful of failures, the long batch sidecars' stderr is thrown away, and most Go tools write nothing at all. A run that finishes with a wrong or surprising result leaves no trace of its inputs, its settings, the decisions it took, or how long each step lasted. That makes it slow for the owner to tell whether a tool is doing what it is meant to, and impossible to hand an agent (Claude) the evidence of a run so it can confirm or diagnose the behavior instead of guessing.

## Evidence

Verified in code (main at dd006030):

- **The host has one log, and it records failures only.** `hostlog.Log.Report(kind, message)` appends one line to `%APPDATA%\narration-utils\logs\host.log`, capped at 1 MiB plus one backup (`apps/desktop/internal/hostlog/hostlog.go:17-20,42-51`). Its package comment says it records "where data went wrong and never what the data was". There are 16 call sites outside tests, all for failures or fallbacks: install, update check/download/install, notifications, asset cache, UI `wire_invalid` reports (`apps/desktop/bindings.go:47-53`), teleprompter and manuscript hooks (`apps/desktop/app.go:293,339,395,1321`). There is no level, no run id and no success record.
- **No leveled logger anywhere in the Go host.** No `log/slog`, `zap` or `zerolog` import in `apps/desktop`; `main.go:54` uses `log.Fatal` once. The packages that make decisions (`measure`, `cleanuptools`, `pickups`, `takereview`, `takecompare`, `retakelanes`, `stages`, `repeats`, `coverage`, `lineidentity`, `renderconfig`, `chaptermatch`, ...) log nothing.
- **Batch sidecars' stderr is discarded.** `Supervisor.Start` copies both pipes to `io.Discard` (`apps/desktop/internal/process/supervisor.go:59-60`). It is used by the transcript compare (`internal/transcript/service.go:587`) and the recording check (`internal/coverage/service.go:55`). `Supervisor.Run` buffers stderr (`supervisor.go:89`), but callers keep it only to build an error message on a non-zero exit (`internal/takereview/sidecar.go:70`, `internal/guide/service.go:216`). The teleprompter stream keeps the last 16 KiB in memory (`internal/process/stream.go:15`), read only when the session fails (`internal/teleprompter/service.go:484`).
- **Two sidecars mirror their log to a file; the log is sparse and unleveled.** `narration_common.logging_utils.log` prints to stderr and, with `--log`, to a file (`libs/python/narration_common/logging_utils.py:13-16`). The host passes `--log` to the transcript compare (`log_<runID>.txt` in the session folder, `internal/transcript/service.go:565`) and the Story Bible build (`internal/guide/service.go:253`). Call density: `compare.py` 22 `log()` calls in 1,867 lines, `manuscript_guide.py` 9 in 1,446, `live_asr.py` 7 in 786.
- **The REAPER bridge has a protocol file, not a log.** `events.log` in the session folder is the event channel the host reads (`integrations/reaper/narration_bridge_core.lua:33-42`); it does not record which command ran, what it found, or why it refused.
- **The UI logs one thing to the console.** `apps/ui/src/components/primitives/ErrorBoundary.tsx:14`; schema failures go to the host log through `SystemReportDiagnostic`.
- **Nothing ties a run together.** There is no id shared by the host job, its sidecar's log file and the bridge commands it sends.

## Proposed Solution

Give the host one structured, leveled **run log**: JSON lines written through Go's `log/slog` to a capped, rotating file next to `host.log`. Every tool run gets a run id; the host writes a `run.start` record (tool, key inputs by reference, settings, versions) and a `run.end` record (outcome, duration, counts), and at debug level the decision points in between. Sidecars receive the run id and the level, write the same JSON-line shape to stderr, and the host keeps that stderr in a per-run file instead of discarding it. Bridge commands carry the run id and the Lua writes one debug line per command. Debug detail is off by default and turned on by a setting or `NARRATION_DEBUG=1`. A "Copy diagnostics" action gathers the records of one run (or the last N minutes) into one file the owner can hand to an agent. Content never enters the log at any level: ids, counts, hashes, paths, timings and settings only.

## Key Hypothesis

We believe that a start and end record for every run, debug-level decision records, and one id tying the host, sidecar and bridge together will let the owner (and an agent given the log) tell from the log alone whether a run did what it was meant to. We'll know we're right when, for each tool, a run's records answer "what went in, what settings applied, what it decided, what came out, how long it took" without reading code or re-running, and when the next three tool bugs reported are diagnosed from a copied diagnostics file.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Telemetry, crash upload, remote collection | ADR 0032 and the threat model: nothing leaves the machine. The narrator copies a file by hand |
| Manuscript text, transcripts, Story Bible entries or audio in the log, at any level | ADR 0069's "where, not what"; row 7a. Hashes and counts stand in for content |
| A log viewer page in the UI | "Open log folder" and "Copy diagnostics" are enough to hand logs over; a viewer is a later Could |
| Replacing `host.log` in this PRD's early phases | `hostlog` keeps its callers and format until phase 7 folds it into the run log (Q4) |
| Tracing across processes (OpenTelemetry) | One run id in every record is enough on one machine; a tracing stack is a dependency with no second consumer |
| Logging REAPER's own behavior | The bridge logs what our Lua did and saw; REAPER's API is checked in REAPER (ADR 0066) |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Tools with a `run.start` and a `run.end` record | Every job and every sidecar invocation | A guard test (like `hostguard_test.go`) that fails when a job or sidecar launch path does not go through the run-log helper |
| Sidecar stderr kept | 100% of sidecar runs, none discarded | `supervisor_test.go` asserts stderr reaches the run's file for `Start`, `Run` and `StartStream` |
| Content leak | Zero manuscript or transcript words in any log at debug level | A test runs each tool on a fixture with sentinel words and fails if a sentinel appears in any log file |
| Size | Run log capped at 5 MiB plus two backups; per-run sidecar files pruned to the last 20 runs or 7 days (Q3) | `runlog` tests |
| Cost when off | Debug records not formatted when the level is info | Benchmark on the hottest debug call site (teleprompter tracker) |
| Diagnosis from logs | The owner's next three tool bugs diagnosed from a copied diagnostics file | Owner's report on the issues |

## Open Questions

All five were answered by the owner on 2026-09-23 with the recommended option; the answers are in the Decisions Log.

- [x] **Q1.** Where is the debug switch? **Both:** a global setting on the Settings page for the narrator, and `NARRATION_DEBUG=1` for development and scripted runs.
- [x] **Q2.** May debug records carry short content? **Never.** A line id and a hash stand in for text, so threat-model row 7a is unchanged.
- [x] **Q3.** Size cap and retention? **5 MiB plus two backups** for the run log; per-run sidecar files kept for **the last 20 runs or 7 days**, whichever keeps fewer.
- [x] **Q4.** Does `host.log` fold into the run log? **Yes, in phase 7**, as `level=warn` records that keep the existing `kind`s, once the new file has shipped once.
- [x] **Q5.** How does "Copy diagnostics" hand the file over? **It saves a `.jsonl` file** to a folder the narrator chooses and copies its path.

## Users & Context

- **The owner, developing the app** with an agent: runs a tool, sees a surprising result, wants to hand the agent the evidence. Today they describe what they saw; with this, they attach the run's records.
- **A narrator reporting a bug:** attaches a diagnostics file to the Bug report form instead of describing steps.
- **An agent (Claude) verifying a change:** runs the app or a sidecar in a scripted check with `NARRATION_DEBUG=1` and reads the records to confirm the new code path ran and took the expected decision.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | `runlog` package: `log/slog` JSON handler, levels, capped rotation, run id, fixed record fields (`ts`, `level`, `run`, `tool`, `event`, `msg`, attributes) |
| Must | `run.start` / `run.end` for every host job and sidecar launch, with duration and outcome |
| Must | Sidecar stderr kept per run instead of discarded; run id and level passed to every sidecar |
| Must | Python `log()` gains levels and writes the same JSON-line shape |
| Must | Debug switch (setting and `NARRATION_DEBUG=1`, Q1) and the content rule enforced by a test |
| Should | Debug decision records in every Go tool and the sidecars (a checklist per package in phases 4 and 5) |
| Should | Bridge commands carry the run id; the Lua writes one debug line per command (received, result, refusal reason) |
| Should | "Open log folder" and "Copy diagnostics" on the Settings page |
| Could | A `tools/runlog` script that prints one run as a readable timeline for an agent or a human |
| Could | UI `console.error` sites and `wire_invalid` reports carry the active run id |
| Won't | Upload, a log viewer page, content in logs |

### MVP scope

Phases 1 to 3: the run log, start and end records for every run, sidecar stderr kept with run ids. That alone answers "what ran, with what, and how did it end".

### User flow

1. The owner turns on **Debug logging** in Settings (or starts the app with `NARRATION_DEBUG=1`).
2. They run a transcript compare. The host writes `run.start` (`tool=transcript_compare`, the chapter id, the model id, a settings hash, versions), then debug records as the job moves; the sidecar's records land in `logs/runs/<run-id>.stderr.jsonl`.
3. The result looks wrong. They choose **Copy diagnostics > Last run**; a `.jsonl` file holding the host and sidecar records of that run is saved and its path copied.
4. They give the file to the agent, which reads what went in and what the tool decided.

## Technical Approach

**Feasibility:** high. `log/slog` is in the Go standard library (no new dependency); the process supervisor already owns every sidecar pipe; the Python helper is one module used by all three sidecars.

**Architecture:**

- `apps/desktop/internal/runlog`: owns the file (`%APPDATA%\narration-utils\logs\run.jsonl`, rotation like `hostlog.rotateLocked`), the level (a `slog.LevelVar` changed by the setting), `Begin(tool, attrs) *Run` returning a run with its id and a `*slog.Logger` carrying `run` and `tool`, and `Run.End(outcome, attrs)`. A nil `*Run` drops records, as `hostlog` does, so tests need no setup.
- `internal/process`: `Start`, `Run` and `StartStream` take the run and write stderr to `logs/runs/<run-id>.stderr.jsonl` (bounded) instead of `io.Discard`; the in-memory tail stays for error messages.
- Sidecars: the run id and level arrive as `NARRATION_RUN_ID` / `NARRATION_LOG_LEVEL` in the child's environment or as flags (decided in phase 2; the environment avoids touching every `argparse` and threat-model row 4a). `logging_utils.log(message, level="info", **fields)` writes one JSON line to stderr; the existing `--log` mirror keeps working.
- Bridge: the host adds the run id as a field of a command; the Lua writes `bridge.jsonl` in the session folder at debug level, and the diagnostics bundle includes it. A harness test per command that logs (ADR 0066).
- The content rule: record helpers accept ids, numbers, booleans, durations, hashes and paths; a guard test scans call sites for attributes built from manuscript or transcript types, and the sentinel test in Success Metrics catches the rest.

**Risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Content leaks into a log through a message string | Medium | Content is never logged (Q2); sentinel test on fixtures; paths are the narrator's own project paths, already in `host.log` today |
| Debug records slow the teleprompter tracker | Low | `slog` skips disabled levels before formatting; benchmark in phase 4 |
| Logs fill the disk | Low | Caps and pruning (Q3), tested |
| Sidecar changes collide with other stacks editing `compare.py` and `live_asr.py` | Medium | Phase 2 touches only start-up and `logging_utils`; decision records (phase 5) are small, per-file commits |
| A trust-boundary change (a new file the app writes, new sidecar input, a new bridge field) goes unrecorded | Medium | Threat-model rows 4a, 5a and 7a and `SECURITY.md` updated in the phases that change them |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Run log foundation | `internal/runlog`: slog JSON handler, levels, rotation, run id, `Begin`/`End`; debug switch (Q1); ADR | complete | - | - | - |
| 2 | Sidecar plumbing | Supervisor keeps stderr per run; run id and level reach every sidecar; leveled JSON `log()` in `narration_common` | complete | with 3 | 1 | - |
| 3 | Start and end for every run | Every host job and sidecar launch goes through `runlog.Begin`/`End`; guard test | complete | with 2 | 1 | - |
| 4 | Go tool decision records | Debug records at the decision points of each Go tool, one checklist row per package; content sentinel test | complete | with 5, 6 | 3 | - |
| 5 | Sidecar decision records | Debug records in `compare.py`, `coverage_mode.py`, `manuscript_guide.py`, `live_asr.py`, `locate.py` | complete | with 4, 6 | 2 | - |
| 6 | REAPER bridge records | Run id on commands; Lua `bridge.jsonl` at debug level; harness tests; threat model 5a | pending | with 4, 5 | 1 | - |
| 7 | Diagnostics export and docs | "Open log folder" and "Copy diagnostics" (saves a `.jsonl`) in Settings; `tools/runlog` timeline script (Could); fold `host.log` into the run log; docs and threat model | complete | - | 3, 6 | - |

### Phase details

**Phase 1.** New package with tests (rotation, level change at runtime, nil run, concurrent writers, a golden record shape). Adds the debug setting to the global settings schema (`kind: "bool"`) and the environment variable. Records the decision in an ADR (next free number at merge time; 0166 today): tool runs are logged as JSON lines through slog with a run id, and content is never logged. Done when a test run writes `run.start` and `run.end` to the file and the level toggles without a restart.

**Phase 2.** `Supervisor.Start` stops discarding stderr; all three launch functions write it to the run's file, bounded. `logging_utils.log` gains `level` and fields and emits JSON lines; plain `log("text")` stays valid (level `info`). Sidecars read the run id and level. Done when `supervisor_test.go` proves stderr is kept for all three and the Python tests pin the line shape.

**Phase 3.** Wrap every job start in the host (`transcript`, `coverage`, `guide`, `takereview`, `takecompare`, the teleprompter session and locate, `pickups`, `lineidentity`, install and update jobs, and measurement and delivery as they land) with `runlog.Begin`/`End`. A guard test fails a new launch path that skips it. Done when every tool writes both records with duration and outcome.

**Phase 4.** For each Go tool, list the decisions worth a debug record (for example `retakelanes`: which lane was chosen and why; `takereview`: items in scope and items skipped with the reason; `cleanuptools`: which action matched). Add them with ids and counts only. Sentinel test over fixtures.

**Phase 5.** The same for the sidecars: alignment windows and gaps (`compare.py`), per-item cache hit or miss (`coverage_mode.py`), entities found and merged (`manuscript_guide.py`), tracker commits and resyncs (`live_asr.py`, sampled so a session does not flood the log), the locate's chosen span (`locate.py`).

**Phase 6.** The host adds the run id to bridge commands (a wire change: `apps/desktop/internal/bridge/wire.go` and the harness). The Lua writes one line per command received and one per result or refusal (with the refusal reason key, never project content). Harness tests for each; the scripted real-REAPER check records that the file is written.

**Phase 7.** Settings gets "Open log folder" and "Copy diagnostics" (last run, last 30 minutes), which saves a `.jsonl` file to a folder the narrator chooses and copies its path (Q5). `hostlog` folds into the run log as `level=warn` records keeping their `kind` (Q4), and its callers move to `runlog`; the new binding bumps `hostAPIVersion` and brings its Zod schema, golden payload and mock (wire contracts). Visual suite states for the new Settings rows. `docs/operations/verification-tooling.md` gains "Reading a run"; threat-model rows 7a, 4a and 5a and `SECURITY.md` are updated.

### Parallelism notes

Phases 2 and 3 can run in parallel after 1. Phases 4, 5 and 6 are independent of each other. Phase 7 needs 3 (so a "last run" exists) and follows 6 so the bundle includes bridge records.

### Parallel-session compatibility

| Phase | Files touched | Collides with |
| --- | --- | --- |
| 1 | `apps/desktop/internal/runlog/*` (new), `apps/desktop/app.go` (settings schema, wiring) | Any PRD adding a global setting (`app.go` `fieldSchemas`) |
| 2 | `apps/desktop/internal/process/*`, `libs/python/narration_common/logging_utils.py`, sidecar start-up | Stacks editing `compare.py`, `live_asr.py`, `manuscript_guide.py` (Diagnostics, Teleprompter, Story Bible PRDs) |
| 3 | Every `*_job.go` and service start in `apps/desktop` | Any PRD adding a job (Diagnostics, Editing Readiness, Audacity) |
| 4 | Go tool packages under `apps/desktop/internal/` | Same as 3, per package |
| 5 | The five sidecar modules named above | Same as 2 |
| 6 | `integrations/reaper/*.lua`, `integrations/reaper/tests`, `apps/desktop/internal/bridge/wire.go` | REAPER Automation Follow-Through (remaining phases 15 to 22) |
| 7 | `apps/ui/src` Settings page, `apps/desktop/bindings*.go`, `apps/ui/src/hostApi.ts`, `docs/` | Anything bumping `hostAPIVersion`; Settings-page work |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Logger | Go `log/slog` with a JSON handler | zap, zerolog, extending `hostlog` | Standard library, no new dependency, levels and structured attributes built in |
| Format | JSON lines | Plain text like `host.log` | An agent or a script can filter by `run`, `tool` and `event` without parsing prose |
| Content | Never logged, at any level (Q2, owner 2026-09-23) | Excerpts at debug level | Keeps ADR 0069's rule and threat-model row 7a unchanged |
| Debug switch | A global setting and `NARRATION_DEBUG=1` (Q1, owner 2026-09-23) | Setting only; variable only | The narrator needs a switch; scripted and agent runs need one without the UI |
| Size and retention | Run log 5 MiB plus two backups; per-run files for the last 20 runs or 7 days (Q3, owner 2026-09-23) | `hostlog`'s 1 MiB | Debug runs write far more than failure records; still bounded on disk |
| `host.log` | Folds into the run log in phase 7, keeping its `kind`s (Q4, owner 2026-09-23) | Two files for good | One place to look; waits until the new file has shipped once |
| Diagnostics hand-over | Save a `.jsonl` file and copy its path (Q5, owner 2026-09-23) | Clipboard only | A debug run's records can be too large for a comfortable clipboard |
| Correlation | One run id across host, sidecar and bridge | Timestamps only | Concurrent jobs interleave; timestamps cannot separate them |

## Research Summary

- **Codebase:** see Evidence. `hostlog` already solves rotation, message cleaning and the nil-log pattern; `runlog` reuses its approach.
- **Library:** `log/slog` (Go 1.21+) provides `LevelVar` for changing the level at runtime and `JSONHandler`; a disabled level is checked before attributes are formatted. Python's `logging` module was considered for the sidecars, but the shared `log()` helper is simpler to extend and already used by all three.
