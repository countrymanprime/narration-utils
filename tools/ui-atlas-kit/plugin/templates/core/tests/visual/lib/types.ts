// ui-atlas-kit 0.3.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import type { SameAsDeclaration } from './validators';

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
}
