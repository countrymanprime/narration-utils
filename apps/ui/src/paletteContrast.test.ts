// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countBoothBlocks, countRootRules, parseThemes, resolveContrast, rootRules, type Theme, type TokenMap } from './tokenContrast';

// The palette guard (ADR 0059). It reads the tokens out of styles.css, in both themes, and asserts that every colour pair
// the app draws meets WCAG 2.x: 4.5:1 for text (SC 1.4.3) and 3:1 for the marks that carry meaning without being text
// (SC 1.4.11: the highlight underline, category dots, icons). A pair is one foreground and, where there is one, the fill it
// sits on, measured over every surface it can appear on and composited the way the browser paints it (a `color-mix(...
// transparent)` tint is laid over the surface first, so a highlight on a banded reader row is judged on the darker row).
//
// KNOWN_FAILURES is the explicit ratchet of pairs that fail: it held the 26 that failed on the day this test landed, each
// recolouring phase fixed its pairs and deleted their entries, and it is empty now. An entry whose pair now passes fails
// this test until it is deleted, so the list can only shrink, and adding one needs the same review as an `A11Y_DEBT` entry.

const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8');
const THEMES = parseThemes(CSS);
// 'booth' is FocusShell's high-contrast surface (studio-ui-primitives.prd.md Phase 1, ADR 0360 Q1), layered over dark
// (tokenContrast.ts): every pair below is checked over it too, not only light and dark.
const THEME_NAMES: Theme[] = ['light', 'dark', 'booth'];

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
  mark('non-text', 'icons, status dots, the info icon border and decorative glyphs: the one colour for what is seen and not read', 'var(--non-text)', SURFACES),
  mark('bookmark', 'the bookmark icon: chapter header, chapter row badge and line/note bookmark rows, all on one token (R9)', 'var(--bookmark)', SURFACES),
  text('toast', 'Toast: page colour on the text colour', 'var(--bg)', ['surface'], 'var(--text)'),
  text('on-accent', 'primary button and logo: accent-contrast on accent', 'var(--accent-contrast)', ['surface'], 'var(--accent)'),
  text('on-accent-strong', 'primary button hover: accent-contrast on accent-strong', 'var(--accent-contrast)', ['surface'], 'var(--accent-strong)'),
  text('accent-link', 'the Reset link and other accent text on the page', 'var(--accent)', ['surface']),
  text('accent-strong', 'active sort header, alias text, table header on the page', 'var(--accent-strong)', SURFACES),
  text('accent-strong-on-soft', 'notice and chip text: accent-strong on accent-soft', 'var(--accent-strong)', ['surface'], 'var(--accent-soft)'),
  text(
    'nav-active',
    'active navigation item: accent-strong on a 10% accent tint',
    'var(--accent-strong)',
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
  text('danger', 'danger button, field error, red confirm, alerts: the text-safe danger colour', 'var(--danger-text)', PAGE_SURFACES),
  text(
    'danger-on-soft',
    'danger button hover, MISREAD word, alert and last-completed badge: danger text on review-soft',
    'var(--danger-text)',
    ['surface', 'surface-2'],
    'var(--review-soft)',
  ),
  text('warn', 'the warn text in Settings and the Teleprompter status: the text-safe warn colour', 'var(--warn-text)', PAGE_SURFACES),
  text(
    'warn-on-tint',
    'Results badge: warn text on an 18% warn tint (a hovered or selected row is surface-2)',
    'var(--warn-text)',
    ['surface', 'surface-2'],
    tint('warn', 18),
  ),
  text('warn-on-accent-soft', 'SKIPPED word in the inline diff: warn text on accent-soft', 'var(--warn-text)', ['surface-2'], 'var(--accent-soft)'),
  text('info', 'the text-safe info colour on the page', 'var(--info-text)', PAGE_SURFACES),
  text('ok', 'a rule met on the Delivery page: the text-safe ok colour', 'var(--ok-text)', PAGE_SURFACES),
  text(
    'experimental',
    'the text-safe experimental colour: an ADR 0300 capability the host reports as experimental (studio-ui-primitives.prd.md Phase 1, ADR 0360 Q6)',
    'var(--experimental-text)',
    PAGE_SURFACES,
  ),
  text('info-on-place-soft', 'EXTRA word in the inline diff: info text on place-soft', 'var(--info-text)', ['surface-2'], 'var(--place-soft)'),
  ...KINDS.map((kind) =>
    text(
      `highlight-${kind}`,
      `Highlight (${kind}): the derived kind text colour on the kind's own 20% tint`,
      `var(--${kind}-text)`,
      READING_SURFACES,
      tint(kind, 20),
    ),
  ),
  text('highlight-note', 'Highlight (note): the text colour on the note tint', 'var(--text)', READING_SURFACES, tint('note', 20)),
  text(
    'highlight-search',
    "Highlight (search): the derived search text colour on the search kind's own 20% tint (R4)",
    'var(--search-text)',
    READING_SURFACES,
    tint('search', 20),
  ),
  text('badge-character', 'entity badge (Character): the derived text colour on the soft fill', 'var(--character-text)', ['surface'], 'var(--character-soft)'),
  text('badge-place', 'entity badge (Place)', 'var(--place-text)', ['surface'], 'var(--place-soft)'),
  text('badge-org', 'entity badge (Organization)', 'var(--org-text)', ['surface'], 'var(--org-soft)'),
  text('badge-review', 'entity badge (Review)', 'var(--review-text)', ['surface'], 'var(--review-soft)'),
  text(
    'result-exported',
    'Results badge "Exported": the derived Character text colour on an 18% Character tint',
    'var(--character-text)',
    ['surface', 'surface-2'],
    tint('character', 18),
  ),
  ...(['lore', 'item', 'event'] as const).map((kind) =>
    text(
      `badge-${kind}`,
      `entity badge (${kind}): the derived kind text colour on an 18% mix into the surface`,
      `var(--${kind}-text)`,
      ['surface'],
      `color-mix(in srgb, var(--${kind}) 18%, var(--surface))`,
    ),
  ),
  ...[...KINDS, 'note', 'search'].map((kind) => mark(`mark-${kind}`, `the ${kind} highlight underline and category dot`, `var(--${kind})`, READING_SURFACES)),
  mark('mark-warn', 'the Editing status dot and meter segment, and the dotted underline of a skipped word: warn on the surface', 'var(--warn)', ['surface']),
  mark('mark-info', 'the Recording status dot and meter segment: info on the surface', 'var(--info)', ['surface']),
  // LevelMeter's zones (Phase 1): aliases of --non-text/--ok/--warn/--danger (src/styles.css), each already a declared
  // pair above; a dedicated row per zone protects the meter's own contrast if a later phase breaks the alias.
  mark('meter-floor', 'LevelMeter: the below-floor zone, drawn as dim as an icon or a dot', 'var(--meter-floor)', ['surface']),
  mark('meter-body', 'LevelMeter: the safe recording zone', 'var(--meter-body)', ['surface']),
  mark('meter-hot', 'LevelMeter: the zone approaching the peak ceiling', 'var(--meter-hot)', ['surface']),
  mark('meter-over', 'LevelMeter: the zone at or over the peak ceiling', 'var(--meter-over)', ['surface']),
  // StatusBadge's chip fills (Phase 1): each tone's -text colour on the badge's own 14% tint of that tone.
  text('badge-ok-fill', "StatusBadge (success): ok text on the badge's own 14% tint", 'var(--ok-text)', ['surface'], 'var(--badge-ok-fill)'),
  text('badge-warn-fill', "StatusBadge (warning): warn text on the badge's own 14% tint", 'var(--warn-text)', ['surface'], 'var(--badge-warn-fill)'),
  text('badge-info-fill', "StatusBadge (info): info text on the badge's own 14% tint", 'var(--info-text)', ['surface'], 'var(--badge-info-fill)'),
  text('badge-danger-fill', "StatusBadge (danger): danger text on the badge's own 14% tint", 'var(--danger-text)', ['surface'], 'var(--badge-danger-fill)'),
  text(
    'badge-experimental-fill',
    "StatusBadge (experimental): experimental text on the badge's own 14% tint",
    'var(--experimental-text)',
    ['surface'],
    'var(--badge-experimental-fill)',
  ),
];

interface KnownFailure {
  themes: Theme[];
  fixedBy: string;
}

// Empty since the status text phase (docs/design/colour-and-contrast.md): an entry is a known failure, names how and when it
// gets fixed, and needs the same review as an `A11Y_DEBT` entry.
const KNOWN_FAILURES: Record<string, KnownFailure> = {};
// Counted per pair and theme: a pair failing in both themes is two failures, not one.
const MAX_KNOWN_FAILURES = 0;

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

  it('finds exactly one booth block, layered over dark', () => {
    expect(countBoothBlocks(CSS)).toBe(1);
    expect(THEMES.booth.surface).not.toBe(THEMES.dark.surface);
    // Only the tokens the booth block lists are overridden; everything else falls through from dark.
    expect(THEMES.booth.danger).toBe(THEMES.dark.danger);
  });
});

describe('every declared pair meets its minimum contrast, in every theme', () => {
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

describe('a highlight nested once in another highlight stays at AA', () => {
  // ParagraphView nests a mark inside a mark where annotations overlap (an alias inside a longer name, an entity inside a
  // note), so the inner text sits on two tints. Two 20% tints of one colour composite to 36%; an inner kind over any other
  // outer kind is a mix of two colours. The single-tint pairs above do not see this: at a 50% mix the derived text was about
  // 4.4:1 (4.37 to 4.50) in the dark theme, which axe found in the reader. This covers two stacked tints; a third (an entity
  // with two aliases on one word) or a "Go to line" tint under the row is not covered and measures lower (issue #139).
  for (const theme of THEME_NAMES) {
    it(`an entity's text on its own tint over any other highlight's tint is at least ${TEXT_MIN}:1 (${theme})`, () => {
      const failures: string[] = [];
      for (const inner of KINDS) {
        for (const outer of [...KINDS, 'note']) {
          for (const over of READING_SURFACES) {
            const bg = `color-mix(in srgb, var(--${inner}) 20%, ${tint(outer, 20)})`;
            const ratio = resolveContrast(THEMES[theme], { fg: `var(--${inner}-text)`, bg, over });
            // `!(ratio >= min)` fails a ratio that is not a number instead of letting it pass the comparison.
            if (!(ratio >= TEXT_MIN)) failures.push(`${inner} in ${outer} over --${over}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures, 'a highlight nested in another loses contrast: strengthen the derived --<kind>-text tokens').toEqual([]);
    });
  }
});

describe('placeholder text', () => {
  // A placeholder is text (WCAG 1.4.3), and axe does not test it. Tailwind's preflight draws it at 50% of the field's text
  // colour, about 3.2:1 in the light theme, so styles.css sets it to the muted text colour, which the `text-muted` pair holds
  // to 4.5:1 on every surface. This reads the source; that the rule wins in a browser (it is in the `base` layer with the
  // preflight rule it replaces, and more specific) was checked on every state that shows a field, in both themes.
  it('is drawn in --text-muted at full opacity for inputs and textareas', () => {
    const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*::placeholder[^{}]*)\{([^}]*)\}/g)];
    const muted = rules.filter(
      ([, selector, body]) =>
        /input::placeholder/.test(selector) &&
        /textarea::placeholder/.test(selector) &&
        /(?<![-\w])color:\s*var\(--text-muted\)/.test(body) &&
        /opacity:\s*1\b/.test(body),
    );
    expect(muted.length, 'styles.css needs one rule: input::placeholder, textarea::placeholder { color: var(--text-muted); opacity: 1 }').toBe(1);
  });
});

describe('the text ramp keeps its order', () => {
  // Contrast against the same surface must step down text, then muted, then the non-text mark: equal levels would mean the
  // hierarchy the palette exists to give the eye has collapsed.
  it('text is stronger than muted, and muted stronger than the non-text mark, on every surface, in every theme', () => {
    for (const theme of THEME_NAMES) {
      for (const over of SURFACES) {
        const contrast = (token: string) => resolveContrast(THEMES[theme], { fg: `var(--${token})`, over });
        expect(contrast('text'), `--text vs --text-muted over --${over} (${theme})`).toBeGreaterThan(contrast('text-muted'));
        expect(contrast('text-muted'), `--text-muted vs --non-text over --${over} (${theme})`).toBeGreaterThan(contrast('non-text'));
      }
    }
  });
});

// Every colour token the source uses as a text colour must have a declared pair, so a new text colour cannot ship
// unmeasured. `text-[var(--x)]`, `color: 'var(--x)'` and a `color:` declaration in a stylesheet all count.
const NO_TEXT_PAIR: Record<string, string> = {
  bookmark: 'a bookmark icon colour, not text',
  'non-text': 'the colour of icons, status dots and decorative glyphs, held to 3:1 as a mark and never the colour of text that carries information',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// `text-[var(--x)]`, `text-[color:var(--x)]`, `text-(--x)`, and a `color:` that is not `background-color:` or `border-color:`.
const TEXT_COLOUR = /text-\[(?:color:)?var\(--([a-z0-9-]+)\)\]|text-\(--([a-z0-9-]+)\)|(?<![-\w])color:\s*['"`]?var\(--([a-z0-9-]+)\)/g;

// How many times each source file draws a `color` with each token, keyed by the path under src/.
function textColourUses(): Map<string, Record<string, number>> {
  const uses = new Map<string, Record<string, number>>();
  for (const file of sourceFiles(__dirname)) {
    const perFile: Record<string, number> = {};
    for (const match of readFileSync(file, 'utf8').matchAll(TEXT_COLOUR)) {
      const token = match[1] ?? match[2] ?? match[3];
      perFile[token] = (perFile[token] ?? 0) + 1;
    }
    if (Object.keys(perFile).length > 0) uses.set(relative(__dirname, file).split(sep).join('/'), perFile);
  }
  return uses;
}

const tokensUsedAsText = (): Set<string> => new Set([...textColourUses().values()].flatMap((perFile) => Object.keys(perFile)));

// `--non-text` (3:1) is the colour of what is seen and not read, so it has no text pair. Every place the source uses it is
// listed here, per file, with what it draws: a label or a count that lands on it would read at 3:1 and belongs on
// --text-muted, so a new use fails this list until someone adds it with a reason. All mentions count, not only a `color`
// (a conditional, a fallback or a colour map slips past a pattern for text colours). Whether a listed use really is an icon,
// a dot or a decorative glyph is the reviewer's call: the test only makes every use visible.
const NON_TEXT_USES: Record<string, { count: number; what: string }> = {
  'components/delivery/BookChecklistPanel.tsx': { count: 1, what: 'the ear icon beside a book rule the narrator checks by listening' },
  'components/delivery/DeliveryProfilePanel.tsx': { count: 1, what: 'the ear icon beside a rule the narrator checks by listening' },
  'chapterStatus.ts': { count: 1, what: 'the Not Started status colour: a dot and a meter segment, never text' },
  'components/home/ChapterTrackButton.tsx': { count: 1, what: "the row button's linked-track colour dot" },
  'components/home/ChapterTrackPanel.tsx': { count: 1, what: "the panel header's linked-track colour dot" },
  'components/layout/AppShell.tsx': { count: 2, what: 'the folder icon beside the project name, and the header pill dot when no DAW file is linked' },
  'components/manuscript/ChapterNav.tsx': { count: 1, what: 'a line-hit result row icon (faParagraph)' },
  'components/manuscript/ReaderCard.tsx': { count: 1, what: 'the idle chapter bookmark icon' },
  'components/primitives/Tooltip.tsx': { count: 1, what: 'the border of the info icon' },
  'components/proofing/Transcript.tsx': { count: 2, what: 'the arrows between the Setup, Running and Results steps' },
  'components/settings/DawCatalogPanel.tsx': { count: 1, what: 'the not-detected DAW catalog entry dot (Phase 2)' },
  'components/settings/Settings.tsx': {
    count: 2,
    what: 'the DAW link status dot in the project-scope panel when nothing is linked, and the global-scope reachability dot when REAPER has not sent a recent heartbeat (Phase 7)',
  },
  'components/storybible/Guide.tsx': { count: 1, what: 'the lock icon beside a locked entry' },
  'components/tracks/TracksPage.tsx': { count: 1, what: 'the dot of a track that has no colour' },
  'styles.css': { count: 1, what: "LevelMeter's below-floor zone (Phase 1): --meter-floor is a derived alias of --non-text, not text" },
};

function nonTextMentions(): Record<string, number> {
  const mentions: Record<string, number> = {};
  for (const file of sourceFiles(__dirname)) {
    const count = readFileSync(file, 'utf8').split('var(--non-text)').length - 1;
    if (count > 0) mentions[relative(__dirname, file).split(sep).join('/')] = count;
  }
  return mentions;
}

describe('no text colour ships without a declared pair', () => {
  it('measures every token the source draws text with', () => {
    // Only a text pair (4.5:1) measures a text colour: a mark pair (3:1) does not make its token safe to read.
    const measured = new Set(
      PAIRS.filter((spec) => spec.min === TEXT_MIN).flatMap((spec) => [...spec.fg.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((match) => match[1])),
    );
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

  it('draws no text in a Tailwind palette colour or a literal colour: only tokens have a measured pair', () => {
    // `text-red-400` in Results.tsx was 2.89:1 on white in the light theme, because a palette colour is no token: no pair
    // measures it and the dark theme never changes it. This catches a palette utility, an arbitrary text colour that is not a
    // `var()`, and a literal `color:` in a style object or stylesheet.
    const palette =
      'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe';
    const functions = 'rgba?|hsla?|hwb|lab|lch|oklab|oklch|color';
    const literal = new RegExp(
      [
        String.raw`\btext-(?:(?:${palette})-\d{2,3}|white|black)\b`,
        String.raw`\btext-\[(?:#[0-9a-fA-F]{3,8}|(?:${functions})\(|color:(?!var\())`,
        String.raw`(?<![-\w])color:\s*['"\x60]?(?:#[0-9a-fA-F]{3,8}\b|(?:${functions})\(|white\b|black\b)`,
      ].join('|'),
      'g',
    );
    // Not src/api: mock and wire data (a track's `color: '#3F6EA6'`) is not a text colour.
    const offenders = sourceFiles(__dirname)
      .filter((file) => !relative(__dirname, file).startsWith('api'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(literal)].map((match) => `${relative(__dirname, file).split(sep).join('/')}: ${match[0]}`));
    expect(offenders, 'use a token from styles.css, with a declared pair').toEqual([]);
  });

  it('uses --non-text only where an icon, a dot or a glyph is listed', () => {
    const listed = Object.fromEntries(Object.entries(NON_TEXT_USES).map(([file, use]) => [file, use.count]));
    expect(nonTextMentions(), 'a label or a count belongs on --text-muted; list only an icon, a dot or a glyph, with what it is').toEqual(listed);
  });

  it('says what every listed --non-text use draws', () => {
    for (const [file, use] of Object.entries(NON_TEXT_USES)) expect(use.what.length, file).toBeGreaterThan(10);
  });
});
