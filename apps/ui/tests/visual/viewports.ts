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
