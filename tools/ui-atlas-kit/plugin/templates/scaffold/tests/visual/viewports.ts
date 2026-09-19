export interface Viewport {
  name: string;
  width: number;
  height: number;
}

// Fixed set of sizes captured for every state, so responsive behaviour (not just one fixed layout)
// is checked systematically. Add or rename to match the app's real breakpoints.
export const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'small-desktop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
