# Codebase map

Narration Utils names every top-level folder for the role of what is in it, and keeps its stable launch
and integration paths while organizing implementation around the product domain that owns its behavior.
The decision and the old-to-new path map are in
[ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md).

## Repository layout

```
apps/
  desktop/        Go/Wails desktop host (app.go, bindings.go, internal/, build/ icons)
  ui/             React + Tailwind app; its tests/ hold the Playwright visual and atlas suites
sidecars/         Python programs frozen into the app and run on demand
  manuscript-guide/  manuscript-teleprompter/  transcript-compare/   (each: core/ CLI backend, tests/)
libs/
  python/         narration_common, the cross-tool Python contracts
integrations/
  reaper/         REAPER launcher and Lua bridge
  audacity/       placeholder notes for a future Audacity driver
config/           shipped JSON: defaults, asset catalogs, roadmap
tests/
  fixtures/       manuscripts and other data used by tests across projects
tools/
  ui-atlas-kit/   the reusable UI-atlas plugin (development tooling only)
scripts/          repo automation, release and CI tooling
docs/             documentation, ADRs and PRDs
```

Only these entries may exist at the repository root. `scripts/ci/layout.test.mjs` runs in `pnpm check` and fails
on any other top-level entry, or on a tracked file that still names a retired path; the allowlist and the
old-to-new path map live in `scripts/ci/layout.json`.

### Where tests go

Tests follow the toolchain. Colocate them where the toolchain wants that: Go `_test.go` beside the package,
Vitest `*.test.tsx` beside the component, Storybook stories beside the primitive, `node:test` files beside
the script. Otherwise a project has one `tests/` folder at its root (`libs/python/tests`,
`sidecars/<name>/tests`, `scripts/release/tests`). The Playwright visual and atlas suites stay in
`apps/ui/tests`, because the atlas kit scaffolds them into the project it serves. Data shared by several
projects lives in `tests/fixtures`. Go code and tests name repo-relative locations through
`apps/desktop/internal/layout`, and `scripts/release/prepare-resources.py` keeps its own constants, so the
next move is a one-line change in each.

### Projects

Every folder above except `docs/` is an Nx project with a `project.json`; `pnpm check` and CI run their
`lint`, `format`, `test` and `build` targets, and CI runs only the projects a change affects. See
[Nx projects and the quality gate](../operations/ci-and-releases.md#nx-projects-and-the-quality-gate).

## Stable boundaries

- `apps/desktop/` is the Go/Wails desktop host. It exposes generated, typed Wails
  bindings and native events only; it has no loopback HTTP surface, port, or
  browser fallback. Its Go module path is still
  `github.com/countrymanprime/narration-utils/shell`; nothing imports it.
- `apps/ui/` is the React application. It communicates only through the
  typed API facade; feature components do not import HTTP transport code.
- `sidecars/*/core/` remain stable Python CLI entrypoints for DAW integrations.
- `integrations/reaper/` is the REAPER-only bridge. Its field order and protocol are
  compatibility contracts. A checkout finds the sidecars, catalogs and launcher relative to
  `integrations/reaper` (two levels up is the repo root); packaged builds use `resources/`.
- `libs/python/narration_common/` contains only cross-tool contracts such
  as canonical manuscript access, settings, logging, progress, and bridge
  encoding. Feature-specific analysis stays with its tool.

## Go host ownership

`apps/desktop/bindings.go` is the auditable generated-Wails binding index. The native app does not expose HTTP routes.

- `system` owns health, bootstrap, settings, diagnostics, and shutdown.
- `manuscript` owns canonical text, reader state, notes, and import jobs.
- `story_bible` owns guide entities, relationships, audio preview, and build jobs.
- `transcript` owns comparison lifecycle, review results, and marker export.
- `tts` owns the approved voice catalog and install jobs.
- `tracks` owns reading a project's `.rpp` file (discovery, selection, track/item metadata). `apps/desktop/media.go` serves those tracks' audio to the webview through the asset server's `/media` route (see [ADR 0012](../adr/0012-media-route-for-track-playback.md)); it is the only non-frontend content the asset server serves.
- `findings` implements the [findings contract](findings-contract.md) record (validation, stable IDs, review state); analyzers emit it without importing REAPER APIs.
- `measure` reads WAV files directly and computes loudness, RMS, peaks, and noise floor, plus `Evaluate` against a caller-supplied profile (see [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md)). Not yet exposed through the Wails binding surface.

- `teleprompter` owns one live listening session: it runs the `manuscript-teleprompter` sidecar, relays its events as `teleprompter:event`, publishes phase changes as `teleprompter:state`, and keeps the last `script` and `position` so a page opened mid-session can catch up (see [ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md)). The Teleprompter page lives in `apps/ui/src/components/teleprompter/` (see [ADR 0024](../adr/0024-teleprompter-highlight-follows-the-sidecars-spans.md)).

`apps/desktop/internal/` holds domain services and infrastructure. The Wails binding
surface is operation-specific; it does not accept arbitrary route names.

## UI ownership

`apps/ui/src/api/contracts/` contains the TypeScript wire contracts by
domain. `types.ts` is a compatibility barrel during migration. New feature
work should import from its owning contract module and keep component-local
state or hooks beside the feature. For example, Story Bible pronunciation
playback lives in `components/storybible/usePreviewAudio.ts`, while editing and
rendering remain in `GuideDetail.tsx`.

## Sidecar boundary

The Python sidecars retain their stable `core` CLI contracts and are frozen
as immutable packaged sidecars. Go supervises them; feature code must not add
a Python server or a browser transport.
