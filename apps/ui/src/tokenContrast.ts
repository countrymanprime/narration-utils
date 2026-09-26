// Colour arithmetic for the palette contrast guard (paletteContrast.test.ts, ADR 0059). It reads the design tokens out of
// styles.css and evaluates the few colour forms the tokens use (hex, transparent, rgba, var(), and color-mix in sRGB), so a
// contrast ratio is computed from the CSS that ships and not from a copy of its values. Anything else throws: a pair the
// guard cannot evaluate must not pass by being skipped.

export type Theme = 'light' | 'dark' | 'booth';
export type TokenMap = Record<string, string>;
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const MAX_VAR_DEPTH = 12;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function declarations(block: string): TokenMap {
  const tokens: TokenMap = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) tokens[match[1].slice(2)] = match[2].trim();
  return tokens;
}

export interface RootRule {
  dark: boolean;
  tokens: TokenMap;
}

// The `:root` and `:root[data-theme='dark']` rules the parser can see, in source order.
export function rootRules(css: string): RootRule[] {
  return [...stripComments(css).matchAll(/(?<=^|\})\s*(:root(?:\[data-theme=['"]dark['"]\])?)\s*\{([^}]*)\}/g)].map((match) => ({
    dark: match[1] !== ':root',
    tokens: declarations(match[2]),
  }));
}

// Light values are every `:root` block in order; dark is the light set overlaid with `:root[data-theme='dark']`, which wins
// on specificity wherever it sits in the file (ADR 0010). Inline overrides from the user's colour settings are not tokens
// here: they replace a value at run time and are out of the guard's reach (ADR 0059).
export function parseThemes(css: string): Record<Theme, TokenMap> {
  const light: TokenMap = {};
  const darkOverrides: TokenMap = {};
  for (const rule of rootRules(css)) Object.assign(rule.dark ? darkOverrides : light, rule.tokens);
  const dark = { ...light, ...darkOverrides };
  const booth = { ...dark, ...boothTokens(css) };
  return { light, dark, booth };
}

// The number of rules in the file whose selector mentions `:root`, whatever the rest of it says, so a rule the parser above
// cannot see (nested in a layer, `:root:not([data-theme='light'])`, `html:root`) fails a test instead of quietly dropping
// its tokens.
export function countRootRules(css: string): number {
  return (stripComments(css).match(/:root[^{}]*\{/g) ?? []).length;
}

// The `[data-surface='booth']` block (studio-ui-primitives.prd.md Phase 1, ADR 0360 Q1): FocusShell's own high-contrast
// palette, scoped to a data attribute rather than a third app theme. It lists only the tokens booth mode changes; every
// other token falls through to dark (see `parseThemes`), the way `:root[data-theme='dark']` falls through to light.
export function boothTokens(css: string): TokenMap {
  const match = /(?<=^|\})\s*\[data-surface=(['"])booth\1\]\s*\{([^}]*)\}/.exec(stripComments(css));
  return match ? declarations(match[2]) : {};
}

// The number of rules whose selector mentions the booth surface, whatever the rest of it says, so a selector the parser
// above cannot see fails a test instead of silently returning an empty map.
export function countBoothBlocks(css: string): number {
  return (stripComments(css).match(/\[data-surface=['"]booth['"]\][^{}]*\{/g) ?? []).length;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++;
    else if (text[index] === ')') depth--;
    else if (text[index] === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

function functionArguments(expression: string, name: string): string | undefined {
  const prefix = `${name}(`;
  return expression.startsWith(prefix) && expression.endsWith(')') ? expression.slice(prefix.length, -1) : undefined;
}

function hexColor(text: string): Rgba | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (!match) return undefined;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  const channel = (index: number) => parseInt(digits.slice(index, index + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
}

// `color-mix(in srgb, A p%, B q%)`: the percentages default to the remainder, are rescaled when they do not sum to 100%,
// and a sum below 100% scales the result's alpha. Channels mix premultiplied by alpha, as the CSS specification says, which
// is what makes a mix with `transparent` keep the colour and only lower its alpha.
function mixColors(argumentText: string, lookup: (name: string) => string, depth: number): Rgba {
  const [space, ...operands] = splitTopLevel(argumentText);
  if (space !== 'in srgb' || operands.length !== 2) throw new Error(`only color-mix(in srgb, A, B) can be evaluated, got: ${argumentText}`);
  const parsed = operands.map((operand) => {
    const match = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(operand)!;
    return { color: parseColor(match[1].trim(), lookup, depth + 1), percent: match[2] === undefined ? undefined : Number(match[2]) };
  });
  const [first, second] = parsed;
  const p1 = first.percent ?? (second.percent === undefined ? 50 : 100 - second.percent);
  const p2 = second.percent ?? 100 - p1;
  const sum = p1 + p2;
  if (p1 < 0 || p2 < 0 || sum <= 0) throw new Error(`color-mix percentages must be positive, got: ${argumentText}`);
  const w1 = p1 / sum;
  const w2 = p2 / sum;
  const alpha = first.color.a * w1 + second.color.a * w2;
  const mixChannel = (key: 'r' | 'g' | 'b') => (alpha === 0 ? 0 : (first.color[key] * first.color.a * w1 + second.color[key] * second.color.a * w2) / alpha);
  return { r: Math.round(mixChannel('r')), g: Math.round(mixChannel('g')), b: Math.round(mixChannel('b')), a: alpha * Math.min(1, sum / 100) };
}

export function parseColor(expression: string, lookup: (name: string) => string, depth = 0): Rgba {
  if (depth > MAX_VAR_DEPTH) throw new Error(`colour expression nests too deeply (a var() cycle?): ${expression}`);
  const text = expression.trim();
  const hex = hexColor(text);
  if (hex) return hex;
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const variable = functionArguments(text, 'var');
  if (variable !== undefined) {
    const name = variable.trim().replace(/^--/, '');
    const value = lookup(name);
    if (value === undefined) throw new Error(`token --${name} is not defined`);
    return parseColor(value, lookup, depth + 1);
  }
  const rgba = functionArguments(text, 'rgba') ?? functionArguments(text, 'rgb');
  if (rgba !== undefined) {
    const channels = splitTopLevel(rgba).map(Number);
    if (channels.length < 3 || channels.length > 4 || channels.some((channel) => !Number.isFinite(channel)))
      throw new Error(`only rgb(r, g, b) and rgba(r, g, b, a) with plain numbers can be evaluated, got: ${expression}`);
    const [r, g, b, a] = channels;
    return { r, g, b, a: a ?? 1 };
  }
  const mix = functionArguments(text, 'color-mix');
  if (mix !== undefined) return mixColors(mix, lookup, depth);
  throw new Error(`cannot evaluate colour: ${expression}`);
}

function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return 0.2126 * channelLuminance(color.r) + 0.7152 * channelLuminance(color.g) + 0.0722 * channelLuminance(color.b);
}

// WCAG 2.x contrast ratio, from 1 (identical) to 21 (black on white).
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function compositeOver(top: Rgba, under: Rgb): Rgb {
  const blend = (key: 'r' | 'g' | 'b') => Math.round(top[key] * top.a + under[key] * (1 - top.a));
  return { r: blend('r'), g: blend('g'), b: blend('b') };
}

export interface PairRequest {
  // The mark's colour (text, or a non-text mark such as an underline): any colour expression the tokens use.
  fg: string;
  // A translucent or solid fill the mark sits on, drawn over `over`. Omit it when the mark sits on `over` itself.
  bg?: string;
  // The token name of the opaque surface underneath (`surface`, `surface-3`, `row-alt`, ...).
  over: string;
}

// The contrast ratio of one pair in one theme's tokens, with the fill composited over its surface and the mark composited
// over the fill, the way the browser paints it.
export function resolveContrast(tokens: TokenMap, request: PairRequest): number {
  const lookup = (name: string) => tokens[name];
  const surface = compositeOver(parseColor(`var(--${request.over})`, lookup), { r: 0, g: 0, b: 0 });
  const background = request.bg === undefined ? surface : compositeOver(parseColor(request.bg, lookup), surface);
  return contrastRatio(compositeOver(parseColor(request.fg, lookup), background), background);
}
