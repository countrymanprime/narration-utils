# The REAPER bridge and its test harness

**Status: implemented.** The Lua under `integrations/reaper` is tested without REAPER by a harness; what only a running REAPER can show is checked in scripted REAPER runs (the line identity checklist and the bridge commands passed 37 checks in REAPER 7.80; the fake is pinned to what that run observed). Decisions: [ADR 0031](../adr/0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) (a Lua file bridge, no loopback server) and [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md) (the harness). The boundary rules for what lives in Lua are in [DAW integration](daw-integration.md).

## What is in `integrations/reaper`

| File | Role |
| --- | --- |
| `NarrationUtils_Launcher.lua` | The one REAPER action. Finds the app executable, starts it with the session directory, project and DAW arguments, then runs the bridge loop. Its name and path are stable: the narrator imports it into REAPER's action list. |
| `narration_ui_bridge.lua` | The command loop and the registry it dispatches through: polls `commands/` from a `reaper.defer` loop, looks each command up, appends results to `events.log`. Lists the feature files in `FEATURE_FILES` and loads them next to itself. |
| `narration_bridge_core.lua` | Shared by the bridge and every feature file: the percent-encoding and field-splitting helpers, `event`, file and path helpers, and `new_registry()`. |
| `narration_compare.lua`, `narration_line_identity.lua` | The commands, one file per feature (Transcript Compare; manuscript line identity and chapter regions). |
| `reaper_common_core.lua`, `reaper_common_process.lua` | Small helpers the launcher loads: files and paths, hidden process launch, pipe splitting. |
| `tests/` | The harness (below). Not shipped: `scripts/release/prepare-resources.py` leaves `tests/`, `spikes/` and `project.json` out of the app's embedded REAPER package. |
| `spikes/` | Scripts that run inside a real REAPER, isolated in a temp resource directory, to find out what a fake cannot ([README](../../integrations/reaper/spikes/README.md); the S0 result is [reaper-spike-s0-item-extension-data.md](../research/reaper-spike-s0-item-extension-data.md)). Research tools, not product code. |

## The file protocol

The Go host (`apps/desktop/internal/bridge`) and the Lua bridge share one session directory, `<REAPER resource path>/NarrationUtils/sessions/hub_<id>/`, created by the launcher.

- **Commands** go one way. `Client.Send` writes `commands/NNNNNNNN.cmd` atomically (a `.tmp` file, then a rename) holding one line of percent-encoded, `|`-separated fields: protocol version `1`, the command name, then its arguments. The bridge reads the first line of each `.cmd` file in name order, deletes it, and dispatches. It splits at most eight fields; a payload that needs more travels as a file whose path is an argument.
- **Events** come back through the append-only `events.log`, one percent-encoded, `|`-separated line per event with the tag first. **The first argument of every event is the run ID of the command that caused it** (the command's own first argument), so a consumer can tell its events from another's. On Windows Lua writes CRLF in text mode, so a reader trims a trailing carriage return (the Go client does).
- **Errors** are `ERROR|<run_id>|<message>` events. The run ID is the failing command's first argument, or empty when there is none: an unsupported protocol version is `ERROR||Unsupported hub protocol`, an unknown command is `ERROR|<its first argument>|Unsupported workspace command`. An empty run ID marks a session-level problem, delivered to every consumer that handles errors.

The bridge polls the commands folder with `reaper.EnumerateFiles`, which **caches a directory's listing** (REAPER 7.80: a file created after the first call stays invisible and a removed one stays listed, for seconds, until the listing is cleared with index `-1`). Every listing therefore starts with `EnumerateFiles(dir, -1)`, and a listed file that cannot be opened is skipped without an event. Before this, each command left a ghost in the stale listing that was reported as `ERROR|Unsupported hub protocol`, and a new command could wait for the cache to expire; both were only visible in a real REAPER (found by the scripted run recorded in [docs/research](../research/)), and the harness's fake now caches the listing the same way.

Every command that writes to the project is one undo block, writes nothing when there is nothing to change, and is safe to send twice.

### One command, step by step

Starting the bridge, and one Transcript Compare command travelling through it and back.

```mermaid
sequenceDiagram
  autonumber
  actor N as Narrator
  participant L as integrations/reaper: NarrationUtils_Launcher.lua
  participant Br as integrations/reaper: narration_ui_bridge.lua
  participant F as session folder: commands/, events.log
  participant C as apps/desktop: internal/bridge Client
  participant TS as apps/desktop: internal/transcript Service
  participant H as apps/desktop: app.go transcriptLoop
  N->>L: Run the action in REAPER
  L->>L: create NarrationUtils/sessions/hub_id/commands
  L->>H: start narration-utils.exe with --session-dir, --project-folder, --daw
  L->>Br: run(session_dir), a reaper.defer tick loop
  N->>TS: Start a comparison (TranscriptStart)
  TS->>C: Send("prepare_compare", runId)
  C->>F: write commands/NNNNNNNN.tmp, then rename to .cmd
  loop every REAPER defer tick
    Br->>F: EnumerateFiles(commands, -1), then each .cmd in name order
    Br->>F: read the first line, delete the file
  end
  Br->>Br: version 1 check, registry lookup, run the handler
  Br->>F: append COMPARE_PREPARED|runId|... to events.log
  loop every 150 ms
    H->>TS: Drain, then Poll
    TS->>C: Dispatch, whole new lines, in order, once
    C->>C: check the fields against the table in wire.go
    C-->>TS: the event to the subscriber that owns the run
  end
  TS->>TS: handlePrepared, start the transcript-compare sidecar
```

*Verified 2026-09-21 against `NarrationUtils_Launcher.lua`, `narration_ui_bridge.lua` (`M.run`, the `tick` loop), `narration_bridge_core.lua`, `apps/desktop/internal/bridge/{bridge,events,wire}.go`, `apps/desktop/internal/transcript/service.go` (`Start`, `Drain`, `Handle`) and `apps/desktop/app.go` (`transcriptLoop`, `pollTranscript`), and by the harness, which drives the same protocol ([ADR 0031](../adr/0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md), [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)). The command names here are generic on purpose: every command travels this way, so the diagram does not change when one is added ([ADR 0067](../adr/0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md)). The threats at steps 6 to 11 are rows 5a to 5c of the [threat model](threat-model.md#5-the-reaper-file-bridge-not-in-securitymd-see-the-note-under-the-table).*

## Reading events in the host: the fan-out

`bridge.Client` (`apps/desktop/internal/bridge/events.go`) is the one reader of `events.log` and feeds every consumer, so two features can use one session without stealing each other's events (the old single `ReadEvents` cursor could not).

```go
client.Subscribe(bridge.Subscription{
	Tags:   []string{"COMPARE_*", "ERROR"}, // exact tags, or a prefix ending in "*"
	Owns:   func(runID string) bool { ... }, // does this consumer track that run?
	Handle: func(event bridge.Event) { ... }, // event.Tag, event.RunID, event.Fields (tag first)
})
```

- **Routing.** An event goes to each consumer whose `Tags` match it and, when it carries a run ID, whose `Owns` is nil or true for that run. An event with an empty run ID goes to every consumer whose tags match. An event nobody accepts (an unowned run, an unwanted tag) is dropped and counted (`Undelivered()`); a line that does not decode is skipped and counted (`Malformed()`).
- **Delivery.** `Dispatch()` reads the lines appended since the last call and delivers them in log order, once, on the calling goroutine, serialised across callers; the host's 150 ms loop already calls it through `transcript.Service.Drain`, so a second consumer only subscribes. Only whole lines are consumed: a line REAPER is still writing waits for the next call.
- **Consumers today:** the Transcript Compare service subscribes to `COMPARE_*` and `ERROR` for its own run. Line identity and the teleprompter integration subscribe the same way when they land.

### Checking events before they are delivered

`Client.Dispatch` checks each decoded line against a table (`apps/desktop/internal/bridge/wire.go`, [wire contracts](wire-contracts.md#reaper-events-appsdesktopinternalbridgewirego)): the fields after the tag, which are required, which are numbers. The Lua script is imported into REAPER by the narrator and can be older or newer than the app, so a line that is too short or whose number is not a number is **not delivered**: it is counted (`Invalid()`), logged (`reaper_event_invalid`) and handed to the consumers of its tag and run through `Subscription.Invalid`. Transcript Compare ends its run with a message naming the event and field. A tag that is not in the table passes through (a newer script's event), and the optional tail of `COMPARE_MARKER` may be absent (an older script). **Adding an event to a feature file means adding it to the table**, and `wire_test.go` fails when a tag is in one and not the other; it uses the same lines the harness pins.

## The command registry

A command is a handler `function(ctx, args)` registered under its name. `ctx.session_dir` is the session directory, `ctx.event(tag, ...)` appends an event, `ctx.stop()` ends the loop (the `close` command is just that). `args` are the command's fields after its name, already percent-decoded. A name may be registered once: registering it twice is an error, so two features cannot shadow each other. An unknown name is answered with `ERROR|Unsupported workspace command`, an unsupported protocol version with `ERROR|Unsupported hub protocol`.

To add a command:

1. Write the harness tests first (see below), and watch them fail.
2. Put the command in `integrations/reaper/narration_<feature>.lua`. The file starts with `local core = ...` (the shared helpers arrive as the chunk argument) and returns `function(registry)`, which creates the feature's state (a `runs` table, say) and calls `registry.register(name, handler)`.
3. List the file in `FEATURE_FILES` in `narration_ui_bridge.lua` and in `scripts/release/reaper-files.mjs` (the installer check requires every file listed there; `reaper-files.test.mjs` fails when the list and the folder disagree, and a registry test fails when a feature file exists that the bridge does not load).
4. Add the command to the table below and to the registry test that pins the list of registered names.

The feature files are `loadfile`d when the bridge module loads, so a missing or broken one fails the launcher's `dofile` and the narrator sees "Could not load Narration Utils shared libraries" before the app starts. The bridge finds its own folder from `debug.getinfo` and falls back to the running action's path.

## Commands

| Command | Arguments after the name | Events |
| --- | --- | --- |
| `prepare_compare` | `run_id` | `COMPARE_PREPARED\|run\|manifest\|manuscript\|track\|diff\|items`, or `ERROR` |
| `inspect_compare_results` | `run_id`, `results_path` | `COMPARE_MARKER\|...` per row, then `COMPARE_INSPECTED\|run\|summary\|total\|already-marked` |
| `export_compare_markers` | `run_id`, `results_path`, three `RRGGBB` colours | `COMPARE_EXPORT_MARKER\|run\|row\|state\|existing-name` per row, then `COMPARE_EXPORTED\|run\|added\|skipped` |
| `jump_to_compare_marker` | `run_id`, `row_id` | none, or `ERROR` |
| `stamp_item_lines`, `read_line_ids`, `create_chapter_regions` | see [manuscript line identity](manuscript-line-identity.md) | `LINES_*`, `REGIONS_CREATED` |
| `close` | none | none; the loop stops |

`COMPARE_MARKER` carries 16 fields (see `inspect_results` in the bridge and the transcript service that reads it); the harness pins them.

## The harness

`integrations/reaper/tests/` runs the bridge and the launcher under **Lua 5.4** with a **fake `reaper` table**, through the same file protocol the host uses. Run it with `pnpm exec nx run reaper:test` (it is also part of `pnpm check` and the `quality / lua` CI job on Linux and Windows).

| Piece | What it does |
| --- | --- |
| `run_lua_tests.py` | The runner. Gives each `*_test.lua` its own Lua state (the `lupa` wheel, Lua 5.4), injects the few things Lua's standard library lacks (a temp directory, listing and creating directories), and exits non-zero on a failure. `--mutations` adds the mutation checks. |
| `fake_reaper.lua` | The fake API and an in-memory project: tracks, items, takes and their markers, item extension data (a missing `P_EXT` key reads as `false, ''`), markers and regions (`EnumProjectMarkers3` returns index plus one), an undo log, a `defer` queue that `pump()` runs one frame at a time. `remove_api(name)` makes `APIExists` answer false, the way an older REAPER lacks a function. |
| `harness.lua` | Tests, assertions, and `session()`: builds a fake REAPER, loads the bridge from `host.reaper_dir`, and offers `send(command, ...)` (writes a `.cmd` file and runs one tick) and `events()` (the new events, decoded). |
| `*_test.lua` | Characterization tests: `protocol_test` (the loop), `registry_test` (the registry and the feature-file convention), `compare_test`, `line_identity_test`, `launcher_test` (the launcher from an installed-bundle layout), `common_test` (the helpers). |
| `mutations.json`, `mutations.py` | Each entry breaks one guard in the Lua source (a stale GUID resolving to another item, an overwrite without asking, a spurious undo point, a widened duplicate window) and the suite must fail. A mutation that survives, or whose text is no longer in the source, fails the run. |

### Writing a test

```lua
local H = require('harness')

H.test('stamp_item_lines reports a GUID that no longer resolves', function()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local item = s.fake:add_item(s.fake:add_track('Narrator'), { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  s:send('stamp_item_lines', 't1', payload_path, '0')
  H.eq(s:events(), { { 'LINES_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' }, { 'LINES_STAMPED', 't1', '0', '0', '1', '0' } })
  H.eq(item.ext, {})
end)
```

Write the test first for a new or changed command, watch it fail, then change the Lua. Assert what the narrator would notice: the events, the item extension data, the undo labels and count, and that a second send changes nothing. When a guard exists to protect data (a stale GUID, an overwrite, a duplicate marker), add an entry to `mutations.json` that removes it.

### What the harness does not prove

A fake proves the bridge's logic, not REAPER. Whether REAPER returns what the fake returns, what item extension data does on save, split and copy, and how a render setting behaves are only known from a running REAPER. Those are checked in a scripted run on a copy of a project with an isolated resource directory and recorded in [docs/research](../research/), and the fake is corrected to match. The harness cannot show the app's UI, or anything that needs audio hardware.

Lua 5.4 comes from the `lupa` wheel (pinned in the `lua` dependency group of `pyproject.toml`, hashed in `uv.lock`). It is not REAPER's own build, so the scripts keep to the Lua the two share.
