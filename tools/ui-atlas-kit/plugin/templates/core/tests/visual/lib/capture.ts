// ui-atlas-kit 0.3.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import * as appDrivers from '../app.drivers';
import type { Driver } from '../app.drivers';
import { runRecordPath, screenshotDir, settleFrames, settlePage } from '../helpers/settle';
import type { Viewport } from '../viewports';
import type { StateEntry } from './types';
import { OVERFLOW_TOLERANCE_PX, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type CaptureRecord } from './validators';

function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
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
  return problems;
}

async function measureHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
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

// One {state, viewport} capture: boot the app fresh, drive to the state,
// screenshot it, and fail on anything that makes the picture untrustworthy
// (a page error, a failed request, horizontal overflow).
export async function captureState(page: Page, entry: StateEntry, viewport: Viewport, driver: Driver): Promise<void> {
  const problems = watchForProblems(page);

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Optional seam in app.drivers.ts: install page.route stubs (third-party embeds) before the app loads.
  await (appDrivers as { beforeCapture?: (page: Page) => Promise<void> }).beforeCapture?.(page);
  await page.goto('/');
  await settlePage(page);
  await driver(page);
  // A long page is shown whole by growing the viewport (Playwright's fullPage would stretch fixed elements).
  if (entry.fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height: Math.min(height, 6000) });
  }
  await settleFrames(page);
  // A pointer left over from the driver's last click paints a hover style on
  // whatever it rests on, and whether it lands before the shot is a race.
  if (entry.pointer !== 'keep') await page.mouse.move(viewport.width - 1, viewport.height - 1);

  const overflowPx = await measureHorizontalOverflow(page);
  const png = await page.screenshot({
    path: `${screenshotDir(entry.page, entry.state)}/${viewport.name}.png`,
    animations: 'disabled',
    caret: 'hide',
    mask: entry.mask?.map((selector) => page.locator(selector)),
  });

  writeRecord({
    page: entry.page,
    state: entry.state,
    viewport: viewport.name,
    hash: createHash('sha256').update(png).digest('hex'),
    signature: await signatureOf(png),
    maxChannelStdev: await maxChannelStdev(png),
    overflowPx,
  });

  expect(problems, 'the app reported problems while this state was captured').toEqual([]);
  expect(overflowPx, `page scrolls sideways by ${overflowPx}px at ${viewport.name}`).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
}
