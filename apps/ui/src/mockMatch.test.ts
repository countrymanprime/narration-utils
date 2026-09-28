import { describe, expect, test } from 'vitest';
import {
  backgroundOf,
  colourDelta,
  compareImages,
  DEFAULT_THRESHOLD,
  fitTo,
  isAntiAliased,
  MATCH_BAR_PERCENT,
  type RgbaImage,
} from '../tests/visual/mock-match/compare';
import { APPROVED_MOCKS, mockPath, NOT_THE_SPEC, scoredMocks } from '../tests/visual/mock-match/mocks';
import { formatScoreTable, type MockScore } from '../tests/visual/mock-match/report';
import { APP_DRIVERS } from '../tests/visual/app.drivers';
import { existsSync } from 'node:fs';

// The pixel-match tool of mock-fidelity-primitives-and-components.prd.md Phase 0 (D91 on #509): the comparison is pure, so it
// is proved here on made-up images; the Playwright half (tests/visual/mock-match/mock-match.spec.ts) only captures and feeds it.

type Rgb = [number, number, number];

function solid(width: number, height: number, [r, g, b]: Rgb): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([r, g, b, 255], index);
  return { width, height, data };
}

function paint(image: RgbaImage, x: number, y: number, [r, g, b]: Rgb): void {
  image.data.set([r, g, b, 255], (y * image.width + x) * 4);
}

function fillRect(image: RgbaImage, x0: number, y0: number, w: number, h: number, colour: Rgb): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paint(image, x, y, colour);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

describe('compareImages', () => {
  test('identical images match 100%', () => {
    const image = solid(20, 10, [200, 120, 40]);
    const result = compareImages(image, solid(20, 10, [200, 120, 40]));
    expect(result.matchPercent).toBe(100);
    expect(result.different).toBe(0);
    expect(result.total).toBe(200);
  });

  test('a block of changed colour counts every pixel of it', () => {
    const mock = solid(10, 10, WHITE);
    const app = solid(10, 10, WHITE);
    fillRect(app, 0, 0, 10, 2, BLACK);
    const result = compareImages(mock, app);
    expect(result.different).toBe(20);
    expect(result.matchPercent).toBe(80);
  });

  test('a difference under the threshold matches, one over it does not', () => {
    // A 3-level grey step is compression noise; a token change (white to a warm off-white surface) is not.
    expect(compareImages(solid(4, 4, [250, 250, 250]), solid(4, 4, [247, 247, 247])).matchPercent).toBe(100);
    expect(compareImages(solid(4, 4, [255, 255, 255]), solid(4, 4, [214, 203, 186])).matchPercent).toBe(0);
  });

  test('a threshold of 0 counts any change and 1 forgives everything', () => {
    const mock = solid(4, 4, [250, 250, 250]);
    const app = solid(4, 4, [249, 250, 250]);
    expect(compareImages(mock, app, { threshold: 0 }).matchPercent).toBe(0);
    expect(compareImages(solid(4, 4, WHITE), solid(4, 4, BLACK), { threshold: 1 }).matchPercent).toBe(100);
  });

  test('refuses images of two sizes and a threshold outside 0 to 1', () => {
    expect(() => compareImages(solid(4, 4, WHITE), solid(5, 4, WHITE))).toThrow(/one size/);
    expect(() => compareImages(solid(4, 4, WHITE), solid(4, 4, WHITE), { threshold: 2 })).toThrow(/threshold/);
  });

  test('an anti-aliased edge a sub-pixel apart is forgiven unless asked to count it', () => {
    // A hard black block on white, and the same block whose left edge is grey (a rasteriser's half-covered column).
    const mock = solid(12, 12, WHITE);
    fillRect(mock, 4, 2, 4, 8, BLACK);
    const app = solid(12, 12, WHITE);
    fillRect(app, 4, 2, 4, 8, BLACK);
    for (let y = 2; y < 10; y++) paint(app, 3, y, [128, 128, 128]);
    const forgiving = compareImages(mock, app);
    expect(forgiving.different).toBe(0);
    expect(forgiving.antiAliased).toBeGreaterThan(0);
    const strict = compareImages(mock, app, { includeAntiAliasing: true });
    expect(strict.different).toBe(forgiving.antiAliased);
  });

  test('ink match judges only what is drawn, so an empty page cannot hide a missing element', () => {
    // A 100×100 white page whose only content, a 10×10 button, is missing from the app: 99% pixel match, 0% ink match.
    const mock = solid(100, 100, WHITE);
    fillRect(mock, 10, 10, 10, 10, [180, 70, 20]);
    const result = compareImages(mock, solid(100, 100, WHITE));
    expect(result.matchPercent).toBe(99);
    expect(result.inkMatchPercent).toBe(0);
  });

  test('the diff image marks a difference red and fades what matches', () => {
    const mock = solid(2, 1, WHITE);
    const app = solid(2, 1, WHITE);
    paint(app, 1, 0, BLACK);
    const { diff } = compareImages(mock, app);
    expect([...diff.subarray(4, 8)]).toEqual([230, 0, 40, 255]);
    expect(diff[0]).toBeGreaterThan(240);
  });
});

describe('the parts of the comparison', () => {
  test('colourDelta is 0 for one colour and brightness-weighted for black against white', () => {
    const pair = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(colourDelta(pair, pair, 0, 0)).toBe(0);
    // Black against white differs in brightness only: 0.5053 × 255².
    expect(Math.abs(colourDelta(pair, pair, 0, 4))).toBeCloseTo(32857, 0);
  });

  test('a transparent pixel is read as white', () => {
    const pair = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
    expect(colourDelta(pair, pair, 0, 4)).toBe(0);
  });

  test('a pixel inside a flat area is not anti-aliasing', () => {
    const flat = solid(5, 5, WHITE);
    expect(isAntiAliased(flat, 2, 2, flat)).toBe(false);
  });

  test('backgroundOf finds the most common colour', () => {
    const image = solid(50, 50, [30, 30, 30]);
    fillRect(image, 0, 0, 10, 10, WHITE);
    expect(backgroundOf(image)).toEqual([30, 30, 30]);
  });

  test('fitTo crops a larger capture from its top left and fills a smaller one with magenta', () => {
    const big = solid(4, 4, BLACK);
    paint(big, 0, 0, WHITE);
    const cropped = fitTo(big, 2, 2);
    expect(cropped.width).toBe(2);
    expect([...cropped.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    const padded = fitTo(solid(1, 1, BLACK), 2, 1);
    expect([...padded.data.subarray(4, 8)]).toEqual([255, 0, 255, 255]);
    expect(fitTo(big, 4, 4)).toBe(big);
  });

  test('the documented defaults', () => {
    expect(DEFAULT_THRESHOLD).toBe(0.1);
    expect(MATCH_BAR_PERCENT).toBe(90);
  });
});

describe('the approved-mock list', () => {
  test('every mock file exists and is listed once', () => {
    const files = APPROVED_MOCKS.map((mock) => mock.file);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) expect(existsSync(mockPath(file)), file).toBe(true);
  });

  test('a concept picture or copy is listed apart and never scored', () => {
    const approved = new Set(APPROVED_MOCKS.map((mock) => mock.file));
    for (const { file, why } of NOT_THE_SPEC) {
      expect(existsSync(mockPath(file)), file).toBe(true);
      expect(approved.has(file), file).toBe(false);
      expect(why, file).toMatch(/\S/);
    }
  });

  test('a scored mock names a state the visual suite can drive, and an unscored one says why', () => {
    for (const mock of APPROVED_MOCKS) {
      if (mock.target) {
        expect(APP_DRIVERS[mock.target.page]?.[mock.target.state], `${mock.file} -> ${mock.target.page}/${mock.target.state}`).toBeTypeOf('function');
      } else {
        expect(mock.unscored, mock.file).toMatch(/\S/);
      }
    }
    expect(scoredMocks().length).toBeGreaterThan(0);
  });
});

describe('formatScoreTable', () => {
  const score = (file: string, matchPercent: number): MockScore => ({
    file,
    target: 'production/on-pace',
    viewport: '1440×900',
    theme: 'light',
    matchPercent,
    inkMatchPercent: matchPercent - 20,
    diff: `screenshots/mock-match/${file}.diff.png`,
  });

  test('sorts worst first and marks the rows under the bar', () => {
    const table = formatScoreTable([score('a.webp', 95.5), score('b.webp', 71.25)]);
    const lines = table.split('\n');
    expect(lines[0]).toMatch(/^\| Mock \| Page\/state \| Viewport \| Theme \| Match % \| Ink match % \|/);
    expect(lines[2]).toContain('b.webp');
    expect(lines[2]).toContain('**71.25** (under 90)');
    expect(lines[3]).toContain('95.50');
  });
});
