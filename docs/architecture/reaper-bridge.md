# The REAPER bridge and its test harness

**Status: implemented.** The Lua under `integrations/reaper` is tested without REAPER by a harness; what only a running REAPER can show is checked in scripted REAPER runs. Decisions: [ADR 0031](../adr/0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) (a Lua file bridge, no loopback server) and [ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md) (the harness). The boundary rules for what lives in Lua are in [DAW integration](daw-integration.md).

## What is in `integrations/reaper`

| File | Role |
| --- | --- |
| `NarrationUtils_Launcher.lua` | The one REAPER action. Finds the app executable, starts it with the session directory, project and DAW arguments, then runs the bridge loop. Its name and path are stable: the narrator imports it into REAPER's action list. |
| `narration_ui_bridge.lua` | The bridge: polls `commands/` from a `reaper.defer` loop, dispatches each command, appends results to `events.log`. |
| `reaper_common_core.lua`, `reaper_common_process.lua` | Small helpers the launcher loads: files and paths, hidden process launch, pipe splitting. |
| `tests/` | The harness (below). Not shipped: `scripts/release/prepare-resources.py` leaves `tests/` and `project.json` out of the app's embedded REAPER package. |

## The file protocol

The Go host (`apps/desktop/internal/bridge`) and the Lua bridge share one session directory, `<REAPER resource path>/NarrationUtils/sessions/hub_<id>/`, created by the launcher.

- **Commands** go one way. `Client.Send` writes `commands/NNNNNNNN.cmd` atomically (a `.tmp` file, then a rename) holding one line of percent-encoded, `|`-separated fields: protocol version `1`, the command name, then its arguments. The bridge reads the first line of each `.cmd` file in name order, deletes it, and dispatches. It splits at most eight fields; a payload that needs more travels as a file whose path is an argument.
- **Events** come back through the append-only `events.log`, one percent-encoded, `|`-separated line per event with the tag first. On Windows Lua writes CRLF in text mode, so a reader trims a trailing carriage return (the Go client does).
- **Errors** are `ERROR|<message>` events; an unsupported protocol version or command name is reported the same way.

Every command that writes to the project is one undo block, writes nothing when there is nothing to change, and is safe to send twice.

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
| `*_test.lua` | Characterization tests: `protocol_test` (the loop), `compare_test`, `line_identity_test`, `launcher_test` (the launcher from an installed-bundle layout), `common_test` (the helpers). |
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
