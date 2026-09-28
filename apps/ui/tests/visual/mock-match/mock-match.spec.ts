import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp, { type Sharp } from 'sharp';
import { THEME_STORAGE_KEY } from '../../../src/theme/theme';
import { APP_DRIVERS } from '../app.drivers';
import { settleFrames, settlePage } from '../helpers/settle';
import { STATE_CATALOG } from '../state-catalog';
import { compareImages, fitTo, MATCH_BAR_PERCENT, type RgbaImage } from './compare';
import { mockPath, scoredMocks, slugOf, type ApprovedMock } from './mocks';
import type { MockScore } from './report';

// Scores the app against every approved mock that has a target (mocks.ts): loads the app at the mock's own pixel size in the
// mock's theme, drives it to the mock's state with the visual suite's own driver, photographs the viewport and compares it with
// the mock (compare.ts). Writes screenshots/mock-match/<mock>.{app,diff}.png and <mock>.json, and global-teardown.ts gathers
// the records into scores.md. `pnpm --dir apps/ui mock-match`; `-g "<mock file>"` scores one.
//
// A score under the D91 bar is reported, not failed, so one run measures every state; MOCK_MATCH_ENFORCE=1 fails a state under
// the bar (the setting a phase of mock-fidelity-primitives-and-components.prd.md runs for the states it owns).

export const OUT_DIR = 'screenshots/mock-match';

async function decode(input: Sharp): Promise<RgbaImage> {
  const { data, info } = await input.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

async function loadMock(mock: ApprovedMock): Promise<RgbaImage> {
  const image = sharp(mockPath(mock.file));
  if (!mock.mockRegion) return decode(image);
  const { x, y, width, height } = mock.mockRegion;
  return decode(image.extract({ left: x, top: y, width, height }));
}

async function capture(page: Page, mock: ApprovedMock & { target: { page: string; state: string } }, size: { width: number; height: number }) {
  const driver = APP_DRIVERS[mock.target.page][mock.target.state];
  const row = STATE_CATALOG.find((entry) => entry.page === mock.target.page && entry.state === mock.target.state);
  const viewport = mock.viewport ?? size;
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_STORAGE_KEY, mock.theme] as const);
  await page.setViewportSize(viewport);
  await page.goto('/');
  await settlePage(page);
  await driver(page);
  await settleFrames(page);
  // Park the pointer off the page, as the visual suite does, unless the state is a hover.
  if (row?.pointer !== 'keep') await page.mouse.move(viewport.width - 1, viewport.height - 1);
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

for (const mock of scoredMocks()) {
  test(mock.file, async ({ page }) => {
    const expected = await loadMock(mock);
    const png = await capture(page, mock, { width: expected.width, height: expected.height });
    const actual = fitTo(await decode(sharp(png)), expected.width, expected.height);
    const result = compareImages(expected, actual);
    const slug = slugOf(mock.file);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/${slug}.app.png`, png);
    await sharp(Buffer.from(result.diff), { raw: { width: result.width, height: result.height, channels: 4 } })
      .png()
      .toFile(`${OUT_DIR}/${slug}.diff.png`);
    const score: MockScore = {
      file: mock.file,
      target: `${mock.target.page}/${mock.target.state}`,
      viewport: `${expected.width}×${expected.height}`,
      theme: mock.theme,
      matchPercent: result.matchPercent,
      inkMatchPercent: result.inkMatchPercent,
      diff: `apps/ui/${OUT_DIR}/${slug}.diff.png`,
    };
    writeFileSync(`${OUT_DIR}/${slug}.json`, JSON.stringify(score));
    test.info().annotations.push({ type: 'match', description: `${result.matchPercent}% (ink ${result.inkMatchPercent}%)` });
    if (process.env.MOCK_MATCH_ENFORCE === '1') {
      expect(result.matchPercent, `${mock.file} against ${score.target}`).toBeGreaterThanOrEqual(MATCH_BAR_PERCENT);
    }
  });
}
