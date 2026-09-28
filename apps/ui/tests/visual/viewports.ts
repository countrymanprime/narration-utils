export interface Viewport {
  name: string;
  width: number;
  height: number;
}

// Fixed set of sizes captured for every state, so responsive behavior (not
// just one fixed layout) gets checked systematically - see the Settings-page
// "doesn't respond to larger sizes" complaint this suite exists to catch.
// No phone size: this is a DAW companion app, used on a tablet or larger, so the
// mobile layout (nav drawer) is not captured (ADR 0037).
export const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'small-desktop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
];

// The width at which a layout that stacks below `md` (48rem, 768px) must still be usable: 390px, a phone and also what a
// desktop window shows at 400% browser zoom (WCAG 1.4.10 Reflow asks for 320). It is not part of the matrix above: a state
// opts in with `extraViewports: [REFLOW_VIEWPORT]` in state-catalog.ts, so the suite pays for it only where a row's layout
// changes there (the Settings rows, ADR 0061). The desktop shell's minimum window is 960px, so this is reached by zoom, not
// by resizing.
export const REFLOW_VIEWPORT: Viewport = { name: 'reflow', width: 390, height: 844 };

// Companion mode's window (booth-mode-and-companion-panel.prd.md Phase 7, ADR 0401): the host narrows the app's one window
// to 380 px (apps/desktop/bindings_companion.go's companionModeWidth) and pins it beside the DAW, so the companion rows are
// judged at that width too, the way the narrator actually sees them. Not part of the matrix: rows opt in with `COMPANION`.
export const COMPANION_VIEWPORT: Viewport = { name: 'companion', width: 380, height: 900 };

// The Script page's full mock-02 layout (stage-navigation-and-page-replacement.prd.md Phase 3, ADR 0393, superseding ADR
// 0392): the chapter list, the reader and the rail show side by side from 1440 px (D85 on issue #509 - mock 02's own
// capture width), so the matrix's `desktop` width already shows it; the rail rows also opt in here, an even wider check.
export const WIDE_VIEWPORT: Viewport = { name: 'wide', width: 1680, height: 1050 };
