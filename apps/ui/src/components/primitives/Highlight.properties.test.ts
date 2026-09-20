import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { highlightKind, type HighlightKind } from './Highlight';

const KINDS: HighlightKind[] = ['Character', 'Place', 'Organization', 'Lore', 'Item', 'Event', 'Review', 'Note', 'Cursor'];
// Every category spelling the Story Bible produces for a highlight (ADR 0016).
const KNOWN = ['Character', 'Place', 'Organization', 'Lore', 'Item', 'Event', 'Note'];
// Object-prototype names and near misses: a lookup table keyed on the category would answer these wrongly.
const AWKWARD = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'character', 'CHARACTER', ' Character', 'Needs Review', 'Draft', ''];

describe('highlightKind properties', () => {
  it('answers a highlight kind for any string, and never the Teleprompter cursor', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.constantFrom(...AWKWARD, ...KNOWN, 'Location', 'Cursor')), (category) => {
        const kind = highlightKind(category);
        expect(KINDS).toContain(kind);
        expect(kind).not.toBe('Cursor');
      }),
    );
  });

  it('keeps the known categories, spells Location as Place, and degrades everything else to Review', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.constantFrom(...AWKWARD)), (category) => {
        fc.pre(!KNOWN.includes(category) && category !== 'Location');
        expect(highlightKind(category)).toBe('Review');
      }),
    );
    for (const category of KNOWN) expect(highlightKind(category)).toBe(category);
    expect(highlightKind('Location')).toBe('Place');
  });
});
