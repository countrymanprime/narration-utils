// Text-blind scoring for `pnpm --dir apps/ui mock-match` (owner ruling D97 on #509): the score is about layout, features and
// style, so different words at the same size, weight and position must not lower it. `flattenGlyphs` runs on the mock and on the
// capture before they are compared, and paints every glyph-like mark in the colour around it. What stays is what a design
// spec is made of: fills, cards, pills, borders and rules, and the spacing between them. Pure and deterministic (no random
// choice, no dependence on the machine), so Vitest checks it without a browser (src/mockMatch.test.ts).
//
// The method, in four steps:
// 1. Quantise each pixel to 4 bits per channel, and label the 4-connected areas of one quantised colour.
// 2. Measure each area: its bounding box, and its density (pixels over bounding-box area).
// 3. An area is a glyph mark when it is short (its bounding box is at most GLYPH_MAX_HEIGHT tall) and either sparse (density
//    under GLYPH_MAX_DENSITY, which is what strokes look like) or a speck (a few pixels: anti-aliasing, an i-dot, a full stop).
//    A rule or a border is thin and long, so it is kept; a pill, a badge, a bar or a filled dot is dense, so it is kept.
// 4. Each glyph mark is painted with the most common colour of the kept pixels within GLYPH_FILL_MARGIN pixels of it.
//
// What this costs: an outlined icon reads as a glyph and is flattened in both images, so an icon the app lacks is not scored.
// The raw pixel match stays in the report as `pixelMatchPercent`, so nothing is hidden.

import type { RgbaImage } from './compare';

/** The tallest bounding box (in pixels) a glyph mark may have: a 28 px heading with its descenders fits. */
export const GLYPH_MAX_HEIGHT = 32;
/** A mark denser than this is a fill (a badge, a pill, a bar), not strokes. */
export const GLYPH_MAX_DENSITY = 0.6;
/** A mark this small (pixels, and bounding-box side) is a speck whatever its density. */
export const SPECK_MAX_AREA = 24;
export const SPECK_MAX_SIDE = 8;
/** A line: at most this thick and at least this long. It is a border or a rule, and is kept. */
export const LINE_MAX_THICKNESS = 3;
export const LINE_MIN_LENGTH = 16;
/** How far around a glyph mark (pixels) to look for the colour to paint it with. */
export const GLYPH_FILL_MARGIN = 2;

function keyAt(data: Uint8Array, index: number): number {
  const alpha = data[index + 3] / 255;
  const channel = (value: number) => Math.round(255 + (value - 255) * alpha) >> 4;
  return (channel(data[index]) << 8) | (channel(data[index + 1]) << 4) | channel(data[index + 2]);
}

interface Area {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  size: number;
}

/** Labels the 4-connected areas of one quantised colour, scanning row by row so the numbering is the same on every run. */
function label(image: RgbaImage): { labels: Int32Array; areas: Area[] } {
  const { width, height, data } = image;
  const keys = new Uint16Array(width * height);
  for (let i = 0; i < keys.length; i++) keys[i] = keyAt(data, i * 4);
  const labels = new Int32Array(width * height).fill(-1);
  const areas: Area[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1) continue;
    const id = areas.length;
    const key = keys[start];
    const area: Area = { minX: width, minY: height, maxX: 0, maxY: 0, size: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    while (top > 0) {
      const at = stack[--top];
      const x = at % width;
      const y = (at - x) / width;
      area.size++;
      if (x < area.minX) area.minX = x;
      if (x > area.maxX) area.maxX = x;
      if (y < area.minY) area.minY = y;
      if (y > area.maxY) area.maxY = y;
      if (x > 0 && labels[at - 1] === -1 && keys[at - 1] === key) {
        labels[at - 1] = id;
        stack[top++] = at - 1;
      }
      if (x < width - 1 && labels[at + 1] === -1 && keys[at + 1] === key) {
        labels[at + 1] = id;
        stack[top++] = at + 1;
      }
      if (y > 0 && labels[at - width] === -1 && keys[at - width] === key) {
        labels[at - width] = id;
        stack[top++] = at - width;
      }
      if (y < height - 1 && labels[at + width] === -1 && keys[at + width] === key) {
        labels[at + width] = id;
        stack[top++] = at + width;
      }
    }
    areas.push(area);
  }
  return { labels, areas };
}

/** Whether an area is a glyph mark (see the header, step 3). */
export function isGlyphMark(area: Pick<Area, 'minX' | 'minY' | 'maxX' | 'maxY' | 'size'>): boolean {
  const width = area.maxX - area.minX + 1;
  const height = area.maxY - area.minY + 1;
  if (Math.min(width, height) <= LINE_MAX_THICKNESS && Math.max(width, height) >= LINE_MIN_LENGTH) return false;
  if (area.size <= SPECK_MAX_AREA && Math.max(width, height) <= SPECK_MAX_SIDE) return true;
  return height <= GLYPH_MAX_HEIGHT && area.size / (width * height) < GLYPH_MAX_DENSITY;
}

/** A copy of `image` with every glyph mark painted in the colour around it. The input is not changed. */
export function flattenGlyphs(image: RgbaImage): RgbaImage {
  const { width, height } = image;
  const { labels, areas } = label(image);
  const glyph = areas.map(isGlyphMark);
  const data = new Uint8Array(image.data);
  for (let id = 0; id < areas.length; id++) {
    if (!glyph[id]) continue;
    const area = areas[id];
    const x0 = Math.max(0, area.minX - GLYPH_FILL_MARGIN);
    const x1 = Math.min(width - 1, area.maxX + GLYPH_FILL_MARGIN);
    const y0 = Math.max(0, area.minY - GLYPH_FILL_MARGIN);
    const y1 = Math.min(height - 1, area.maxY + GLYPH_FILL_MARGIN);
    const counts = new Map<number, { count: number; at: number }>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const at = y * width + x;
        if (glyph[labels[at]]) continue;
        const key = keyAt(image.data, at * 4);
        const seen = counts.get(key);
        if (seen) seen.count++;
        else counts.set(key, { count: 1, at });
      }
    }
    let best: { count: number; at: number } | undefined;
    for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
    if (!best) continue;
    const from = best.at * 4;
    for (let y = area.minY; y <= area.maxY; y++) {
      for (let x = area.minX; x <= area.maxX; x++) {
        const at = y * width + x;
        if (labels[at] !== id) continue;
        data.set(image.data.subarray(from, from + 4), at * 4);
      }
    }
  }
  return { width, height, data };
}
