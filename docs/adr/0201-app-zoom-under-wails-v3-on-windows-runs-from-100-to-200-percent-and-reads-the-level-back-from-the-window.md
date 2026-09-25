# 0201. App zoom under Wails v3 on Windows runs from 100% to 200% and reads the level back from the window

**Status:** Proposed (needs the owner: it narrows the nav PRD's recommended zoom range, Q6)
**Date:** 2026-09-25
**Supersedes:** none. It answers, if accepted, how [App Navigation and Zoom Controls](../prds/app-navigation-and-zoom-controls.prd.md) Phase 2 applies Q6 on Wails v3 ([ADR 0200](0200-the-desktop-shell-runs-on-wails-v3-beta-pinned-at-v3-0-0-beta-25.md)).

## Context

The nav PRD recommends (Q6 A) WebView2's own zoom steps clamped to 50%–200%, with Ctrl+wheel clamped to the same range, and a readout that follows Ctrl+wheel through a zoom-changed callback. Reading Wails v3.0.0-beta.25 while migrating to it (ADR 0200) found two limits on Windows:

- **Nothing below 100% from the host.** `WebviewWindow.SetZoom` calls the Windows `setZoom`, which raises any value under 1.0 to 1.0 (`pkg/application/webview_window_windows.go`, `setZoom`), and `ZoomOut` stops at 1.0 too. WebView2's own Ctrl+wheel and pinch are not affected: they still go down to 25% and up to 500%, and `GetZoom` reads whatever level they left.
- **No zoom-changed event.** v3 does not surface WebView2's `ZoomFactorChanged` on its window; its `WindowZoomIn`/`Out`/`Reset` events are macOS menu events. So the host cannot tell the page that a Ctrl+wheel moved the level.

Options: (A) the buttons and Ctrl+=/−/0 run from 100% to 200% and the page reads the level back from the window when it changes; (B) patch Wails, or wait for an upstream beta that allows a level under 1.0, and keep Q6 A's 50%; (C) imitate the levels under 100% with CSS zoom, which the nav PRD rejects because the breakpoints do not move.

## Decision

Proposed, recommendation A (under D22):

1. **The zoom controls step through WebView2's levels from 100% to 200%**: 100, 110, 125, 150, 175, 200. Zoom out is disabled at 100%. Reset (`SetZoom(1.0)`) works from any level.
2. **Ctrl+wheel and pinch stay WebView2's own.** A level above 200% is set back to 200% (`SetZoom(2.0)`, Q6's reason: the known cramped layouts at 390 px); a level under 100% is kept, because a smaller page cramps nothing, and the readout shows it with Reset enabled.
3. **The readout reads the level back.** When the page sees a zoom change (the window's `devicePixelRatio` changes, which WebView2 zoom does, and a `resize` fires), the UI asks the host for the level (`GetZoom` through nav Phase 2's binding) instead of waiting for a host event.
4. **Revisit when Wails lifts the floor.** A Wails beta that allows `SetZoom` under 1.0 on Windows, or surfaces `ZoomFactorChanged`, is a pin change (ADR 0200) and a new ADR that supersedes this one to restore Q6 A's 50%.

## Consequences

- The narrator can make the app larger from the header and return to 100% in one click from any level, including one Ctrl+wheel set under 100%.
- Making it smaller than 100% stays possible, but only with Ctrl+wheel or pinch, not with the header's button; the readout still shows the level.
- No fork and no CSS zoom: the level is always the webview's real zoom.
- Nav Phase 2 adds the zoom binding with `GetZoom` and `SetZoom`, reached through the window ADR 0200 names `main`; no event is added for zoom.
- If the owner prefers B, nav Phase 2 waits on a Wails change; if C, the nav PRD's rejection of CSS zoom is reopened.
