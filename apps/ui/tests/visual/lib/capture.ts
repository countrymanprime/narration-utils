// ui-atlas-kit 0.3.6 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import * as appDrivers from '../app.drivers';
import type { Driver } from '../app.drivers';
import { runRecordPath, screenshotDir, settleFrames, settlePage } from '../helpers/settle';
import type { Viewport } from '../viewports';
import type { StateEntry } from './types';
import {
  checkAxeFindings,
  checkControlWidths,
  checkDocumentScroll,
  disambiguateLabels,
  NON_TEXT_INPUT_TYPES,
  OVERFLOW_TOLERANCE_PX,
  resolveAxeMode,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  summariseAxeViolations,
  type AxeDebt,
  type AxeFinding,
  type CaptureRecord,
  type ControlMeasurement,
  type DocumentScrollMode,
  type EscapedAbsolute,
  type RawAxeViolation,
} from './validators';

function watchForProblems(page: Page, problems: string[]): void {
  page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  // ERR_ABORTED is the browser cancelling a request the app abandoned (React StrictMode's dev double-effect), not a failure.
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`request failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
}

async function measureHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function measureVerticalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
}

// Absolutely positioned elements under #root whose containing block escaped the shell: rendered, position: absolute, and
// offsetParent is <body> or null (no positioned ancestor caught it). Structural, so it finds a zoom-only escape that no
// captured viewport happens to overflow at (app-shell-vertical-overflow.prd.md).
async function findEscapedAbsolutes(page: Page): Promise<EscapedAbsolute[]> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return [];
    const selectorOf = (element: Element): string => {
      const parts: string[] = [];
      let node: Element | null = element;
      let depth = 0;
      while (node && node !== root && depth < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(`${part}#${node.id}`);
          break;
        }
        const parent: Element | null = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === node!.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
        depth += 1;
      }
      return parts.join(' > ');
    };
    const found: EscapedAbsolute[] = [];
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(element);
      if (style.position !== 'absolute' || style.display === 'none' || style.visibility === 'hidden') continue;
      const offsetParent = element.offsetParent;
      if (offsetParent === document.body || offsetParent === null) {
        found.push({ selector: selectorOf(element), bottom: Math.round(element.getBoundingClientRect().bottom) });
      }
    }
    return found;
  });
}

// Every visible text box, select and textarea, with its accessible name and rendered width. A control in the layout with
// no width is still returned (that is the collapse being looked for); one that is not rendered (display: none, hidden), that
// sits in an aria-hidden or inert subtree, or that is visually hidden (a box one pixel tall or less, as a screen-reader-only
// input is) is not a control a person sees, so it is not measured.
async function measureTextControls(page: Page): Promise<ControlMeasurement[]> {
  const measured = await page.evaluate((nonText) => {
    const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (element: HTMLElement): string => {
      const fromIds = squash(
        (element.getAttribute('aria-labelledby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' '),
      );
      const label = (element as HTMLInputElement).labels?.[0];
      // A label that wraps its control also contains the control's options: read the label without the controls.
      const clone = label?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('input, select, textarea').forEach((control) => control.remove());
      return (
        fromIds ||
        element.getAttribute('aria-label') ||
        squash(clone?.textContent) ||
        element.getAttribute('placeholder') ||
        element.getAttribute('name') ||
        element.id ||
        element.tagName.toLowerCase()
      );
    };
    return Array.from(document.querySelectorAll<HTMLElement>('input, select, textarea'))
      .filter((element) => !(element instanceof HTMLInputElement && nonText.includes(element.type)))
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      .filter((element) => !element.closest('[aria-hidden="true"], [inert]') && element.getBoundingClientRect().height > 1)
      .map((element) => ({
        label: nameOf(element),
        kind: element instanceof HTMLInputElement ? `input[${element.type}]` : element.tagName.toLowerCase(),
        width: Math.round(element.getBoundingClientRect().width * 10) / 10,
      }));
  }, NON_TEXT_INPUT_TYPES);
  return disambiguateLabels(measured);
}

// axe-core is read only when axe runs, so a project that never turns it on does not need the package.
let axeSource: string | undefined;
function loadAxeSource(): string {
  axeSource ??= readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8');
  return axeSource;
}

// The page's accessibility violations under axe's default rules (what the atlas runs on stories), grouped by rule. Run
// after the screenshot, so the picture is what a person would have seen; injecting the script changes nothing visible.
async function runAxe(page: Page): Promise<AxeFinding[]> {
  // A driver that froze the page clock (a toast that must not fade before the shot) stops every timer, and axe waits on
  // timers: it would hang until the test times out. The picture is already taken, so let time run again. Only when a clock
  // was installed: `clock.resume()` on a page without one installs a fake clock itself (Date starts at 1970 and the timers
  // are rewired), which changes the page it is about to check. A toast whose timer runs out before axe finishes is not there
  // to be checked; none of the frozen states declares debt, so that can only miss a violation, never invent one.
  if (await page.evaluate(() => '__pwClock' in globalThis)) await page.clock.resume();
  await page.addScriptTag({ content: loadAxeSource() });
  const violations = await page.evaluate(async (): Promise<RawAxeViolation[]> => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: RawAxeViolation[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({ target: node.target })),
    }));
  });
  return summariseAxeViolations(violations);
}

async function maxChannelStdev(png: Buffer): Promise<number> {
  const { channels } = await sharp(png).stats();
  return Math.max(...channels.slice(0, 3).map((channel) => channel.stdev));
}

async function signatureOf(png: Buffer): Promise<number[]> {
  const cells = await sharp(png).greyscale().resize(SIGNATURE_WIDTH, SIGNATURE_HEIGHT, { fit: 'fill' }).raw().toBuffer();
  return [...cells];
}

function writeRecord(record: CaptureRecord): void {
  const path = runRecordPath(record.viewport, record.page, record.state);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record));
}

// Loads the app at this viewport, settles it and drives it to the state. Problems the page reports from here on are
// collected in `problems`.
async function boot(page: Page, viewport: Viewport, driver: Driver, problems: string[]): Promise<void> {
  watchForProblems(page, problems);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Optional seam in app.drivers.ts: install page.route stubs (third-party embeds) before the app loads.
  await (appDrivers as { beforeCapture?: (page: Page) => Promise<void> }).beforeCapture?.(page);
  await page.goto('/');
  await settlePage(page);
  await driver(page);
}

// Photographs the driven page at this viewport and checks it. Everything the page reported since the last capture (the
// load and the driving included, for the first) is this capture's. Returns the failures instead of throwing, so the caller
// can capture the remaining viewports before failing; the record and the screenshot are written either way, so the
// picture of a failure exists.
async function captureAt(page: Page, entry: StateEntry, viewport: Viewport, problems: string[]): Promise<string[]> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // A long page is shown whole by growing the viewport (Playwright's fullPage would stretch fixed elements).
  if (entry.fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height > 6000) problems.push(`fullPage: the page is ${height}px tall, beyond the 6000px cap - the capture would be cut off`);
    await page.setViewportSize({ width: viewport.width, height: Math.min(height, 6000) });
  }
  await settleFrames(page);
  // A pointer left over from the driver's last click paints a hover style on
  // whatever it rests on, and whether it lands before the shot is a race.
  if (entry.pointer !== 'keep') await page.mouse.move(viewport.width - 1, viewport.height - 1);

  const overflowPx = await measureHorizontalOverflow(page);
  const overflowYPx = await measureVerticalOverflow(page);
  const escapedAbsolutes = await findEscapedAbsolutes(page);
  const documentScroll = (appDrivers as { documentScroll?: DocumentScrollMode }).documentScroll;
  problems.push(...checkDocumentScroll(overflowYPx, escapedAbsolutes, documentScroll));
  // A control squeezed to a sliver shrinks instead of overflowing, so it needs its own check. Reported after the shot is
  // taken and recorded, so the picture of the failure exists.
  const controls = await measureTextControls(page);
  problems.push(...checkControlWidths(controls, entry.narrowControls, viewport.name));
  const axeDebt = (appDrivers as { axeDebt?: readonly AxeDebt[] }).axeDebt;
  const axeMode = resolveAxeMode(process.env.UI_AXE, axeDebt !== undefined);
  const png = await page.screenshot({
    path: `${screenshotDir(entry.page, entry.state)}/${viewport.name}.png`,
    animations: 'disabled',
    caret: 'hide',
    mask: entry.mask?.map((selector) => page.locator(selector)),
  });

  // Axe on the app's states (a story is checked by the atlas, a page never was). Reported after the screenshot is taken and
  // recorded, so the picture of the failure exists; the mode says whether a violation fails or is only counted.
  const axe = axeMode === 'off' ? undefined : await runAxe(page);
  if (axe && axeMode === 'gate') problems.push(...checkAxeFindings(axe, axeDebt ?? [], entry.page, entry.state, viewport.name));

  writeRecord({
    page: entry.page,
    state: entry.state,
    viewport: viewport.name,
    hash: createHash('sha256').update(png).digest('hex'),
    signature: await signatureOf(png),
    maxChannelStdev: await maxChannelStdev(png),
    overflowPx,
    overflowYPx,
    escapedAbsolutes,
    narrowestControlPx: controls.length > 0 ? Math.min(...controls.map((control) => control.width)) : null,
    ...(axe ? { axe } : {}),
  });

  const failures = problems.splice(0).map((problem) => `${viewport.name}: ${problem}`);
  if (overflowPx > OVERFLOW_TOLERANCE_PX) failures.push(`${viewport.name}: page scrolls sideways by ${overflowPx}px`);
  return failures;
}

function failOn(failures: string[]): void {
  expect(failures, 'the app reported problems while this state was captured').toEqual([]);
}

// One {state, viewport} capture: boot the app fresh, drive to the state, screenshot it, and fail on anything that makes the
// picture untrustworthy (a page error, a failed request, horizontal overflow). For a row with `reloadPerViewport`.
export async function captureState(page: Page, entry: StateEntry, viewport: Viewport, driver: Driver): Promise<void> {
  const problems: string[] = [];
  await boot(page, viewport, driver, problems);
  failOn(await captureAt(page, entry, viewport, problems));
}

// Every viewport of one state from one load: boot at the first viewport, drive once, then resize and capture at each of
// `shared`. The captures and checks are the ones captureState makes. Each of `fresh` (a row's extraViewports: a width where
// the layout switches, which a resize from a wide window does not reproduce, such as a tab strip scrolled to its active
// tab on load) gets a freshly loaded page of its own, in the same browser context. A driver that freezes the page clock
// cannot share a load or a context: axe lets time run again after the first shot (see runAxe), so the state moves on (a
// toast fades), and the fake clock belongs to the context, so a second page cannot freeze it again. Its row needs
// `reloadPerViewport`, and the test fails with that advice if it does not have it.
export async function captureAcrossViewports(page: Page, entry: StateEntry, shared: Viewport[], fresh: Viewport[], driver: Driver): Promise<void> {
  const viewports = [...shared, ...fresh];
  // Each capture is given the time a test of its own had.
  test.setTimeout(test.info().timeout * viewports.length);
  const failures: string[] = [];
  let current = page;
  let problems: string[] = [];
  for (const [index, viewport] of viewports.entries()) {
    await test.step(viewport.name, async () => {
      if (index === 0 || index >= shared.length) {
        if (index > 0) {
          if (current !== page) await current.close();
          current = await page.context().newPage();
          problems = [];
        }
        await boot(current, viewport, driver, problems);
        if (viewports.length > 1 && (await current.evaluate(() => '__pwClock' in globalThis))) {
          throw new Error(`${entry.page}/${entry.state}: the driver froze the page clock, so the row needs reloadPerViewport: true in state-catalog.ts`);
        }
      }
      failures.push(...(await captureAt(current, entry, viewport, problems)));
    });
  }
  failOn(failures);
}
