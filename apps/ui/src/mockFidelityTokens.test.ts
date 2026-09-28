// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseThemes } from './tokenContrast';

// The mock fidelity token batch (mock-fidelity-primitives-and-components.prd.md Phase 0b, ADR 0590). The sizes and type were
// measured on the benchmark mocks at 1440 px, and phases 1-15 build the primitives on them, so a value that drifts from the
// measurement moves every consumer away from the mocks at once. The colours are held by paletteContrast.test.ts.
const THEMES = parseThemes(readFileSync(join(__dirname, 'styles.css'), 'utf8'));

const ROOT_PX = 16;

// Token and its measured size in px at the default root size.
const SIZES: Record<string, number> = {
  'radius-button': 6,
  'radius-card': 8,
  'radius-tag': 3,
  'button-height': 32,
  'button-height-sm': 28,
  'row-height': 34,
  'header-row-height': 31,
  'font-size-page-title': 26,
  'font-size-card-title': 19,
  'font-size-label': 11,
  'font-size-booth-script': 26,
};

const TRACKING: Record<string, string> = {
  'tracking-label': '0.1em',
  'tracking-button': '0.06em',
};

function px(value: string | undefined): number {
  const match = /^([\d.]+)rem$/.exec(value ?? '');
  if (!match) throw new Error(`${value} is not a rem size`);
  return Number(match[1]) * ROOT_PX;
}

describe('the mock fidelity sizes and type (Phase 0b)', () => {
  for (const [token, expected] of Object.entries(SIZES)) {
    it(`--${token} is ${expected}px, in rem, the same in both themes`, () => {
      expect(px(THEMES.light[token])).toBe(expected);
      expect(THEMES.dark[token]).toBe(THEMES.light[token]);
    });
  }

  for (const [token, expected] of Object.entries(TRACKING)) {
    it(`--${token} is ${expected}`, () => {
      expect(THEMES.light[token]).toBe(expected);
      expect(THEMES.dark[token]).toBe(expected);
    });
  }

  it("draws the booth script on mock 03's 48px line", () => {
    const line = Number(THEMES.light['line-height-booth-script']) * px(THEMES.light['font-size-booth-script']);
    expect(Math.round(line)).toBe(48);
  });
});

describe('the mock fidelity colours (Phase 0b)', () => {
  it('declares every colour token, in both themes', () => {
    const colours = [
      'ok-soft',
      'warn-soft',
      'info-soft',
      'danger-soft',
      'row-selected',
      'reading-bg',
      'rec-fill',
      'rec-text',
      'toast-bg',
      'toast-text',
      'waveform',
      'ok-zone',
    ];
    for (const theme of ['light', 'dark'] as const) {
      expect(colours.filter((token) => !THEMES[theme][token])).toEqual([]);
    }
  });

  it('gives the booth a darker reading surface in dark only, without forcing a theme (ADR 0365)', () => {
    expect(THEMES.light['reading-bg']).toBe('var(--surface)');
    expect(THEMES.dark['reading-bg']).toBe('#0e0d09');
  });
});
