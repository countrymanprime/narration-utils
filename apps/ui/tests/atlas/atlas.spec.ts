/* eslint-disable @typescript-eslint/no-explicit-any -- in-page access to Storybook's untyped window globals */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { allowedRules } from './a11y-debt';
import { needsFreshLoad } from './reload-debt';

interface IndexEntry {
  id: string;
  type: 'story' | 'docs';
  title: string;
  name: string;
  tags?: string[];
}
interface Violation {
  id: string;
  impact?: string;
  nodes: Array<{ target?: unknown[]; failureSummary?: string }>;
}
interface Finished {
  storyId: string;
  status: 'success' | 'error';
  reporters: Array<{ type: string; result?: { violations?: Violation[]; incomplete?: Array<{ id: string; nodes: unknown[] }> } }>;
}
interface StoryState {
  finished: Finished;
  playError: string | undefined;
  errorDisplay: boolean;
}

// Small canvases on purpose: a component is judged on its own, once at a width
// where it has room and once where a phone would squeeze it.
const VIEWPORTS = [
  { name: 'wide', width: 1024, height: 640 },
  { name: 'narrow', width: 390, height: 640 },
];
// UI_ATLAS_THEMES=light limits the run for an app with a single theme.
const THEMES = (process.env.UI_ATLAS_THEMES ?? 'light,dark').split(',').map((theme) => theme.trim()) as Array<'light' | 'dark'>;
const READY_TIMEOUT_MS = 15_000;

interface Variant {
  theme: 'light' | 'dark';
  viewport: (typeof VIEWPORTS)[number];
}
// theme outer, viewport inner - keeps screenshot filenames and their order the same as before this grouping.
const VARIANTS: Variant[] = THEMES.flatMap((theme) => VIEWPORTS.map((viewport) => ({ theme, viewport })));

const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8')) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');

// Reads the channel's last-known state for this page's current story. Storybook's channel remembers the last payload of
// each event, so this is safe to call right after a wait that confirms a (re)render has finished.
function readStoryState(page: Page): Promise<StoryState> {
  return page.evaluate(() => {
    const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
    return {
      finished: channel.last('storyFinished')[0] as Finished,
      // By default a throwing play() only emits this event; storyFinished.status stays 'success'.
      playError: channel.last('playFunctionThrewException')?.[0]?.message as string | undefined,
      errorDisplay: document.body.classList.contains('sb-show-errordisplay'),
    };
  });
}

// Loads a story fresh: a new navigation, so play() (if any) runs from scratch and any state from a previous
// variant is gone. Used for the first variant of every story, and every variant of a story whose play() would
// otherwise mutate a page reused across variants.
async function loadStory(page: Page, entry: IndexEntry, variant: Variant): Promise<StoryState> {
  await page.setViewportSize({ width: variant.viewport.width, height: variant.viewport.height });
  // Apps that theme with prefers-color-scheme (Tailwind's default dark: variant) flip only if the media query does.
  await page.emulateMedia({ colorScheme: variant.theme });
  await page.goto(`/iframe.html?id=${entry.id}&viewMode=story&globals=theme:${variant.theme}`, { waitUntil: 'commit' });
  await page.waitForFunction((storyId) => (window as any).__STORYBOOK_ADDONS_CHANNEL__?.last('storyFinished')?.[0]?.storyId === storyId, entry.id, {
    timeout: READY_TIMEOUT_MS,
    polling: 20,
  });
  return readStoryState(page);
}

// Switches theme and viewport on the page already showing this story, instead of a fresh navigation. `updateGlobals`
// re-renders the story unconditionally (Storybook's preview re-renders every current story render on any globals
// update, whether or not a value actually changed), which re-applies the theme decorator and reruns addon-a11y's
// afterEach at the new size - the same checks a fresh load would make, without paying for a new page load. Only safe
// for a story with no play(): a mutated story cannot be trusted to reach the same state again from a re-render.
async function switchVariant(page: Page, variant: Variant): Promise<StoryState> {
  await page.setViewportSize({ width: variant.viewport.width, height: variant.viewport.height });
  await page.emulateMedia({ colorScheme: variant.theme });
  await page.evaluate(async (theme) => {
    const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
    await new Promise<void>((resolve) => {
      channel.once('storyFinished', () => resolve());
      channel.emit('updateGlobals', { globals: { theme } });
    });
  }, variant.theme);
  return readStoryState(page);
}

function describeViolation(violation: Violation): string {
  const nodes = violation.nodes.map((node) => `${String(node.target?.join(' '))} - ${(node.failureSummary ?? '').split('\n').slice(1, 2).join('').trim()}`);
  return `${violation.id} (${violation.impact ?? 'n/a'}): ${nodes.join(' | ')}`;
}

// Crop the screenshot to what the story actually draws, so a small component is not a mostly empty canvas; with nothing
// left to crop to, the whole viewport is used.
async function contentClip(page: Page): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  return page.evaluate(() => {
    const pad = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const insideFixedLayer = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return true;
      return false;
    };
    const rects = [...document.body.querySelectorAll('*')]
      .filter((el) => !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(
        ({ el, r }) =>
          r.width > 0 &&
          r.height > 0 &&
          !(r.width >= vw - 1 && r.height >= vh - 1) &&
          !(insideFixedLayer(el) && (r.top >= vh || r.left >= vw || r.bottom <= 0 || r.right <= 0)),
      )
      .map(({ r }) => r);
    if (rects.length === 0) return undefined;
    const left = Math.max(0, Math.min(...rects.map((r) => r.left)) - pad);
    const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - pad);
    const right = Math.min(vw, Math.max(...rects.map((r) => r.right)) + pad);
    const bottom = Math.min(vh, Math.max(...rects.map((r) => r.bottom)) + pad);
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : undefined;
  });
}

// A story taller than the viewport is shown whole by growing the viewport to fit it, not with Playwright's
// fullPage: fullPage stretches fixed elements (a bottom bar) across the whole page and mixes coordinate systems
// when a play() scrolled. Scroll back to the top first so the measurement and the clip agree. Fixed layers are
// viewport-bound and cannot make the page taller, so they are ignored when sizing (a closed slide-over parked
// below the fold would otherwise inflate every screenshot).
async function fitViewportToContent(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  const needed = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const insideFixedLayer = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return true;
      return false;
    };
    const bottoms = [...document.body.querySelectorAll('*')]
      .filter((el) => !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(el.tagName) && !insideFixedLayer(el))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && !(r.width >= vw - 1 && r.height >= vh - 1))
      .map((r) => r.bottom);
    return bottoms.length ? Math.ceil(Math.max(...bottoms)) + 12 : 0;
  });
  if (needed > height) await page.setViewportSize({ width, height: Math.min(needed, 4000) });
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Renders the story exactly as it stood right after `loadStory`/`switchVariant` returned: crops and screenshots it,
// then checks it the same way a fresh page's story always has. Appends to `failures` instead of asserting inline, so a
// bad variant does not stop the remaining variants of this story from being captured and checked (each variant used to
// be its own independent test; grouping them into one test must not change that). Mirrors the hard-then-soft order the
// ungrouped version asserted in: a play() throw or Storybook's own error display stops this variant's remaining
// checks, same as `expect()` throwing did before; the rest are soft, same as `expect.soft()` was.
async function checkVariant(page: Page, entry: IndexEntry, variant: Variant, state: StoryState, problems: string[], failures: string[]): Promise<void> {
  const label = `${variant.theme}/${variant.viewport.name}`;
  const { finished, playError, errorDisplay } = state;

  await page.evaluate(() => document.fonts.ready);
  await fitViewportToContent(page, variant.viewport.width, variant.viewport.height);
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // Storybook's static server answers a missing file with a fallback page and status 200, so a broken image
  // shows up only as an <img> that finished loading with no pixels.
  const brokenImages = await page.evaluate(() =>
    [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && !img.currentSrc.endsWith('.svg')).map((img) => img.currentSrc || img.src),
  );
  const dir = `screenshots/atlas/${slug(entry.title)}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: `${dir}/${slug(entry.name)}--${variant.theme}-${variant.viewport.name}.png`,
    animations: 'disabled',
    caret: 'hide',
    clip: await contentClip(page),
  });

  for (const reporter of finished.reporters.filter((r) => r.type === 'a11y')) {
    const undecided = (reporter.result?.incomplete ?? []).map((item) => `${item.id} (${item.nodes.length})`);
    if (undecided.length) test.info().annotations.push({ type: 'axe-incomplete', description: `${label}: ${undecided.join(', ')}` });
  }
  const allowed = allowedRules(entry.title);
  const violations = finished.reporters
    .filter((reporter) => reporter.type === 'a11y')
    .flatMap((reporter) => reporter.result?.violations ?? [])
    .filter((violation) => !allowed.includes(violation.id))
    .map(describeViolation);
  // Problems logged since the last capture (this variant's boot or switch, and its checks) belong to this variant only.
  const ownProblems = problems.splice(0);

  if (playError !== undefined) {
    failures.push(`${label}: play() threw: ${playError}`);
    return;
  }
  if (errorDisplay) {
    failures.push(`${label}: Storybook is showing its error display`);
    return;
  }
  failures.push(...violations.map((violation) => `${label}: ${violation}`));
  // The addon marks a story 'error' for ANY axe result, including rules recorded as debt above.
  if (allowed.length === 0 && finished.status !== 'success') failures.push(`${label}: story reported status ${finished.status}`);
  if (overflowPx > 1) failures.push(`${label}: story scrolls sideways by ${overflowPx}px`);
  if (brokenImages.length) failures.push(`${label}: images that failed to load: ${brokenImages.join(', ')}`);
  failures.push(...ownProblems.map((problem) => `${label}: ${problem}`));
}

test.describe.configure({ mode: 'parallel' });

// Every Storybook story x theme x viewport, captured and checked (a11y, play(), overflow, console errors). One test
// per story: it loads the first variant fresh, then for the rest switches theme and resizes on the same page instead
// of reloading, since a story with no play() renders the same way from a re-render as it would from a fresh load. A
// story tagged play-fn (Storybook tags any story with a play() function automatically) reloads for every variant
// instead: play() mutates the story, so a page already mutated by a previous variant cannot be reused for the next.
// reload-debt.ts names any story found (by the side-by-side diff this phase's PR ran) to also need a fresh page per
// variant despite having no play(), same spirit as a11y-debt.ts.
for (const entry of stories) {
  const reloadEveryVariant = (entry.tags ?? []).includes('play-fn') || needsFreshLoad(entry.title);

  test(`${entry.title} / ${entry.name}`, async ({ page }) => {
    test.setTimeout(test.info().timeout * VARIANTS.length);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
    });

    const failures: string[] = [];
    for (const [index, variant] of VARIANTS.entries()) {
      await test.step(`${variant.theme}/${variant.viewport.name}`, async () => {
        const state = index === 0 || reloadEveryVariant ? await loadStory(page, entry, variant) : await switchVariant(page, variant);
        await checkVariant(page, entry, variant, state, problems, failures);
      });
    }
    expect(failures, 'the story reported problems').toEqual([]);
  });
}
