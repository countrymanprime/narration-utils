# Codebase map

Narration Utils keeps its stable launch and integration paths while organizing
implementation around the product domain that owns its behavior.

## Stable boundaries

- `shell/` is the Tauri desktop host. Its in-process Axum API owns the
  loopback HTTP surface and static UI fallback.
- `shared/ui/` is the React application. It communicates only through the
  typed API facade; feature components do not import HTTP transport code.
- `tools/*/core/` remain stable Python CLI entrypoints for DAW integrations.
- `shared/reaper/` is the REAPER-only bridge. Its field order and protocol are
  compatibility contracts.
- `shared/python/narration_common/` contains only cross-tool contracts such
  as canonical manuscript access, settings, logging, progress, and bridge
  encoding. Feature-specific analysis stays with its tool.

## Rust host ownership

`shell/src-tauri/src/server/routes/` is the auditable HTTP route index:

- `system` owns health, bootstrap, settings, diagnostics, and shutdown.
- `manuscript` owns canonical text, reader state, notes, and import jobs.
- `story_bible` owns guide entities, relationships, audio preview, and build jobs.
- `transcript` owns comparison lifecycle, review results, and marker export.
- `tts` owns the approved voice catalog and install jobs.

`contracts/` holds request/response wire types. Services and infrastructure
remain implementation details behind the route boundary; unknown `/api/*`
requests must return 404 before the SPA fallback handles browser paths.

## UI ownership

`shared/ui/src/api/contracts/` contains the TypeScript wire contracts by
domain. `types.ts` is a compatibility barrel during migration. New feature
work should import from its owning contract module and keep component-local
state or hooks beside the feature. For example, Story Bible pronunciation
playback lives in `components/storybible/usePreviewAudio.ts`, while editing and
rendering remain in `GuideDetail.tsx`.

## Next slices

The route registry is the first host split. Move handlers and state methods
from `server/mod.rs` into their corresponding domain modules only when a test
preserves the existing HTTP behavior. Split Python tools the same way behind
their existing `core` entry scripts; do not create a new generic utility
module for tool-specific algorithms.
