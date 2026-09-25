/* eslint-disable @typescript-eslint/no-explicit-any -- in-page access to Storybook's untyped window globals */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { allowedRules } from './a11y-debt';

interface IndexEntry {
  id: string;
  type: 'story' | 'docs';
  title: string;
  name: string;
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

// Small canvases on purpose: a component is judged on its own, once at a width
// where it has room and once where a phone would squeeze it.
const VIEWPORTS = [
  { name: 'wide', width: 1024, height: 640 },
  { name: 'narrow', width: 390, height: 640 },
];
// UI_ATLAS_THEMES=light limits the run for an app with a single theme.
const THEMES = (process.env.UI_ATLAS_THEMES ?? 'light,dark').split(',').map((theme) => theme.trim()) as Array<'light' | 'dark'>;
const READY_TIMEOUT_MS = 15_000;

const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8')) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');

// `storyFinished` fires after render + play() + afterEach (where addon-a11y runs
// axe). The channel remembers the last payload of each event, so polling last()
// cannot miss an event that fired before we looked.
async function finishedStory(page: Page, id: string) {
  await page.waitForFunction((storyId) => (window as any).__STORYBOOK_ADDONS_CHANNEL__?.last('storyFinished')?.[0]?.storyId === storyId, id, {
    timeout: READY_TIMEOUT_MS,
    polling: 20,
  });
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

test.describe.configure({ mode: 'parallel' });

for (const entry of stories) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${entry.title} / ${entry.name} / ${theme} / ${viewport.name}`, async ({ page }) => {
        const problems: string[] = [];
        page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
        });

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Apps that theme with prefers-color-scheme (Tailwind's default dark: variant) flip only if the media query does.
        await page.emulateMedia({ colorScheme: theme });
        await page.goto(`/iframe.html?id=${entry.id}&viewMode=story&globals=theme:${theme}`, { waitUntil: 'commit' });
        const { finished, playError, errorDisplay } = await finishedStory(page, entry.id);

        await page.evaluate(() => document.fonts.ready);
        await fitViewportToContent(page, viewport.width, viewport.height);
        const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        // Storybook's static server answers a missing file with a fallback page and status 200, so a broken image
        // shows up only as an <img> that finished loading with no pixels.
        const brokenImages = await page.evaluate(() =>
          [...document.images]
            .filter((img) => img.complete && img.naturalWidth === 0 && !img.currentSrc.endsWith('.svg'))
            .map((img) => img.currentSrc || img.src),
        );
        const dir = `screenshots/atlas/${slug(entry.title)}`;
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
          path: `${dir}/${slug(entry.name)}--${theme}-${viewport.name}.png`,
          animations: 'disabled',
          caret: 'hide',
          clip: await contentClip(page),
        });

        for (const reporter of finished.reporters.filter((r) => r.type === 'a11y')) {
          const undecided = (reporter.result?.incomplete ?? []).map((item) => `${item.id} (${item.nodes.length})`);
          if (undecided.length) test.info().annotations.push({ type: 'axe-incomplete', description: undecided.join(', ') });
        }
        const allowed = allowedRules(entry.title);
        const violations = finished.reporters
          .filter((reporter) => reporter.type === 'a11y')
          .flatMap((reporter) => reporter.result?.violations ?? [])
          .filter((violation) => !allowed.includes(violation.id))
          .map(describeViolation);

        expect(playError, 'play() threw').toBeUndefined();
        expect(errorDisplay, 'Storybook is showing its error display').toBe(false);
        expect.soft(violations, 'accessibility violations').toEqual([]);
        // The addon marks a story 'error' for ANY axe result, including rules recorded as debt above.
        if (allowed.length === 0) expect.soft(finished.status).toBe('success');
        expect.soft(overflowPx, `story scrolls sideways by ${overflowPx}px`).toBeLessThanOrEqual(1);
        expect.soft(brokenImages, 'images that failed to load').toEqual([]);
        expect.soft(problems, 'the story logged errors').toEqual([]);
      });
    }
  }
}
