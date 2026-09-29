# 0720. The Booth fills the whole window and F11 takes the window fullscreen

**Status:** Accepted (owner call BO2 on [#510](https://github.com/countrymanprime/narration-utils/issues/510), 2026-09-29)
**Date:** 2026-09-29
**Supersedes:** (none; it answers the open question BO2 left by [ADR 0388](0388-the-booth-is-a-page-keyed-by-its-address-and-only-exit-booth-stops-a-live-session.md))

## Context

Mock 03 draws the Booth with no nav rail and no app header: its status bar is the top edge of the window. The app kept the shell and left the choice behind one constant, `boothLayout.ts`'s `BOOTH_HIDES_APP_SHELL = false`, because the owner had not answered BO2 (`docs/research/visual-mockup-divergence-audit.md`). The owner has now ruled that the benchmark mocks are the spec, and on #510 asked for the Booth to "fill the whole shell window with F11 full screen support".

## Decision

1. `AppShell` draws no rail, header, drawer or demo banner on `/booth`: it renders the page in its own `<main>`, so the landmark stays. The Booth (and its companion mode) fills the window. Exit booth (or Escape, which asks first while a session listens) is the way out. The switch and `boothLayout.ts` are removed; nothing is hidden by a fixed overlay, so nothing sits behind the Booth in the accessibility tree.
2. A new command, `booth.fullscreen` (scope `booth`, default F11, rebindable like every command), toggles the window between fullscreen and windowed. It is registered only while the Booth (not the companion, a narrow panel beside the DAW) is up. A window the Booth put into fullscreen goes back to windowed when the Booth is left.
3. The toggle is `src/api/hostWindow.ts`. In the desktop host it is the Wails runtime's own `Window.ToggleFullscreen`; in the browser build (the visual suite, the demo) it is the Fullscreen API. It is a runtime call, not a Host binding, so it adds no binding, event or wire contract and needs no `hostAPIVersion` bump. Only `src/api` reaches the runtime (`wails-runtime-only-in-api`).

## Consequences

- The Booth matches mock 03's full-window frame at every viewport; the header's Back, zoom and engine chip are not on this page (the Booth's own bar has the engine and the REAPER state).
- `Ctrl+=`, `Ctrl+-` and `Ctrl+0` (zoom) and the other global commands still work: they are router commands, not header buttons.
- The threat model is unchanged: the page still reaches the window only through the runtime it already imports, and fullscreen changes what the narrator sees, not what the page can do.
