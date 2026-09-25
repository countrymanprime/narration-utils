# 0066. The Lua bridge is tested by a harness under Lua 5.4, and REAPER API behaviour is checked in REAPER

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner
- **Related:** Supersedes point 3 of [ADR-0031](0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) (the rest of ADR 0031 is unchanged and still awaits the owner's review)

## Context and problem

[ADR 0031](0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) recorded that changes to the Lua under `integrations/reaper` are verified by hand in REAPER and that a stub-`reaper` harness was "a later item, not part of this decision". `CLAUDE.md` said the same: every Lua consumer is zero-coverage, and a green `pnpm check` proves formatting only. Four PRDs add commands to one dispatcher in that Lua, so the manual gate was the weakest link in the train. The owner decided (implementation plan, decision D2, 2026-09-20) to pull the harness and a behaviour-preserving command registry forward, before any new Lua command, and to keep manual REAPER sign-off only for what a fake cannot prove: how REAPER's API actually behaves.

The harness needs a Lua 5.4 interpreter (REAPER 7 embeds Lua 5.4) that a developer on Windows and CI on Linux and Windows can all get the same way. What was considered:

- **A distro or winget package.** Different versions per platform and unpinned; nothing in the repository says which Lua the tests ran on.
- **Building the checksummed lua.org source tarball.** Deterministic, but it needs a C compiler on every machine; the Windows development machine has none, and each OS needs its own build flags.
- **LuaBinaries downloads (SourceForge).** Pinnable, but the release lag differs per platform and the host is an unreliable redirect chain.
- **Lua compiled to WebAssembly through npm.** Locked by `pnpm-lock.yaml`, but its file system is an emulated one, which is wrong for a bridge whose protocol is files on disk.
- **The `lupa` wheel from PyPI.** It embeds Lua 5.4 in a prebuilt wheel for Windows and Linux, is MIT licensed (Lua is MIT too), and `uv.lock` pins and hashes it. The repository already provisions Python through uv.

## Decision drivers

- Four PRDs add commands to one dispatcher in the Lua, so the manual gate was the weakest link in the train.
- The owner's decision D2 (2026-09-20): pull the harness and a behaviour-preserving command registry forward, before any new Lua command, and keep manual REAPER sign-off only for how REAPER's API actually behaves.
- The harness needs Lua 5.4 (what REAPER 7 embeds), available the same way to a developer on Windows and to CI on Linux and Windows.
- The interpreter should be pinned, so the repository says which Lua the tests ran on.

## Considered options

1. A fake-`reaper` harness under Lua 5.4 from the `lupa` wheel, pinned through uv
2. Lua from a distro or winget package
3. Building the checksummed lua.org source tarball
4. LuaBinaries downloads (SourceForge)
5. Lua compiled to WebAssembly through npm
6. Keep the status quo: Lua changes verified by hand in REAPER only (ADR 0031 point 3)

## Decision outcome

**Chosen option: a fake-`reaper` harness under Lua 5.4 from the `lupa` wheel, pinned through uv**, because the manual gate was the weakest link once four PRDs add commands, and `lupa` gives every platform the same pinned, hashed Lua 5.4 through the uv setup the repository already has.

1. **The bridge is tested by a harness in `integrations/reaper/tests/`.** A fake `reaper` API table (`fake_reaper.lua`: tracks, items, takes, item extension data, markers and regions, an undo log, a `defer` queue) is driven through the real file protocol (`.cmd` files in, `events.log` out) by `narration_ui_bridge.lua` and `NarrationUtils_Launcher.lua`, loaded from an installed-bundle layout. Every existing bridge command has a characterization test of its happy path and its error, stale, conflict and idempotent paths. The only things the runner injects are the directory operations Lua's standard library lacks (temp directory, list, make directory).
2. **Lua 5.4 comes from `lupa`,** pinned in the `lua` dependency group of `pyproject.toml` and hashed in `uv.lock`, and recorded in `scripts/toolchain.json`. `uv sync` installs it with everything else; the CI job installs only that group (`--only-group lua`). The runner refuses to run on anything but `Lua 5.4`.
3. **A mutation check keeps the tests honest.** `tests/mutations.json` lists lines whose removal must fail the suite (a stale GUID resolving to another item, an overwrite without asking, an undo point with nothing changed, a widened duplicate window, and so on). A surviving mutation, or a mutation whose text no longer occurs in the source, fails the run. Lua has no line-coverage tool here, so this stands in for the coverage ratchet of [ADR 0043](0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md).
4. **The harness is part of the gate.** The `reaper` Nx project has a `test` target, so `pnpm check` and the `quality / lua` CI job (Linux and Windows) run it, next to StyLua and ruff for the runner. The release package copy leaves `tests/` and `project.json` out.
5. **Manual REAPER sign-off remains, narrowed.** A fake proves the bridge logic, not REAPER. Anything that depends on REAPER's own behaviour (what `P_EXT` does on save, split and copy, real return values, undo semantics, render keys) is checked in a scripted REAPER run on a copy of a project with an isolated resource directory, recorded in `docs/research/`, and the fake is corrected to match. What needs the owner or audio hardware is recorded as pending. Points 1, 2 and 4 of ADR 0031 (a Lua file bridge, no loopback server, Lua owns only what a running REAPER knows) are unchanged.

### Consequences

- **Good:** A Lua change is red in CI when it breaks a command's behaviour, without REAPER being open. New commands come with harness tests, and the registry work that follows can refactor the dispatcher because the behaviour is pinned first.
- **Bad:** The fake is only as faithful as what has been observed in REAPER. It is a second copy of REAPER's API shapes: when a scripted REAPER run shows a difference, fix the fake and add the test, as the spike results in `docs/research/` do.
- **Neutral:** `lupa` ships a Lua 5.4 build of its own, not REAPER's. The bridge sticks to the Lua the two share (no `goto`, integer division or bit operators in the scripts; the code already avoids them for 5.1 safety).
- **Neutral:** Python is now needed to run the Lua tests. It is already required by bootstrap, and the CI job installs one small group instead of the full environment.
- **Neutral:** To change the interpreter (for example a different Lua 5.4 build) or drop the fake for real-REAPER-only tests, write a new ADR that supersedes this one.

### Confirmation

The harness is part of the gate: `pnpm check` and the `quality / lua` CI job (Linux and Windows) run it, and `tests/mutations.json` lists lines whose removal must fail the suite. REAPER's own behaviour is checked in a scripted REAPER run on a copy of a project, recorded in `docs/research/`.

## Pros and cons of the options

### The `lupa` wheel from PyPI

- Good, because it embeds Lua 5.4 in a prebuilt wheel for Windows and Linux.
- Good, because it is MIT licensed (Lua is MIT too).
- Good, because `uv.lock` pins and hashes it, and the repository already provisions Python through uv.

### A distro or winget package

- Bad, because versions differ per platform and are unpinned; nothing in the repository says which Lua the tests ran on.

### Building the checksummed lua.org source tarball

- Good, because it is deterministic.
- Bad, because it needs a C compiler on every machine; the Windows development machine has none, and each OS needs its own build flags.

### LuaBinaries downloads (SourceForge)

- Good, because it is pinnable.
- Bad, because the release lag differs per platform and the host is an unreliable redirect chain.

### Lua compiled to WebAssembly through npm

- Good, because it is locked by `pnpm-lock.yaml`.
- Bad, because its file system is an emulated one, which is wrong for a bridge whose protocol is files on disk.
