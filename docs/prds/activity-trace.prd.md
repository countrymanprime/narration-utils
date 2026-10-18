# Activity Trace: An Allow-Listed Record of How the App Behaves That Never Holds Content

**Source:** owner rulings of 2026-10-17; tracking issue [#1827](https://github.com/countrymanprime/narration-utils/issues/1827).

**Constraints:** local-first, with nothing uploaded and no content in a log ([threat model](../architecture/threat-model.md)); the typed-boundary rules in [wire contracts](../architecture/wire-contracts.md); the tool-run log in [verification tooling](../operations/verification-tooling.md#reading-a-run).

## Problem Statement

With REAPER running and its bridge live, the Production page said "REAPER is not running", and nothing on disk could say why. The run log (`run.jsonl`) records tool runs only. Reading the code showed what was missing:

- The host decides "the DAW is reachable" from a heartbeat at most 5 s old (`daw/reachability.go`), and drops several failures silently: the bridge client being nil, a `bridge.New` error, a `Dispatch` error, a rejected `PROJECT_STATUS` event.
- About 394 `Host` bindings run with no name, duration or outcome on disk. Live events, navigation, dialogs and frontend errors are not logged. `ErrorBoundary` has no `onError`.
- The run log's content rule says content is never logged but allows raw paths, and the call-site guard and sentinel test it promised do not exist. Sidecars log free-text f-strings: `extraction_rules.py` logs a raw quote, `asr_batch.py` logs the Story Bible hotwords. "Copy diagnostics" copies sidecar stderr verbatim and leaves out `host.log` and `bridge.jsonl`.

## Evidence

The Production banner above, and the code reading in the Problem Statement. Owner rulings of 2026-10-17: everything about how the app functions is logged except sensitive data (manuscript, transcripts, script content, names, emails, user paths and usernames, text typed into fields, audio); the log must be exportable for an engineer or an AI agent to diagnose from; there is no hosting, so nothing is uploaded and users share a file by hand; the trace is off by default and on in dev mode; opaque ids and counts are acceptable.

## Proposed Solution

One typed, redacting way to write a log record in every layer (UI, host, sidecars, DAW bridge), with a registry that decides what a record can hold, so the rule "no content" is something the code cannot step around instead of a convention.

## Key Hypothesis

If every layer writes through one allow-listed registry, a failure like the Production banner leaves a timeline (what the UI showed, what the host believed about the DAW and why) without a new leak path appearing with each message.

## What We're NOT Building

- Uploading logs, crash reporting, analytics or any usage metrics: nothing may leave the machine. Changing this changes the threat model's "no telemetry" statement.
- Recording content at any level.
- A deny-list scrubber over free-form messages (a new leak path appears with each new message), extending `run.jsonl` (run history would be evicted by chatty records), per-component logging (cannot be guarded), or always-on disk logging.

## Success Metrics

- A canary suite runs the app flows with sentinel names, paths, words and typed text, and no sentinel appears in the trace, `run.jsonl`, stderr files, `host.log`, `bridge.jsonl` or an export.
- A Go test gives every `Host` method the default tracing policy; the UI wrapper has a coverage test.
- A reachability flip, a nil client or a rejected event is always an event with a reason.

## Open Questions

- The diagnostics export (a zip with a manifest of what is and is not included, a preview before saving, a check of the bundle against the open project's names and the user's name, and a safe summary an agent can read): its format is settled when its code lands.
- Sidecars gain an `event(name, **fields)` log call with an allow-list; plain-message sidecar lines are left out of an export until migrated.
- Whether live high-rate events can be validated in full or need an envelope-only check, decided by measuring against the recorded teleprompter stream.

## Users & Context

Narrators who hit a failure and want to send a file to a maintainer, and maintainers or agents diagnosing it. The trace is off by default; a narrator turns it on in Settings (a Debug panel), and a build run from source has it on.

## Solution Detail

**Must**
- A new package, `apps/desktop/internal/trace`, writes `%APPDATA%\narration-utils\logs\trace.jsonl` through the same slog JSON handler and record envelope as `runlog`: 10 MiB cap and two backups, a buffered writer flushed every second and on exit or panic. Every record carries `ts`, `seq`, `level`, `sess` (an id per launch), `area` and `event`, and `run` and `cid` when known. `run.jsonl` and its run ids are unchanged.
- A registry of event definitions. Each field has a kind: `enum`, `int`, `bool`, `duration_ms`, `id`, `path`, `errclass` or `len`. There is no free-string kind; `slog.Any`, `fmt` and `%v` are banned in the package by a lint rule, and an unknown event or field is dropped and counted. UI events cross in one batched binding and are validated against the same registry.
- Content is never recorded:
  - A `path` becomes `{class, ext, h}`: class is inside the project, beside it, in the user profile, other local, network or removable, and `h` is eight hex characters of an HMAC-SHA256 over the lowercased normalised path with a per-install salt. A raw path, a home directory or a user name never appears.
  - Text, names and emails have no field; a text edit logs a control id, a length bucket and validity, on blur and not per keystroke. A setting change logs the tool and key, and the value only for bool, enum or number keys on an allow-list.
  - An `id` matches `^[a-z0-9_.:-]{1,64}$`. Opaque ids (a chapter id, a GUID) and counts are allowed; titles are not. A control is identified by a static id in code, never by its accessible name.
  - An error logs a class from a fixed enum and a stable code. The message, scrubbed of paths, quoted strings, emails and long digit runs and cut to 160 characters, is written at debug level only.
- Off by default; on when the build runs from source (the version still reads `0.0.0-dev`, which a published release never does), or when the narrator turns it on. `General.debug_logging` and `NARRATION_DEBUG=1` keep their meaning for decision records. An in-memory ring buffer of the last 2,000 events is always on, is never written to disk, and is included in an export when the disk trace is off.
- DAW connection state is always an event: every reachability flip with the last-seen age, the timeout and a reason enum; the client being configured or nil with its reason; dispatch errors and rejected events by tag; project match and its reason; capability availability and its reason code.

**Should**
- Instrumentation at central points, not in components: a `withTracing(api)` wrapper over `NarrationApi`, `onHostEvent`, the router, `overlayService`, the error boundary and the existing `window` handlers on the UI side; `emitEvent`, the supervisor, `daw.Reachability`, the bridge `Dispatch`, lifecycle and a recover wrapper on the host side. Bindings log name, duration, outcome and error class; arguments are logged only where an allow-list row exists. High-rate events (recording levels, teleprompter words, transport, heartbeats) are aggregated per window and logged on change.
- `host.log` retires into the trace once the export includes everything it held.

**Could**
- The diagnostics export and the sidecar `event()` call (see Open Questions).

## Technical Approach

The registry, not a scrubber, is the control: the emit API accepts only the registry's types, so a record that could carry text cannot be written. Guards: a Go test enumerates `Host` methods by reflection and gives each the default policy; the UI wrapper has a coverage test, and the silent-catch scan requires a swallowed error to be traced or exempt with a reason; the canary suite above fails on any sentinel.

Risks: a scrubbed error message is the one place a deny-list remains, so it is debug-only and covered by the canary suite. With the trace off, a failure that happened before it was switched on has only the ring buffer and `run.jsonl`; that is the price of "off by default". A new event must be registered, which costs a few lines and a golden entry; a new binding is traced with no code.

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends |
| --- | --- | --- | --- | --- | --- |
| 1 | Trace package and registry | `internal/trace`, the record envelope, the field kinds, the lint ban, off by default with the ring buffer | built: package, registry, canary test; the Settings switch follows | - | - |
| 2 | Host and UI instrumentation | `withTracing`, `emitEvent`, the supervisor, lifecycle and recover wrapper; the batched UI binding | not started | - | 1 |
| 3 | DAW connection events | Reachability flips, nil client, dispatch errors and rejected events, project match, capability availability | built: host events in `trace_host.go` | 2 | 1 |
| 4 | Guards | The reflection test over `Host` methods, the UI coverage test, the silent-catch scan and the canary suite | not started | - | 2, 3 |
| 5 | Export and sidecar `event()` | The diagnostics export with its preview and manifest; the sidecar call; `host.log` retires | not started | - | 4 |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Where the trace lives | A new `trace.jsonl` beside `run.jsonl` | Extend `run.jsonl` | Run history would be evicted by chatty records |
| How content is kept out | A registry with no free-string kind | A deny-list scrubber | A new leak path appears with each new message |
| Default | Off; on in dev builds; a ring buffer always | Always on | Owner ruling 2026-10-17 |
| Upload | None; a file shared by hand | A crash or analytics service | Nothing may leave the machine |

## Research Summary

The code reading under Problem Statement (reachability, the unlogged bindings, the sidecar f-strings) is the research; there is no external study. The run log, `host.log` and `bridge.jsonl` are described in [data files](../reference/data-files.md) and [verification tooling](../operations/verification-tooling.md#reading-a-run).
