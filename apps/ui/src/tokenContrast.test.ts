// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { contrastRatio, countRootRules, parseColor, parseThemes, resolveContrast, rootRules } from './tokenContrast';

// The palette guard (paletteContrast.test.ts) is only as good as its arithmetic, so the arithmetic is checked against
// values that can be verified by hand or against a browser: the WCAG extremes, CSS's own colour-mix rules, and the
// numbers the palette PRD measured with an independent script.

describe('parseColor', () => {
  it('reads hex, transparent and rgba', () => {
    expect(parseColor('#fff', () => '')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#211e17', () => '')).toEqual({ r: 33, g: 30, b: 23, a: 1 });
    expect(parseColor('transparent', () => '')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgba(20, 17, 12, 0.42)', () => '')).toEqual({ r: 20, g: 17, b: 12, a: 0.42 });
  });

  it('follows var() references, including a var that holds a colour-mix', () => {
    const tokens: Record<string, string> = { a: '#000000', b: 'color-mix(in srgb, var(--a) 50%, #ffffff)' };
    expect(parseColor('var(--b)', (name) => tokens[name])).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });

  it('mixes in sRGB with the second colour taking the remainder', () => {
    expect(parseColor('color-mix(in srgb, #ff0000 25%, #0000ff)', () => '')).toEqual({ r: 64, g: 0, b: 191, a: 1 });
  });

  it('mixes with transparent by scaling alpha and keeping the colour (premultiplied)', () => {
    expect(parseColor('color-mix(in srgb, #3c7a5c 20%, transparent)', () => '')).toEqual({ r: 60, g: 122, b: 92, a: 0.2 });
  });

  it('refuses what it cannot evaluate instead of guessing', () => {
    expect(() => parseColor('oklch(0.5 0.1 200)', () => '')).toThrow(/oklch/);
    expect(() => parseColor('var(--missing)', () => undefined as unknown as string)).toThrow(/missing/);
    expect(() => parseColor('color-mix(in oklab, #000 50%, #fff)', () => '')).toThrow(/srgb/);
    expect(() => parseColor('rgb(0 0 0 / 40%)', () => '')).toThrow(/plain numbers/);
    expect(() => parseColor('rgba(0, 0, 0, 40%)', () => '')).toThrow(/plain numbers/);
    expect(() => parseColor('color-mix(in srgb, #000 0%, #fff 0%)', () => '')).toThrow(/positive/);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself, in either order', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('matches the ratios the palette PRD measured for the shipped light tokens', () => {
    const tokens = { text: '#211e17', muted: '#6e6959', surface: '#ffffff', 'surface-3': '#dcd8cd' };
    const ratio = (fg: string, bg: string) =>
      contrastRatio(
        parseColor(fg, () => ''),
        parseColor(bg, () => ''),
      );
    expect(ratio(tokens.text, tokens.surface)).toBeCloseTo(16.63, 1);
    expect(ratio(tokens.muted, tokens.surface)).toBeCloseTo(5.49, 1);
    expect(ratio(tokens.muted, tokens['surface-3'])).toBeCloseTo(3.85, 1);
  });
});

describe('parseThemes', () => {
  const css = `
    /* comment with --fake: #123456; */
    :root { --a: #111111; --b: var(--a); color-scheme: light; }
    @layer base { body { color: var(--a); } }
    :root[data-theme='dark'] { --a: #eeeeee; }
    :root { --c: #222222; }
  `;

  it('keeps every :root block for light and lets the dark block override, whatever the source order', () => {
    const { light, dark } = parseThemes(css);
    expect(light).toEqual({ a: '#111111', b: 'var(--a)', c: '#222222' });
    expect(dark).toEqual({ a: '#eeeeee', b: 'var(--a)', c: '#222222' });
  });

  it('keeps a last declaration that has no trailing semicolon, and reads either quote in the dark selector', () => {
    const { light, dark } = parseThemes(':root { --a: #111111 } :root[data-theme="dark"] { --a: #eeeeee }');
    expect(light).toEqual({ a: '#111111' });
    expect(dark).toEqual({ a: '#eeeeee' });
  });

  it('counts a root rule the parser cannot read, so the guard fails instead of measuring stale tokens', () => {
    const css = ":root { --a: #111; } :root:not([data-theme='light']) { --a: #eee; } html:root { --b: #222; }";
    expect(rootRules(css)).toHaveLength(1);
    expect(countRootRules(css)).toBe(3);
  });

  it('resolves a token through the theme it is read in', () => {
    const { light, dark } = parseThemes(css);
    expect(resolveContrast(light, { fg: 'var(--b)', over: 'a' })).toBeCloseTo(1, 5);
    expect(resolveContrast(dark, { fg: 'var(--b)', bg: '#000000', over: 'a' })).toBeGreaterThan(15);
  });

  it('composites a translucent background over the surface before measuring', () => {
    // 20% black over white is #cccccc; black text on it is 13.08:1, not the 21:1 of black on white.
    const { light } = parseThemes(':root { --s: #ffffff; }');
    const ratio = resolveContrast(light, { fg: '#000000', bg: 'color-mix(in srgb, #000000 20%, transparent)', over: 's' });
    expect(ratio).toBeCloseTo(13.08, 1);
  });
});
