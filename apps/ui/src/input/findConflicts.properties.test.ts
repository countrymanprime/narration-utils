import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CommandDescriptor } from './commands.catalog';
import { findConflicts, type Conflict } from './findConflicts';
import { gesture } from './gestures';
import type { Keymap } from './keymap';
import type { Scope } from './scopes';

const SCOPES: Scope[] = ['global', 'page', 'booth', 'dialog'];
const GESTURE_POOL = ['KeyA', 'KeyB', 'KeyC'];
const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

type Entry = { id: string; scope: Scope; codes: string[] };

const entryArb: fc.Arbitrary<Entry> = fc.record({
  id: fc.constantFrom(...IDS),
  scope: fc.constantFrom(...SCOPES),
  codes: fc.array(fc.constantFrom(...GESTURE_POOL), { maxLength: 2 }),
});

// At least two entries, each id kept once (a later draw for the same id overwrites the earlier one), so the model
// stays a valid Keymap (one entry per command id) however fc.array happens to sample IDS.
const modelArb: fc.Arbitrary<Entry[]> = fc
  .array(entryArb, { minLength: 2, maxLength: 8 })
  .map((entries) => [...new Map(entries.map((entry) => [entry.id, entry])).values()])
  .filter((entries) => entries.length >= 2);

function buildModel(entries: Entry[]): { catalog: CommandDescriptor[]; keymap: Keymap } {
  const catalog = entries.map((entry): CommandDescriptor => ({ id: entry.id, label: entry.id, scope: entry.scope, defaults: [] }));
  const keymap: Keymap = {};
  for (const entry of entries) keymap[entry.id] = entry.codes.map((code) => gesture('keyboard', code));
  return { catalog, keymap };
}

const conflictKey = (c: Conflict): string => [c.gesture, ...c.commands].join('|');

describe('findConflicts properties', () => {
  it('symmetry: the conflicts found do not depend on the order commands were built or bound in', () => {
    fc.assert(
      fc.property(modelArb, (entries) => {
        const { catalog, keymap } = buildModel(entries);
        const { catalog: reversedCatalog, keymap: reversedKeymap } = buildModel([...entries].reverse());
        const normal = findConflicts(catalog, keymap).map(conflictKey).sort();
        const reversed = findConflicts(reversedCatalog, reversedKeymap).map(conflictKey).sort();
        expect(reversed).toEqual(normal);
      }),
    );
  });

  it('distinct gestures never conflict', () => {
    fc.assert(
      fc.property(modelArb, (entries) => {
        let counter = 0;
        const distinct = entries.map((entry) => ({ ...entry, codes: entry.codes.map(() => `unique-${counter++}`) }));
        const { catalog, keymap } = buildModel(distinct);
        expect(findConflicts(catalog, keymap)).toEqual([]);
      }),
    );
  });

  it('adding a binding never removes a conflict that was already found', () => {
    fc.assert(
      fc.property(modelArb, fc.constantFrom(...GESTURE_POOL), (entries, extraCode) => {
        const { catalog, keymap } = buildModel(entries);
        const before = new Set(findConflicts(catalog, keymap).map(conflictKey));

        const growingId = entries[0].id;
        const grownKeymap: Keymap = { ...keymap, [growingId]: [...keymap[growingId], gesture('keyboard', extraCode)] };
        const after = new Set(findConflicts(catalog, grownKeymap).map(conflictKey));

        for (const key of before) expect(after.has(key)).toBe(true);
      }),
    );
  });
});
