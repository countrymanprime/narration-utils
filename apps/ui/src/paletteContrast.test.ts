// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countRootRules, parseThemes, resolveContrast, rootRules, type Theme, type TokenMap } from './tokenContrast';

// The palette guard (ADR 0059). It reads the tokens out of styles.css, in both themes, and asserts that every colour pair
// the app draws meets WCAG 2.x: 4.5:1 for text (SC 1.4.3) and 3:1 for the marks that carry meaning without being text
// (SC 1.4.11: the highlight underline, category dots, icons). A pair is one foreground and, where there is one, the fill it
// sits on, measured over every surface it can appear on and composited the way the browser paints it (a `color-mix(...
// transparent)` tint is laid over the surface first, so a highlight on a banded reader row is judged on the darker row).
//
// KNOWN_FAILURES is the explicit ratchet of pairs that fail today. Each recolouring phase fixes its pairs, deletes their
// entries, and lowers MAX_KNOWN_FAILURES; an entry whose pair now passes fails this test until it is deleted, so the list
// can only shrink and a fix cannot be forgotten. Adding an entry needs the same review as an `A11Y_DEBT` entry.

const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8');
const THEMES = parseThemes(CSS);
const THEME_NAMES: Theme[] = ['light', 'dark'];

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'row-alt'] as const;
const PAGE_SURFACES = ['bg', 'surface', 'surface-2'] as const;
const READING_SURFACES = ['surface', 'row-alt'] as const;

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

interface PairSpec {
  id: string;
  min: number;
  fg: string;
  bg?: string;
  over: readonly string[];
  // Where the pair is drawn, for the failure message.
  where: string;
}

const text = (id: string, where: string, fg: string, over: readonly string[], bg?: string): PairSpec => ({ id, min: TEXT_MIN, fg, bg, over, where });
const mark = (id: string, where: string, fg: string, over: readonly string[], bg?: string): PairSpec => ({ id, min: NON_TEXT_MIN, fg, bg, over, where });

const tint = (token: string, percent: number) => `color-mix(in srgb, var(--${token}) ${percent}%, transparent)`;

// The entity colours, as a token name apiece. `note` is drawn in the text colour on its own tint, so it has no text pair of
// its own kind here; see highlight-note below.
const KINDS = ['character', 'place', 'org', 'review', 'lore', 'item', 'event'] as const;

const PAIRS: PairSpec[] = [
  text('text', 'body text', 'var(--text)', SURFACES),
  text('text-muted', 'secondary text, labels, helper text', 'var(--text-muted)', SURFACES),
  text('text-faint', 'section labels, counts, placeholders (Option B retires this as text)', 'var(--text-faint)', SURFACES),
  text('toast', 'Toast: page colour on the text colour', 'var(--bg)', ['surface'], 'var(--text)'),
  text('on-accent', 'primary button and logo: accent-contrast on accent', 'var(--accent-contrast)', ['surface'], 'var(--accent)'),
  text('on-accent-strong', 'primary button hover: accent-contrast on accent-strong', 'var(--accent-contrast)', ['surface'], 'var(--accent-strong)'),
  text('accent-link', 'the Reset link and other accent text on the page', 'var(--accent)', ['surface']),
  text('accent-strong', 'active sort header, alias text, table header on the page', 'var(--accent-strong)', SURFACES),
  text('accent-strong-on-soft', 'notice and chip text: accent-strong on accent-soft', 'var(--accent-strong)', ['surface'], 'var(--accent-soft)'),
  text(
    'nav-active',
    'active navigation item: accent on a 10% accent tint',
    'var(--accent)',
    ['surface'],
    'color-mix(in srgb, var(--accent) 10%, var(--surface))',
  ),
  text(
    'tab-active',
    'active Settings category: accent-strong on a 10% accent tint',
    'var(--accent-strong)',
    ['surface'],
    'color-mix(in srgb, var(--accent) 10%, var(--surface))',
  ),
  text('danger', 'danger button, field error, red confirm', 'var(--danger)', PAGE_SURFACES),
  text('danger-on-soft', 'danger button hover: danger on review-soft', 'var(--danger)', ['surface'], 'var(--review-soft)'),
  text('warn', 'the warn text in Settings and the Results status', 'var(--warn)', ['surface']),
  text('warn-on-tint', 'Results badge: warn on an 18% warn tint', 'var(--warn)', ['surface'], tint('warn', 18)),
  text('warn-on-accent-soft', 'SKIPPED word in the inline diff: warn on accent-soft', 'var(--warn)', ['surface-2'], 'var(--accent-soft)'),
  text('info-on-place-soft', 'EXTRA word in the inline diff: info on place-soft', 'var(--info)', ['surface-2'], 'var(--place-soft)'),
  text(
    'review-on-soft',
    'MISREAD word, alert and last-completed badge: review on review-soft',
    'var(--review)',
    ['surface', 'surface-2'],
    'var(--review-soft)',
  ),
  ...KINDS.map((kind) =>
    text(`highlight-${kind}`, `Highlight (${kind}): the kind colour on its own 20% tint`, `var(--${kind})`, READING_SURFACES, tint(kind, 20)),
  ),
  text('highlight-note', 'Highlight (note): the text colour on the note tint', 'var(--text)', READING_SURFACES, tint('note', 20)),
  text('badge-character', 'entity badge (Character)', 'var(--character)', ['surface'], 'var(--character-soft)'),
  text('badge-place', 'entity badge (Place)', 'var(--place)', ['surface'], 'var(--place-soft)'),
  text('badge-org', 'entity badge (Organization)', 'var(--org)', ['surface'], 'var(--org-soft)'),
  text('badge-review', 'entity badge (Review)', 'var(--review)', ['surface'], 'var(--review-soft)'),
  ...(['lore', 'item', 'event'] as const).map((kind) =>
    text(
      `badge-${kind}`,
      `entity badge (${kind}): the kind colour on an 18% mix into the surface`,
      `var(--${kind})`,
      ['surface'],
      `color-mix(in srgb, var(--${kind}) 18%, var(--surface))`,
    ),
  ),
  ...[...KINDS, 'note'].map((kind) => mark(`mark-${kind}`, `the ${kind} highlight underline and category dot`, `var(--${kind})`, READING_SURFACES)),
];

interface KnownFailure {
  themes: Theme[];
  fixedBy: string;
}

// Every entry names the phase of docs/prds/palette-contrast-wcag-aa.prd.md that fixes it.
const both: Theme[] = ['light', 'dark'];
const lightOnly: Theme[] = ['light'];
const known = (fixedBy: string, themes: Theme[], ids: string[]): Record<string, KnownFailure> => Object.fromEntries(ids.map((id) => [id, { themes, fixedBy }]));

const KNOWN_FAILURES: Record<string, KnownFailure> = {
  ...known('phase 2 (text ramp)', lightOnly, ['text-muted']),
  ...known('phase 2 (--text-faint is retired as text)', both, ['text-faint']),
  ...known('phase 3 (active navigation)', lightOnly, ['nav-active']),
  ...known('phase 4 (derived on-tint text and the dark category tokens)', both, [
    ...KINDS.map((kind) => `highlight-${kind}`),
    'badge-lore',
    'badge-item',
    'badge-event',
  ]),
  ...known('phase 4 (derived on-tint text and the dark category tokens)', lightOnly, ['badge-character', 'badge-place', 'badge-org', 'badge-review']),
  ...known('phase 4 (derived on-tint text and the dark category tokens)', ['dark'], ['mark-item', 'mark-event']),
  ...known('phase 5 (status text: warn, danger, review, info)', lightOnly, [
    'danger',
    'danger-on-soft',
    'warn',
    'warn-on-tint',
    'warn-on-accent-soft',
    'info-on-place-soft',
    'review-on-soft',
  ]),
};
// Counted per pair and theme: `text-muted` failing in dark as well would be a second failure, not the same one.
const MAX_KNOWN_FAILURES = 37;

interface Measured {
  ratio: number;
  over: string;
}

function worstOf(tokens: TokenMap, spec: PairSpec): Measured {
  return spec.over
    .map((over) => ({ over, ratio: resolveContrast(tokens, { fg: spec.fg, bg: spec.bg, over }) }))
    .reduce((worst, next) => {
      // A ratio that is not a number must fail, not lose the comparison and let the pair pass.
      if (Number.isNaN(next.ratio)) throw new Error(`${spec.id}: the contrast over --${next.over} is not a number`);
      return next.ratio < worst.ratio ? next : worst;
    });
}

const failing = (spec: PairSpec, theme: Theme) => worstOf(THEMES[theme], spec).ratio < spec.min;

describe('the token parser sees every :root rule of styles.css', () => {
  it('finds the same number of rules as the file declares', () => {
    expect(rootRules(CSS).length).toBe(countRootRules(CSS));
    expect(Object.keys(THEMES.light).length).toBeGreaterThan(30);
    expect(THEMES.dark.surface).not.toBe(THEMES.light.surface);
  });
});

describe('every declared pair meets its minimum contrast, in both themes', () => {
  for (const theme of THEME_NAMES) {
    for (const spec of PAIRS) {
      const known = KNOWN_FAILURES[spec.id]?.themes.includes(theme);
      if (known) continue;
      it(`${spec.id} (${theme}) is at least ${spec.min}:1`, () => {
        const { ratio, over } = worstOf(THEMES[theme], spec);
        expect(ratio, `${spec.where}: ${ratio.toFixed(2)}:1 over --${over} in the ${theme} theme`).toBeGreaterThanOrEqual(spec.min);
      });
    }
  }
});

describe('the ratchet of known failures', () => {
  it('only lists pairs that exist, in a theme, with the phase that fixes them', () => {
    const ids = new Set(PAIRS.map((spec) => spec.id));
    for (const [id, entry] of Object.entries(KNOWN_FAILURES)) {
      expect(ids.has(id), `${id} is not a declared pair`).toBe(true);
      expect(entry.themes.length, id).toBeGreaterThan(0);
      expect(entry.fixedBy.length, `${id} needs the phase that fixes it`).toBeGreaterThan(5);
    }
  });

  it('lists a pair only while it still fails: fix it, then delete its entry', () => {
    const fixed = Object.entries(KNOWN_FAILURES).flatMap(([id, entry]) =>
      entry.themes
        .filter(
          (theme) =>
            !failing(
              PAIRS.find((spec) => spec.id === id)!,
              theme,
            ),
        )
        .map((theme) => `${id} (${theme})`),
    );
    expect(fixed, 'these pairs now pass: delete them from KNOWN_FAILURES and lower MAX_KNOWN_FAILURES').toEqual([]);
  });

  it('is exactly as long as MAX_KNOWN_FAILURES says, so a deleted entry cannot be replaced by a new one', () => {
    // Each phase that deletes entries lowers MAX_KNOWN_FAILURES by the same number.
    const failures = Object.values(KNOWN_FAILURES).reduce((total, entry) => total + entry.themes.length, 0);
    expect(failures).toBe(MAX_KNOWN_FAILURES);
  });

  it('declares every pair once', () => {
    const ids = PAIRS.map((spec) => spec.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});

describe('the text ramp keeps its order', () => {
  // Contrast against the same surface must step down text, then muted, then the non-text mark: equal levels would mean the
  // hierarchy the palette exists to give the eye has collapsed.
  it('text is stronger than muted on every surface, in both themes', () => {
    for (const theme of THEME_NAMES) {
      for (const over of SURFACES) {
        const strong = resolveContrast(THEMES[theme], { fg: 'var(--text)', over });
        const muted = resolveContrast(THEMES[theme], { fg: 'var(--text-muted)', over });
        expect(strong, `--text vs --text-muted over --${over} (${theme})`).toBeGreaterThan(muted);
      }
    }
  });
});

// Every colour token the source uses as a text colour must have a declared pair, so a new text colour cannot ship
// unmeasured. `text-[var(--x)]`, `color: 'var(--x)'` and a `color:` declaration in a stylesheet all count.
const NO_TEXT_PAIR: Record<string, string> = {
  bookmark: 'a bookmark icon colour, not text',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function tokensUsedAsText(): Set<string> {
  const used = new Set<string>();
  for (const file of sourceFiles(__dirname)) {
    const source = readFileSync(file, 'utf8');
    // `text-[var(--x)]`, `text-[color:var(--x)]`, `text-(--x)`, and a `color:` that is not `background-color:` or `border-color:`.
    for (const match of source.matchAll(/text-\[(?:color:)?var\(--([a-z0-9-]+)\)\]|text-\(--([a-z0-9-]+)\)|(?<![-\w])color:\s*['"`]?var\(--([a-z0-9-]+)\)/g))
      used.add(match[1] ?? match[2] ?? match[3]);
  }
  return used;
}

describe('no text colour ships without a declared pair', () => {
  it('measures every token the source draws text with', () => {
    const measured = new Set(PAIRS.flatMap((spec) => [...spec.fg.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1])));
    const unmeasured = [...tokensUsedAsText()].filter((token) => !measured.has(token) && !(token in NO_TEXT_PAIR));
    expect(unmeasured, 'declare a pair for each of these in PAIRS, or list it in NO_TEXT_PAIR with a reason').toEqual([]);
  });

  it('keeps NO_TEXT_PAIR honest', () => {
    const used = tokensUsedAsText();
    for (const [token, reason] of Object.entries(NO_TEXT_PAIR)) {
      expect(reason.length, token).toBeGreaterThan(10);
      expect(used.has(token), `${token} is no longer used as text: delete it from NO_TEXT_PAIR`).toBe(true);
    }
  });
});
