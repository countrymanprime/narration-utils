import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { A11Y_DEBT } from '../tests/atlas/a11y-debt';

// Every primitive is part of the component library and must show up in the
// atlas (Storybook + tests/atlas). A primitive that genuinely should not - a
// pure layout wrapper with nothing to vary - is listed here with the reason.
// Adding an entry is a review-visible decision; the list may only shrink.
const ATLAS_EXEMPT: Record<string, string> = {};

const primitivesDir = join(__dirname, 'components', 'primitives');
const files = readdirSync(primitivesDir);
const primitives = files.filter((file) => /^[A-Z][A-Za-z]*\.tsx$/.test(file)).map((file) => file.replace('.tsx', ''));

describe('component atlas coverage', () => {
  test('every primitive has a story file or a recorded exemption', () => {
    const uncovered = primitives.filter((name) => !files.includes(`${name}.stories.tsx`) && !(name in ATLAS_EXEMPT));
    expect(uncovered, 'add <Name>.stories.tsx next to the component, or exempt it with a reason').toEqual([]);
  });

  test('an exemption names a real primitive that still lacks a story', () => {
    const stale = Object.keys(ATLAS_EXEMPT).filter((name) => !primitives.includes(name) || files.includes(`${name}.stories.tsx`));
    expect(stale, 'remove exemptions that no longer apply').toEqual([]);
  });

  test('every exemption says why', () => {
    const unexplained = Object.entries(ATLAS_EXEMPT).filter(([, reason]) => reason.trim().length < 10);
    expect(unexplained).toEqual([]);
  });
});

describe('atlas accessibility debt', () => {
  // The list of stories allowed to violate an axe rule may only shrink.
  const MAX_DEBT_ENTRIES = 0;

  test('does not grow', () => {
    expect(A11Y_DEBT.length).toBeLessThanOrEqual(MAX_DEBT_ENTRIES);
  });

  test('every entry names a rule and says why', () => {
    for (const debt of A11Y_DEBT) {
      expect(debt.rules.length, debt.title).toBeGreaterThan(0);
      expect(debt.reason.trim().length, `${debt.title} needs a reason`).toBeGreaterThan(20);
    }
  });

  test('every entry names a component that has stories', () => {
    for (const debt of A11Y_DEBT) {
      const name = debt.title.replace('Primitives/', '');
      expect(files, debt.title).toContain(`${name}.stories.tsx`);
    }
  });
});
