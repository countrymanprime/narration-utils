// The mocks the pixel-match tool scores (D91 on #509, owner rulings of 2026-09-29). THE SPEC IS ONE FOLDER:
//   docs/research/mockups/audiobook-studio-benchmark/   (the seven benchmark mocks, approved as the build spec, D69)
// NOT THE SPEC, never look at, score against or build towards: everything under docs/prds/mockups/. Those per-PRD sets
// (read-aloud-control-bar, read-aloud-resume-from-daw, edit-and-proof-workspace, delivery-platform-profiles, home-combined,
// manuscript-*, chapter-track-link-control, daw-chapter-track-auto-sync, input-commands-and-pedals, and the rest) were drawn
// from the app before the redesign; they show the old shell, pages the redesign replaced and layouts the benchmark set
// superseded. The `*-concept.webp` copies of the benchmark mocks in docs/prds/mockups/stage-navigation-and-page-replacement/
// are byte-identical to the research files and are not read either.
// Theme: the theme is one app-wide setting, so a state is captured in the theme its mock is drawn in and compared with it:
// light against light, dark against dark. The benchmark mocks are light except the Booth (03) and the companion (07); their
// dark counterparts of the light mocks are worked out later. A mock with no `target` says why it is not scored.

import { fileURLToPath } from 'node:url';

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ApprovedMock {
  /** File name in docs/research/mockups/audiobook-studio-benchmark/. */
  file: string;
  /** The visual-suite state (tests/visual/state-catalog.ts) that shows this screen; its driver reaches it. */
  target?: { page: string; state: string };
  /** The theme the mock is drawn in: the capture uses it too, so a theme is never counted as a difference (D69). */
  theme: 'light' | 'dark';
  /**
   * Compare only this part of the mock, captured at its size: a mock that draws the app beside something that is not the
   * app (mock 07 draws REAPER to the left of the companion panel).
   */
  mockRegion?: Region;
  /**
   * The viewport to capture at, when it is not the mock's own size: a crop of a wider screen is captured at the screen's
   * size and its top-left `width × height` compared (a header crop is the top of the page).
   */
  viewport?: { width: number; height: number };
  /** Why the mock has no target yet. */
  unscored?: string;
}

export const SPEC_DIR = 'docs/research/mockups/audiobook-studio-benchmark';

/** The folder that is never the spec (see the header). A test fails if a scored mock resolves under it. */
export const NOT_THE_SPEC_DIR = 'docs/prds/mockups';

export const APPROVED_MOCKS: ApprovedMock[] = [
  // Scored against its own data (?mockFidelity=01, Q5).
  { file: '01-production-home.webp', target: { page: 'production', state: 'mock-fidelity-01' }, theme: 'light' },
  { file: '02-prep-script.webp', target: { page: 'script', state: 'prep-rail-pronunciations' }, theme: 'light' },
  { file: '03-booth.webp', target: { page: 'booth', state: 'speaker-tags' }, theme: 'dark' },
  { file: '04-proof-pickups.webp', target: { page: 'proof', state: 'default' }, theme: 'light' },
  { file: '05-master-delivery.webp', target: { page: 'master', state: 'measured' }, theme: 'light' },
  {
    file: '06-series-voice-bible.webp',
    theme: 'light',
    unscored:
      'the Character Continuity review page, not the Story Bible (multi-book series is out of scope: one project is one book); it needs its own PRD and mocks, and so does the real Story Bible',
  },
  {
    file: '07-daw-companion.webp',
    target: { page: 'booth', state: 'companion-default' },
    theme: 'dark',
    mockRegion: { x: 1020, y: 0, width: 420, height: 900 },
  },
];

export function scoredMocks(): (ApprovedMock & { target: { page: string; state: string } })[] {
  return APPROVED_MOCKS.filter((mock): mock is ApprovedMock & { target: { page: string; state: string } } => Boolean(mock.target));
}

/** The mock's path on disk. */
export function mockPath(file: string): string {
  return fileURLToPath(new URL(`../../../../../docs/research/mockups/audiobook-studio-benchmark/${file}`, import.meta.url));
}

/** A part of the app's chrome, as a rectangle of the mock: the nav rail or the header bar right of it. */
export interface ChromeRegion extends Region {
  name: 'rail' | 'header';
}

// The mocks that draw no app shell, so they have no chrome to score: the Booth is full-screen (03) and the companion is a crop
// of its own panel (07).
const NO_SHELL = ['03-booth.webp', '07-daw-companion.webp'];

/** Whether the mock's chrome is the chrome's spec: every mock in the spec folder is (D92). */
export function isChromeSpec(_mock: ApprovedMock): boolean {
  return true;
}

/**
 * The nav rail and the header as the mock draws them, each scored on its own beside the whole screen, so a change to the chrome
 * is measured apart from the page under it. The geometry is the mock's own, never the app's: the benchmark mocks draw a 216 px
 * rail and a 52 px header (rules at x 215 and y 51). A mock with no shell, or compared by a region of its own, has none.
 */
export function chromeRegions(mock: ApprovedMock, width: number, height: number): ChromeRegion[] {
  if (mock.mockRegion || NO_SHELL.includes(mock.file)) return [];
  return [
    { name: 'rail', x: 0, y: 0, width: Math.min(216, width), height },
    { name: 'header', x: 216, y: 0, width: width - 216, height: Math.min(52, height) },
  ];
}

/** The file name the capture, the diff and the record of one mock are written under. */
export function slugOf(file: string): string {
  return file.replace(/\.webp$/, '').replace(/\//g, '__');
}
