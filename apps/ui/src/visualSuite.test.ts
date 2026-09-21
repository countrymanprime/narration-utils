import { describe, expect, test } from 'vitest';
import * as appDrivers from '../tests/visual/app.drivers';
import { APP_DRIVERS } from '../tests/visual/app.drivers';
import { AXE_DEBT } from '../tests/visual/axe-debt';
import { STATE_CATALOG } from '../tests/visual/state-catalog';
import { REFLOW_VIEWPORT, VIEWPORTS } from '../tests/visual/viewports';
import {
  checkAxeFindings,
  checkAxeModeForCi,
  checkControlWidths,
  disambiguateLabels,
  findBlankCaptures,
  findCollapsedControls,
  findNarrowestControl,
  findStaleSameAs,
  findUndeclaredDuplicates,
  isSameImage,
  MIN_CONTROL_WIDTH_PX,
  NON_TEXT_INPUT_TYPES,
  resolveAxeMode,
  summariseAxeRun,
  summariseAxeViolations,
  type AxeDebt,
  type AxeFinding,
  type CaptureRecord,
  type ControlMeasurement,
} from '../tests/visual/lib/validators';

// A stand-in image: every cell of the signature is one brightness level derived from `hash`,
// so equal hashes are the same picture and different hashes are clearly different pictures.
function level(hash: string): number {
  return ([...hash].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 37) % 256;
}

function record(page: string, state: string, viewport: string, hash: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    page,
    state,
    viewport,
    hash,
    signature: Array<number>(8).fill(level(hash)),
    maxChannelStdev: 40,
    overflowPx: 0,
    narrowestControlPx: null,
    ...overrides,
  };
}

const key = (page: string, state: string) => `${page}/${state}`;

describe('isSameImage', () => {
  test('treats anti-aliasing noise (a level or two per cell) as the same image', () => {
    expect(isSameImage([10, 20, 30, 40], [11, 19, 30, 42])).toBe(true);
  });

  test('treats a localized real change as a different image', () => {
    expect(isSameImage([10, 20, 30, 40], [10, 20, 90, 40])).toBe(false);
  });

  test('images of different sizes are never the same', () => {
    expect(isSameImage([10, 20], [10, 20, 30])).toBe(false);
  });
});

describe('findBlankCaptures', () => {
  test('flags a capture whose pixels are effectively uniform', () => {
    const blank = record('home', 'default', 'desktop', 'a', { maxChannelStdev: 0.2 });
    const real = record('home', 'other', 'desktop', 'b', { maxChannelStdev: 30 });
    expect(findBlankCaptures([blank, real])).toEqual([blank]);
  });

  test('returns nothing when every capture has visible content', () => {
    expect(findBlankCaptures([record('home', 'default', 'desktop', 'a')])).toEqual([]);
  });
});

describe('findUndeclaredDuplicates', () => {
  test('flags two states with identical pixels at the same viewport when neither declares sameAs', () => {
    const records = [record('manuscript', 'a', 'desktop', 'h1'), record('manuscript', 'b', 'desktop', 'h1')];
    const groups = findUndeclaredDuplicates(records, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ viewport: 'desktop', states: [key('manuscript', 'a'), key('manuscript', 'b')] });
  });

  test('accepts a duplicate when one state declares it is the same as the other', () => {
    const records = [record('home', 'default', 'desktop', 'h1'), record('home', 'collapsed', 'desktop', 'h1')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findUndeclaredDuplicates(records, declared)).toEqual([]);
  });

  test('does not call two states duplicates over even a small localized change', () => {
    // Same coarse signature (a Play->Pause glyph is a few pixels), different bytes: a real difference.
    const records = [
      record('tracks', 'default', 'desktop', 'h1'),
      record('tracks', 'playing', 'desktop', 'h2', { signature: Array<number>(8).fill(level('h1')) }),
    ];
    expect(findUndeclaredDuplicates(records, [])).toEqual([]);
  });

  test('does not compare across viewports', () => {
    const records = [record('home', 'a', 'desktop', 'h1'), record('home', 'b', 'mobile', 'h1')];
    expect(findUndeclaredDuplicates(records, [])).toEqual([]);
  });

  test('a sameAs limited to some viewports does not excuse a duplicate at another', () => {
    const records = [record('global', 'rail', 'mobile', 'h1'), record('global', 'drawer', 'mobile', 'h1')];
    const declared = [{ page: 'global', state: 'drawer', sameAs: { of: key('global', 'rail'), reason: 'no-op on desktop', viewports: ['desktop'] } }];
    expect(findUndeclaredDuplicates(records, declared)).toHaveLength(1);
  });
});

describe('findStaleSameAs', () => {
  test('flags a sameAs declaration whose two states no longer render identically', () => {
    const records = [record('home', 'default', 'desktop', 'h1'), record('home', 'collapsed', 'desktop', 'h2')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findStaleSameAs(records, declared)).toEqual([{ state: key('home', 'collapsed'), of: key('home', 'default'), viewport: 'desktop' }]);
  });

  test('does not call a declaration stale over anti-aliasing noise', () => {
    const records = [
      record('home', 'default', 'desktop', 'h1'),
      record('home', 'collapsed', 'desktop', 'h1', { signature: Array<number>(8).fill(level('h1') - 1) }),
    ];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findStaleSameAs(records, declared)).toEqual([]);
  });

  test('ignores a declaration when either side was not captured in this run', () => {
    const records = [record('home', 'collapsed', 'desktop', 'h2')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'x' } }];
    expect(findStaleSameAs(records, declared)).toEqual([]);
  });
});

const control = (label: string, width: number, kind = 'select'): ControlMeasurement => ({ label, kind, width });

describe('findCollapsedControls', () => {
  test('flags a control narrower than the minimum and names it', () => {
    const squeezed = control('Default Whisper model', 44.8);
    expect(findCollapsedControls([control('Log verbosity', 320), squeezed])).toEqual([squeezed]);
  });

  test('a control exactly at the minimum is fine, one a pixel under is not', () => {
    expect(findCollapsedControls([control('A', MIN_CONTROL_WIDTH_PX)])).toEqual([]);
    expect(findCollapsedControls([control('A', MIN_CONTROL_WIDTH_PX - 1)])).toHaveLength(1);
  });

  test('a control that is in the layout but has no width at all is collapsed, not missing', () => {
    expect(findCollapsedControls([control('Hex', 0, 'input[text]')])).toHaveLength(1);
  });

  test('a control the row declares narrow on purpose is not flagged', () => {
    expect(findCollapsedControls([control('Pitch', 40, 'input[number]')], ['Pitch'])).toEqual([]);
  });

  test('the minimum is a parameter', () => {
    expect(findCollapsedControls([control('A', 80)], [], 96)).toHaveLength(1);
  });
});

describe('NON_TEXT_INPUT_TYPES', () => {
  test('a colour swatch, a checkbox and the other non-text inputs are exempt by type', () => {
    for (const type of ['color', 'checkbox', 'radio', 'range', 'file', 'hidden', 'button', 'submit', 'reset', 'image']) {
      expect(NON_TEXT_INPUT_TYPES).toContain(type);
    }
  });

  test('the types a person types into are measured', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date']) expect(NON_TEXT_INPUT_TYPES).not.toContain(type);
  });
});

describe('checkControlWidths', () => {
  test('reports a collapsed control with its width, the viewport and how to declare it', () => {
    const [problem, ...rest] = checkControlWidths([control('Default chunk length', 44.8)], undefined, 'reflow');
    expect(rest).toEqual([]);
    expect(problem).toContain('"Default chunk length"');
    expect(problem).toContain('44.8px');
    expect(problem).toContain('reflow');
    expect(problem).toContain('narrowControls');
  });

  test('reports nothing when every control is wide enough', () => {
    expect(checkControlWidths([control('A', 200), control('B', 90, 'input[text]')], undefined, 'desktop')).toEqual([]);
  });

  test('a declared control is allowed to be narrow', () => {
    const declared = { labels: ['Pitch'], reason: 'A two-digit number box, narrow by design' };
    expect(checkControlWidths([control('Pitch', 40, 'input[number]')], declared, 'desktop')).toEqual([]);
  });

  test('a declaration that no longer holds fails, so an allowance cannot outlive its reason', () => {
    const declared = { labels: ['Pitch'], reason: 'A two-digit number box, narrow by design' };
    const problems = checkControlWidths([control('Pitch', 120, 'input[number]')], declared, 'desktop');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer holds');
    expect(problems[0]).toContain('"Pitch"');
  });

  test('a declared control that is not on the page counts as stale too', () => {
    const declared = { labels: ['Gone'], reason: 'A control that was removed' };
    expect(checkControlWidths([], declared, 'desktop')[0]).toContain('"Gone"');
  });

  test('a declaration limited to some viewports is neither applied nor checked at another', () => {
    const declared = { labels: ['Pitch'], reason: 'Squeezed only on the narrow layout', viewports: ['reflow'] };
    expect(checkControlWidths([control('Pitch', 300, 'input[number]')], declared, 'desktop')).toEqual([]);
    expect(checkControlWidths([control('Pitch', 40, 'input[number]')], declared, 'desktop')).toHaveLength(1);
    expect(checkControlWidths([control('Pitch', 40, 'input[number]')], declared, 'reflow')).toEqual([]);
  });
});

describe('disambiguateLabels', () => {
  test('keeps unique names as they are', () => {
    expect(disambiguateLabels([control('A', 100), control('B', 100)]).map((c) => c.label)).toEqual(['A', 'B']);
  });

  test('numbers the second and later control of the same name, so a declaration or a failure addresses one of them', () => {
    const named = disambiguateLabels([control('Model', 300), control('Model', 30), control('Model', 300)]);
    expect(named.map((c) => c.label)).toEqual(['Model', 'Model (2)', 'Model (3)']);
    expect(named.map((c) => c.width)).toEqual([300, 30, 300]);
  });

  test('a collapsed sibling is not hidden behind an allowance for a wide control of the same name', () => {
    const declared = { labels: ['Model'], reason: 'The first one is narrow on purpose' };
    const problems = checkControlWidths(disambiguateLabels([control('Model', 40), control('Model', 30)]), declared, 'desktop');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"Model (2)"');
  });
});

describe('findNarrowestControl', () => {
  test('finds the capture whose narrowest control is the narrowest of the run, for calibration', () => {
    const records = [
      record('settings', 'a', 'desktop', 'h1', { narrowestControlPx: 448 }),
      record('settings', 'b', 'reflow', 'h2', { narrowestControlPx: 143.6 }),
      record('home', 'c', 'desktop', 'h3', { narrowestControlPx: null }),
    ];
    expect(findNarrowestControl(records)).toMatchObject({ page: 'settings', state: 'b', viewport: 'reflow', narrowestControlPx: 143.6 });
  });

  test('is undefined when no capture had a text control', () => {
    expect(findNarrowestControl([record('home', 'c', 'desktop', 'h3')])).toBeUndefined();
  });
});

function finding(rule: string, nodes = 1, overrides: Partial<AxeFinding> = {}): AxeFinding {
  return { rule, impact: 'serious', help: `${rule} help`, nodes, targets: ['#a'], ...overrides };
}

describe('summariseAxeViolations', () => {
  test('keeps the rule, its impact, what to do and how many nodes, sorted by rule so a run is stable', () => {
    const summary = summariseAxeViolations([
      { id: 'label', impact: 'critical', help: 'Form elements must have labels', nodes: [{ target: ['#a'] }, { target: ['#b'] }] },
      { id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum colour contrast', nodes: [{ target: ['.x'] }] },
    ]);
    expect(summary.map((f) => [f.rule, f.impact, f.nodes])).toEqual([
      ['color-contrast', 'serious', 1],
      ['label', 'critical', 2],
    ]);
    expect(summary[1]?.help).toBe('Form elements must have labels');
  });

  test('lists the first three targets only and flattens a shadow or iframe path', () => {
    const [only] = summariseAxeViolations([
      { id: 'label', impact: null, help: 'h', nodes: [{ target: ['#a'] }, { target: ['iframe', '#b'] }, { target: [['host', '#c']] }, { target: ['#d'] }] },
    ]);
    expect(only?.targets).toEqual(['#a', 'iframe #b', 'host #c']);
    expect(only?.nodes).toBe(4);
    expect(only?.impact).toBeNull();
  });

  test('a clean page has no findings', () => {
    expect(summariseAxeViolations([])).toEqual([]);
  });
});

describe('checkAxeFindings', () => {
  const debt = (overrides: Partial<AxeDebt> = {}): AxeDebt => ({
    page: 'home',
    state: 'default',
    rules: ['label'],
    reason: 'A form field with no label, fix tracked in #1',
    ...overrides,
  });

  test('a violation nothing declares fails and says which rule, how many nodes, where and how to declare it', () => {
    const [problem, ...rest] = checkAxeFindings([finding('label', 2, { targets: ['#a', '#b'] })], [], 'home', 'default', 'desktop');
    expect(rest).toEqual([]);
    expect(problem).toContain('label');
    expect(problem).toContain('2 nodes');
    expect(problem).toContain('#a, #b');
    expect(problem).toContain('desktop');
    expect(problem).toContain('axeDebt');
  });

  test('a clean state with no debt reports nothing', () => {
    expect(checkAxeFindings([], [], 'home', 'default', 'desktop')).toEqual([]);
  });

  test('a rule the row declares as debt is allowed, and only that rule', () => {
    const problems = checkAxeFindings([finding('label'), finding('color-contrast')], [debt()], 'home', 'default', 'desktop');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('color-contrast');
  });

  test('debt on another state is not applied', () => {
    expect(checkAxeFindings([finding('label')], [debt({ state: 'other' })], 'home', 'default', 'desktop')).toHaveLength(1);
    expect(checkAxeFindings([finding('label')], [debt({ page: 'settings' })], 'home', 'default', 'desktop')).toHaveLength(1);
  });

  test('debt that no longer holds fails, so an entry cannot outlive its violation (the list only shrinks)', () => {
    const problems = checkAxeFindings([], [debt()], 'home', 'default', 'tablet');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no longer');
    expect(problems[0]).toContain('label');
    expect(problems[0]).toContain('tablet');
  });

  test('debt limited to some viewports is neither applied nor checked at another', () => {
    const limited = debt({ viewports: ['desktop'] });
    expect(checkAxeFindings([], [limited], 'home', 'default', 'tablet')).toEqual([]);
    expect(checkAxeFindings([finding('label')], [limited], 'home', 'default', 'tablet')).toHaveLength(1);
    expect(checkAxeFindings([finding('label')], [limited], 'home', 'default', 'desktop')).toEqual([]);
  });

  test('two entries for one state add up', () => {
    const both = [debt(), debt({ rules: ['color-contrast'] })];
    expect(checkAxeFindings([finding('label'), finding('color-contrast')], both, 'home', 'default', 'desktop')).toEqual([]);
  });
});

describe('resolveAxeMode', () => {
  test('is off unless the project declares axeDebt or a run asks for it', () => {
    expect(resolveAxeMode(undefined, false)).toBe('off');
    expect(resolveAxeMode('', false)).toBe('off');
  });

  test('is a gate as soon as the project declares axeDebt (even an empty list)', () => {
    expect(resolveAxeMode(undefined, true)).toBe('gate');
  });

  test('UI_AXE=1 measures without failing, whether or not the project has a gate', () => {
    expect(resolveAxeMode('1', false)).toBe('report');
    expect(resolveAxeMode('1', true)).toBe('report');
  });

  test('UI_AXE=0 switches it off for a quick local run, and UI_AXE=gate forces the gate', () => {
    expect(resolveAxeMode('0', true)).toBe('off');
    expect(resolveAxeMode('gate', false)).toBe('gate');
  });

  test('a mistyped value fails loudly instead of quietly turning the gate off', () => {
    expect(() => resolveAxeMode('yes', true)).toThrow(/UI_AXE/);
  });
});

describe('checkAxeModeForCi', () => {
  test('a project with a gate cannot switch it off or down to a report on CI', () => {
    expect(checkAxeModeForCi('off', true, true, '0')[0]).toContain('UI_AXE=0');
    expect(checkAxeModeForCi('report', true, true, '1')[0]).toContain('UI_AXE=1');
  });

  test('the gate itself, a developer machine and a project with no gate are fine', () => {
    expect(checkAxeModeForCi('gate', true, true, undefined)).toEqual([]);
    expect(checkAxeModeForCi('off', true, false, '0')).toEqual([]);
    expect(checkAxeModeForCi('report', false, true, '1')).toEqual([]);
  });
});

describe('summariseAxeRun', () => {
  test('counts the captures axe ran on and totals nodes per rule, worst first, for the report-only baseline', () => {
    const records = [
      record('home', 'a', 'desktop', 'h1', { axe: [finding('color-contrast', 3), finding('label', 1)] }),
      record('home', 'b', 'desktop', 'h2', { axe: [finding('color-contrast', 2)] }),
      record('home', 'c', 'desktop', 'h3', { axe: [] }),
      record('home', 'd', 'desktop', 'h4'),
    ];
    expect(summariseAxeRun(records)).toEqual({
      captures: 3,
      withViolations: 2,
      nodes: 6,
      byRule: [
        { rule: 'color-contrast', nodes: 5, captures: 2 },
        { rule: 'label', nodes: 1, captures: 1 },
      ],
    });
  });

  test('a run where axe did not run has nothing to summarise', () => {
    expect(summariseAxeRun([record('home', 'a', 'desktop', 'h1')])).toEqual({ captures: 0, withViolations: 0, nodes: 0, byRule: [] });
  });
});

describe('visual suite catalog integrity', () => {
  const keys = STATE_CATALOG.map((entry) => key(entry.page, entry.state));

  test('every catalog row is unique', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every catalog row has a driver, or says why not', () => {
    const silent = STATE_CATALOG.filter((entry) => !APP_DRIVERS[entry.page]?.[entry.state] && !entry.undriven);
    expect(silent.map((entry) => key(entry.page, entry.state))).toEqual([]);
  });

  test('every driver belongs to a catalog row', () => {
    const orphans = Object.entries(APP_DRIVERS).flatMap(([page, states]) =>
      Object.keys(states)
        .map((state) => key(page, state))
        .filter((k) => !keys.includes(k)),
    );
    expect(orphans).toEqual([]);
  });

  test('no driver is marked undriven', () => {
    const contradictions = STATE_CATALOG.filter((entry) => entry.undriven && APP_DRIVERS[entry.page]?.[entry.state]);
    expect(contradictions.map((entry) => key(entry.page, entry.state))).toEqual([]);
  });

  test('the undriven budget never grows past what is recorded today', () => {
    const MAX_UNDRIVEN = 0;
    expect(STATE_CATALOG.filter((entry) => entry.undriven).length).toBeLessThanOrEqual(MAX_UNDRIVEN);
  });

  test('sameAs targets exist and viewport names are real', () => {
    const viewportNames = [...VIEWPORTS, ...STATE_CATALOG.flatMap((entry) => entry.extraViewports ?? [])].map((viewport) => viewport.name);
    for (const entry of STATE_CATALOG) {
      if (!entry.sameAs) continue;
      expect(keys, `${key(entry.page, entry.state)} sameAs.of`).toContain(entry.sameAs.of);
      expect(entry.sameAs.reason.trim().length, `${key(entry.page, entry.state)} needs a reason`).toBeGreaterThan(10);
      for (const name of entry.sameAs.viewports ?? []) expect(viewportNames).toContain(name);
    }
  });

  test('an extra viewport has its own name and a real size, so it never overwrites a default capture', () => {
    const defaults = VIEWPORTS.map((viewport) => viewport.name);
    for (const entry of STATE_CATALOG) {
      const names = (entry.extraViewports ?? []).map((viewport) => viewport.name);
      expect(new Set(names).size, `${key(entry.page, entry.state)} extraViewports`).toBe(names.length);
      for (const viewport of entry.extraViewports ?? []) {
        expect(defaults, `${key(entry.page, entry.state)} extra viewport ${viewport.name}`).not.toContain(viewport.name);
        expect(viewport.width).toBeGreaterThan(0);
        expect(viewport.height).toBeGreaterThan(0);
      }
    }
  });

  test('a narrowControls declaration names its controls, gives a reason, and points at viewports the row is captured at', () => {
    for (const entry of STATE_CATALOG) {
      const declared = entry.narrowControls;
      if (!declared) continue;
      const where = key(entry.page, entry.state);
      expect(declared.labels.length, `${where} narrowControls.labels`).toBeGreaterThan(0);
      expect(declared.reason.trim().length, `${where} narrowControls needs a reason`).toBeGreaterThan(10);
      const capturedAt = [...VIEWPORTS, ...(entry.extraViewports ?? [])].map((viewport) => viewport.name);
      for (const name of declared.viewports ?? []) expect(capturedAt, `${where} narrowControls.viewports`).toContain(name);
    }
  });

  test('every Settings state is also captured at the reflow width, where the row layout stacks', () => {
    const settings = STATE_CATALOG.filter((entry) => entry.page === 'settings');
    expect(settings.length).toBeGreaterThan(0);
    for (const entry of settings) expect(entry.extraViewports, key(entry.page, entry.state)).toContainEqual(REFLOW_VIEWPORT);
  });
});

describe('axe debt', () => {
  // The (state, rule) pairs the app states are allowed to violate. It may only shrink: lower it when an entry goes, and a
  // higher number needs a maintainer's decision, not just a green run.
  const MAX_AXE_DEBT_RULES = 19;
  const pairs = AXE_DEBT.flatMap((entry) => entry.rules.map((rule) => `${entry.page}/${entry.state}: ${rule}`));

  test('the axe gate is on, because the drivers declare the list', () => {
    expect((appDrivers as { axeDebt?: unknown }).axeDebt).toBe(AXE_DEBT);
  });

  test('does not grow', () => {
    expect(pairs.length).toBeLessThanOrEqual(MAX_AXE_DEBT_RULES);
  });

  test('names each state and rule once', () => {
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test('every entry belongs to a catalog row, names a rule, says why and points at viewports the row is captured at', () => {
    for (const entry of AXE_DEBT) {
      const where = key(entry.page, entry.state);
      const row = STATE_CATALOG.find((candidate) => key(candidate.page, candidate.state) === where);
      expect(row, `${where} is not a catalog row`).toBeDefined();
      expect(entry.rules.length, `${where} axe debt names no rule`).toBeGreaterThan(0);
      expect(entry.reason.trim().length, `${where} axe debt needs a reason`).toBeGreaterThan(20);
      const capturedAt = [...VIEWPORTS, ...(row?.extraViewports ?? [])].map((viewport) => viewport.name);
      for (const name of entry.viewports ?? []) expect(capturedAt, `${where} axe debt viewports`).toContain(name);
    }
  });

  test('an entry is on a row the suite captures, so it can be checked and go stale', () => {
    for (const entry of AXE_DEBT) {
      const row = STATE_CATALOG.find((candidate) => key(candidate.page, candidate.state) === key(entry.page, entry.state));
      expect(row?.undriven, `${key(entry.page, entry.state)} is not driven, so its axe debt is never checked`).toBeUndefined();
    }
  });

  test('every entry says where the fix is tracked', () => {
    for (const entry of AXE_DEBT) expect(entry.reason, `${key(entry.page, entry.state)} axe debt`).toMatch(/#\d+/);
  });
});
