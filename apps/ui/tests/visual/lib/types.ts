import type { Viewport } from '../viewports';
import type { NarrowControlsDeclaration, SameAsDeclaration } from './validators';

export interface StateEntry {
  page: string;
  state: string;
  description: string;
  // Why this row has no driver in app.drivers.ts. A row with neither a driver
  // nor a reason fails `pnpm test`, so a state can no longer be skipped silently.
  undriven?: string;
  // This state deliberately renders identically to another (checked, not trusted:
  // it fails if they ever differ). Any other identical pair fails the run.
  sameAs?: SameAsDeclaration;
  // CSS selectors of regions that legitimately change between runs (live
  // clocks, playback position). They are painted over in the screenshot.
  mask?: string[];
  // The driver hovers or focuses something the screenshot must show, so the
  // pointer stays where the driver left it instead of being parked off-page.
  pointer?: 'keep';
  // Show the whole scrollable page by growing the viewport to its height (long pages, full-height routes).
  fullPage?: boolean;
  // Capture this state at these viewports as well as the default matrix in viewports.ts (a width the whole suite does not
  // pay for, such as a phone width where only one page's layout changes). Each needs a name of its own, and a driver
  // that can reach the state there.
  extraViewports?: Viewport[];
  // Text boxes and selects that are allowed to be narrower than the minimum control width on purpose (a two-digit
  // number box). Checked, not trusted: it fails when the control stops being narrow. Any other collapsed control fails.
  narrowControls?: NarrowControlsDeclaration;
  // Load and drive the app afresh at each viewport instead of driving once and resizing (one test per viewport, the shape
  // every row had before 0.3.5). For a state whose driving or rendering depends on the width it was reached at: resizing
  // keeps what the first viewport left (an open menu, a measured layout), and a fresh load at the smaller width does not.
  // Give the reason in a comment on the row.
  reloadPerViewport?: true;
}
