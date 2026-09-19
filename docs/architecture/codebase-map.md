# Codebase map

Narration Utils keeps its stable launch and integration paths while organizing
implementation around the product domain that owns its behavior.

## Stable boundaries

- `shell/` is the Go/Wails desktop host. It exposes generated, typed Wails
  bindings and native events only; it has no loopback HTTP surface, port, or
  browser fallback.
- `shared/ui/` is the React application. It communicates only through the
  typed API facade; feature components do not import HTTP transport code.
- `tools/*/core/` remain stable Python CLI entrypoints for DAW integrations.
- `shared/reaper/` is the REAPER-only bridge. Its field order and protocol are
  compatibility contracts.
- `shared/python/narration_common/` contains only cross-tool contracts such
  as canonical manuscript access, settings, logging, progress, and bridge
  encoding. Feature-specific analysis stays with its tool.

## Go host ownership

`shell/bindings.go` is the auditable generated-Wails binding index. The native app does not expose HTTP routes.

- `system` owns health, bootstrap, settings, diagnostics, and shutdown.
- `manuscript` owns canonical text, reader state, notes, and import jobs.
- `story_bible` owns guide entities, relationships, audio preview, and build jobs.
- `transcript` owns comparison lifecycle, review results, and marker export.
- `tts` owns the approved voice catalog and install jobs.
- `tracks` owns reading a project's `.rpp` file (discovery, selection, track/item metadata). `shell/media.go` serves those tracks' audio to the webview through the asset server's `/media` route (see [ADR 0012](../adr/0012-media-route-for-track-playback.md)); it is the only non-frontend content the asset server serves.

- `teleprompter` owns one live listening session: it runs the `manuscript-teleprompter` sidecar, relays its events as `teleprompter:event`, publishes phase changes as `teleprompter:state`, and keeps the last `script` and `position` so a page opened mid-session can catch up (see [ADR 0022](../adr/0022-live-sidecar-events-over-wails-and-stop-file.md)). The Teleprompter page lives in `shared/ui/src/components/teleprompter/` (see [ADR 0024](../adr/0024-teleprompter-highlight-follows-the-sidecars-spans.md)).

`shell/internal/` holds domain services and infrastructure. The Wails binding
surface is operation-specific; it does not accept arbitrary route names.

## UI ownership

`shared/ui/src/api/contracts/` contains the TypeScript wire contracts by
domain. `types.ts` is a compatibility barrel during migration. New feature
work should import from its owning contract module and keep component-local
state or hooks beside the feature. For example, Story Bible pronunciation
playback lives in `components/storybible/usePreviewAudio.ts`, while editing and
rendering remain in `GuideDetail.tsx`.

## Sidecar boundary

The two Python tools retain their stable `core` CLI contracts and are frozen
as immutable packaged sidecars. Go supervises them; feature code must not add
a Python server or a browser transport.
