// The pixel comparison behind `pnpm --dir apps/ui mock-match` (D91, D97 on #509): how much of an approved mock the app reproduces, as one number. Pure functions over RGBA buffers, so Vitest checks
// them (src/mockMatch.test.ts) without a browser.
//
// The algorithm is pixelmatch's (Mapbox, ISC), written out here rather than added as a dependency:
// - Two pixels match when their perceived colour difference is at most `threshold` of the largest possible one. The
//   difference is measured in YIQ space, weighted the way the eye weighs brightness over hue (Kotsarenko and Ramos,
//   "Measuring perceived color difference using YIQ NTSC transmission color space in mobile applications", 2010), after
//   blending each pixel onto white by its alpha.
// - A differing pixel that is anti-aliasing in either image is not counted (Vysniauskas, "Anti-aliased pixel and intensity
//   slope detector", 2009): a text edge rendered a sub-pixel apart by another rasteriser is not a design difference.

/** An image as raw RGBA, four bytes per pixel, row by row (what sharp's `.ensureAlpha().raw()` gives). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CompareOptions {
  /** 0 to 1: the share of the largest YIQ difference two pixels may differ by and still match. */
  threshold?: number;
  /** Count anti-aliased pixels as differences too (off by default, as in pixelmatch). */
  includeAntiAliasing?: boolean;
}

export interface CompareResult {
  width: number;
  height: number;
  total: number;
  /** Pixels that differ beyond the threshold and are not anti-aliasing. */
  different: number;
  /** Differing pixels forgiven as anti-aliasing. */
  antiAliased: number;
  /** 100 × matching / total, to two decimals. A diagnostic, not a gate (D97). */
  matchPercent: number;
  /**
   * The match over "ink" only: the pixels that are not the page background in at least one of the two images. A mostly empty
   * screen matches well on background alone, so this says how well the drawn parts (text, borders, fills) match. Reported
   * beside the match, never instead of it.
   */
  inkMatchPercent: number;
  /** A picture of the difference: the mock faded to grey, differences red, anti-aliasing yellow. */
  diff: Uint8Array;
}

/** The pixelmatch default: small enough to catch a changed token, large enough to ignore compression noise in a webp mock. */
export const DEFAULT_THRESHOLD = 0.1;

// The normalising constant of the YIQ difference (pixelmatch's): about the largest value `colourDelta` can return.
const MAX_YIQ_DELTA = 35215;

function blend(channel: number, alpha: number): number {
  return 255 + (channel - 255) * alpha;
}

function rgbAt(data: Uint8Array, index: number): [number, number, number] {
  const alpha = data[index + 3] / 255;
  return [blend(data[index], alpha), blend(data[index + 1], alpha), blend(data[index + 2], alpha)];
}

function toY(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function toI(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function toQ(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

/**
 * The squared YIQ difference between pixel `i` of `a` and pixel `j` of `b` (byte offsets). With `brightnessOnly`, the signed
 * brightness difference instead (positive when `a` is darker), which the anti-aliasing test uses.
 */
export function colourDelta(a: Uint8Array, b: Uint8Array, i: number, j: number, brightnessOnly = false): number {
  const [r1, g1, b1] = rgbAt(a, i);
  const [r2, g2, b2] = rgbAt(b, j);
  if (r1 === r2 && g1 === g2 && b1 === b2) return 0;
  const y = toY(r1, g1, b1) - toY(r2, g2, b2);
  if (brightnessOnly) return y;
  const iDelta = toI(r1, g1, b1) - toI(r2, g2, b2);
  const qDelta = toQ(r1, g1, b1) - toQ(r2, g2, b2);
  const delta = 0.5053 * y * y + 0.299 * iDelta * iDelta + 0.1957 * qDelta * qDelta;
  return y > 0 ? -delta : delta;
}

function samePixel(data: Uint8Array, i: number, j: number): boolean {
  return data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2] && data[i + 3] === data[j + 3];
}

// Whether the pixel at (x, y) has three or more identical neighbours (a flat area, not an edge).
function hasManySiblings(image: RgbaImage, x: number, y: number): boolean {
  const { width, height, data } = image;
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  const at = (y * width + x) * 4;
  let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  for (let nx = x0; nx <= x2; nx++) {
    for (let ny = y0; ny <= y2; ny++) {
      if (nx === x && ny === y) continue;
      if (samePixel(data, at, (ny * width + nx) * 4)) zeroes++;
      if (zeroes > 2) return true;
    }
  }
  return false;
}

/** Whether the pixel at (x, y) of `image` looks like anti-aliasing when compared with `other` (Vysniauskas 2009). */
export function isAntiAliased(image: RgbaImage, x: number, y: number, other: RgbaImage): boolean {
  const { width, height, data } = image;
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  const at = (y * width + x) * 4;
  let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (let nx = x0; nx <= x2; nx++) {
    for (let ny = y0; ny <= y2; ny++) {
      if (nx === x && ny === y) continue;
      const delta = colourDelta(data, data, at, (ny * width + nx) * 4, true);
      if (delta === 0) {
        zeroes++;
        // More than two identical neighbours: a flat area, not an edge.
        if (zeroes > 2) return false;
      } else if (delta < min) {
        min = delta;
        minX = nx;
        minY = ny;
      } else if (delta > max) {
        max = delta;
        maxX = nx;
        maxY = ny;
      }
    }
  }
  // An edge pixel has both a darker and a brighter neighbour.
  if (min === 0 || max === 0) return false;
  // ...and the darkest or the brightest of them sits in a flat area in both images.
  return (
    (hasManySiblings(image, minX, minY) && hasManySiblings(other, minX, minY)) || (hasManySiblings(image, maxX, maxY) && hasManySiblings(other, maxX, maxY))
  );
}

// The most common colour of an image, read on a coarse grid: the page background both images are judged against for ink.
export function backgroundOf(image: RgbaImage): [number, number, number] {
  const counts = new Map<number, number>();
  let best = 0;
  let bestKey = 0xffffff;
  const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 40_000)));
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const [r, g, b] = rgbAt(image.data, (y * image.width + x) * 4);
      const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count > best) {
        best = count;
        bestKey = key;
      }
    }
  }
  return [(bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff];
}

/**
 * Compares `actual` (the app) with `expected` (the mock). Both must be the same size: the caller captures at the mock's
 * own pixel size (D91), and pads or crops a capture that is not before comparing, so a size difference counts as different
 * pixels rather than being scaled away.
 */
export function compareImages(expected: RgbaImage, actual: RgbaImage, options: CompareOptions = {}): CompareResult {
  const { width, height } = expected;
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`compareImages needs images of one size: the mock is ${width}×${height}, the capture ${actual.width}×${actual.height}`);
  }
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`threshold must be between 0 and 1, got ${threshold}`);
  const maxDelta = MAX_YIQ_DELTA * threshold * threshold;
  const inkDelta = MAX_YIQ_DELTA * DEFAULT_THRESHOLD * DEFAULT_THRESHOLD;
  const expectedBackground = backgroundOf(expected);
  const actualBackground = backgroundOf(actual);
  const backgroundProbe = new Uint8Array(8);
  const diff = new Uint8Array(width * height * 4);
  let different = 0;
  let antiAliased = 0;
  let ink = 0;
  let inkDifferent = 0;

  const isInk = (image: RgbaImage, background: [number, number, number], index: number): boolean => {
    backgroundProbe.set(background, 4);
    backgroundProbe[7] = 255;
    const [r, g, b] = rgbAt(image.data, index);
    backgroundProbe.set([r, g, b, 255], 0);
    return Math.abs(colourDelta(backgroundProbe, backgroundProbe, 0, 4)) > inkDelta;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const delta = Math.abs(colourDelta(expected.data, actual.data, index, index));
      const inked = isInk(expected, expectedBackground, index) || isInk(actual, actualBackground, index);
      if (inked) ink++;
      let tone: [number, number, number];
      if (delta > maxDelta) {
        const forgiven = !options.includeAntiAliasing && (isAntiAliased(expected, x, y, actual) || isAntiAliased(actual, x, y, expected));
        if (forgiven) {
          antiAliased++;
          tone = [255, 200, 0];
        } else {
          different++;
          if (inked) inkDifferent++;
          tone = [230, 0, 40];
        }
      } else {
        const [r, g, b] = rgbAt(expected.data, index);
        const grey = 255 + (toY(r, g, b) - 255) * 0.15;
        tone = [grey, grey, grey];
      }
      diff[index] = tone[0];
      diff[index + 1] = tone[1];
      diff[index + 2] = tone[2];
      diff[index + 3] = 255;
    }
  }
  const total = width * height;
  const percent = (matching: number, of: number): number => (of === 0 ? 100 : Math.round((10_000 * matching) / of) / 100);
  return {
    width,
    height,
    total,
    different,
    antiAliased,
    matchPercent: percent(total - different, total),
    inkMatchPercent: percent(ink - inkDifferent, ink),
    diff,
  };
}

/** The `width × height` rectangle of `image` whose top-left corner is (x, y); it must lie inside the image. */
export function crop(image: RgbaImage, region: { x: number; y: number; width: number; height: number }): RgbaImage {
  const { x, y, width, height } = region;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > image.width || y + height > image.height) {
    throw new Error(`crop ${width}×${height} at (${x}, ${y}) lies outside the ${image.width}×${image.height} image`);
  }
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

/**
 * Fits a capture to the mock's size without scaling: the top-left `width × height` of it, and anything the capture lacks
 * filled with magenta, so a capture that is too small scores its missing area as different instead of being stretched.
 */
export function fitTo(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      if (x < image.width && y < image.height) {
        const from = (y * image.width + x) * 4;
        data.set(image.data.subarray(from, from + 4), to);
      } else {
        data.set([255, 0, 255, 255], to);
      }
    }
  }
  return { width, height, data };
}
