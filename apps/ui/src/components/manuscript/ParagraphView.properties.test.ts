import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ManuscriptNote } from '../../types';
import { composeAnnotationPieces, resolveNoteAnchor } from './annotations';

// Emoji and other astral characters are two UTF-16 units each, which is where an offset bug shows.
const anyText = fc.oneof(fc.string({ unit: 'grapheme', maxLength: 24 }), fc.string({ unit: 'binary', maxLength: 24 }));
// A tiny alphabet, so the same word turns up several times in one paragraph (the case where "nearest occurrence" matters).
const repetitiveText = fc.array(fc.constantFrom('a', 'b', '\u{1F600}'), { maxLength: 16 }).map((units) => units.join(''));
const text = fc.oneof(anyText, repetitiveText);

type Annotation = Parameters<typeof composeAnnotationPieces>[1][number];
const kinds = ['entity', 'note', 'format'] as const;

/** Annotations with offsets drawn from `range` (in range, or anything at all). */
const annotations = (range: fc.Arbitrary<number>) =>
  fc
    .array(fc.record({ start: range, end: range, kind: fc.constantFrom(...kinds) }), { maxLength: 6 })
    .map((items): Annotation[] => items.map((item, index) => ({ id: `a${index}`, ...item, length: item.end - item.start })));

const inRange = (body: string) => fc.integer({ min: 0, max: body.length });
// Offsets are integers in real data; the rest (negative, huge, infinite, NaN) is corrupt data the compositor must survive.
const anything = fc.oneof(fc.integer({ min: -100, max: 100 }), fc.integer(), fc.constantFrom(Infinity, -Infinity, NaN));

describe('composeAnnotationPieces properties', () => {
  it('always rebuilds the text from its pieces, whatever the offsets are', () => {
    fc.assert(
      fc.property(text, annotations(anything), (body, items) => {
        expect(
          composeAnnotationPieces(body, items)
            .map((piece) => piece.text)
            .join(''),
        ).toBe(body);
      }),
    );
  });

  it('never returns an empty piece', () => {
    fc.assert(
      fc.property(text, annotations(anything), (body, items) => {
        expect(composeAnnotationPieces(body, items).every((piece) => piece.text.length > 0)).toBe(true);
      }),
    );
  });

  it('lists on each piece exactly the annotations that cover it once offsets are clamped into the text, and hands back the caller’s own objects', () => {
    fc.assert(
      fc.property(text, annotations(anything), (body, items) => {
        const clamp = (offset: number) => Math.min(Math.max(offset, 0), body.length);
        let position = 0;
        for (const piece of composeAnnotationPieces(body, items)) {
          const end = position + piece.text.length;
          const covering = items.filter((item) => clamp(item.start) < clamp(item.end) && clamp(item.start) <= position && clamp(item.end) >= end);
          expect(piece.annotations).toHaveLength(covering.length);
          for (const listed of piece.annotations) expect(covering.some((item) => item === listed)).toBe(true);
          position = end;
        }
        expect(position).toBe(body.length);
      }),
    );
  });

  it('orders each piece with interactive layers outermost, longer before shorter, then by id, and formatting innermost', () => {
    const rank = (item: Annotation) => (item.kind === 'format' ? 1 : 0);
    fc.assert(
      fc.property(
        text.chain((body) => annotations(inRange(body)).map((items) => [body, items] as const)),
        ([body, items]) => {
          for (const piece of composeAnnotationPieces(body, items)) {
            for (let i = 1; i < piece.annotations.length; i += 1) {
              const [a, b] = [piece.annotations[i - 1], piece.annotations[i]];
              const order = rank(a) - rank(b) || b.length - a.length || a.id.localeCompare(b.id);
              expect(order).toBeLessThanOrEqual(0);
            }
          }
        },
      ),
    );
  });

  it('places offsets in UTF-16 code units, so a span after an emoji covers the right characters', () => {
    // "A", "a", a two-unit emoji, "b": the Go importer's spans count UTF-16 units (ADR 0014), like JS string indexes.
    const body = 'Aa\u{1F600}b';
    const bold: Annotation = { id: 'format-bold-0', start: 1, end: 4, length: 3, kind: 'format' };
    const pieces = composeAnnotationPieces(body, [bold]);
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'a\u{1F600}', 'b']);
    expect(pieces.map((piece) => piece.annotations.length)).toEqual([0, 1, 0]);
  });
});

const note = (over: Partial<ManuscriptNote>): ManuscriptNote => ({
  id: 'n',
  chapter: 'c',
  paragraph: 0,
  text: 'note',
  createdAt: '2026-09-20T00:00:00Z',
  ...over,
});

const mostlyDefined = <T>(value: fc.Arbitrary<T>) => fc.oneof({ weight: 1, arbitrary: fc.constant(undefined) }, { weight: 4, arbitrary: value });

/** A note over `body`: an anchor text that is (or is not) in it, and a stored range that may be stale, wild or missing. */
const anchoredNote = fc.oneof({ weight: 1, arbitrary: anyText }, { weight: 3, arbitrary: repetitiveText }).chain((body) =>
  fc
    .record({
      anchorText: fc.oneof(
        { weight: 1, arbitrary: fc.constant(undefined) },
        { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 4 }) },
        {
          weight: 5,
          arbitrary: fc
            .integer({ min: 0, max: body.length })
            .chain((from) => fc.integer({ min: from, max: Math.min(body.length, from + 2) }).map((to) => body.slice(from, to))),
        },
      ),
      anchorStart: mostlyDefined(fc.integer({ min: -10, max: body.length + 10 })),
      anchorEnd: mostlyDefined(fc.integer({ min: -10, max: body.length + 10 })),
    })
    .map((fields) => ({ body, note: note(fields) })),
);

const occurrences = (body: string, needle: string) => Array.from({ length: body.length + 1 }, (_, at) => at).filter((at) => body.startsWith(needle, at));

/** The anchor text is in the paragraph but the stored range no longer holds it (or is unusable): the case that must be re-located. */
const isDrifted = (body: string, item: ManuscriptNote) => {
  const { anchorText: needle, anchorStart: start, anchorEnd: end } = item;
  if (!needle || !body.includes(needle) || start === undefined || end === undefined) return false;
  const from = Math.max(start, 0);
  const stored = from < end && from < body.length && body.slice(from, Math.min(end, body.length)) === needle;
  return !stored;
};

describe('resolveNoteAnchor properties', () => {
  it('never throws and only ever returns a non-empty range inside the text', () => {
    fc.assert(
      fc.property(anchoredNote, ({ body, note: item }) => {
        const anchor = resolveNoteAnchor(item, body);
        if (anchor) {
          expect(anchor.start).toBeGreaterThanOrEqual(0);
          expect(anchor.end).toBeLessThanOrEqual(body.length);
          expect(anchor.start).toBeLessThan(anchor.end);
        }
      }),
    );
  });

  it('finds the anchor text whenever it is in the paragraph', () => {
    fc.assert(
      fc.property(anchoredNote, ({ body, note: item }) => {
        fc.pre(!!item.anchorText && body.includes(item.anchorText));
        const anchor = resolveNoteAnchor(item, body);
        expect(anchor).toBeDefined();
        expect(body.slice(anchor!.start, anchor!.end)).toBe(item.anchorText);
      }),
    );
  });

  it('returns a stored range unchanged while it still holds the anchor text', () => {
    fc.assert(
      fc.property(text, fc.nat(), fc.nat(), (body, a, b) => {
        fc.pre(body.length > 0);
        const start = a % body.length;
        const end = start + 1 + (b % (body.length - start));
        const item = note({ anchorStart: start, anchorEnd: end, anchorText: body.slice(start, end) });
        expect(resolveNoteAnchor(item, body)).toEqual({ start, end });
      }),
    );
  });

  it('keeps a stored range whose start is negative rather than losing the note when the anchor text cannot be found', () => {
    expect(resolveNoteAnchor(note({ anchorStart: -3, anchorEnd: 4 }), 'abcdefgh')).toEqual({ start: 0, end: 4 });
    expect(resolveNoteAnchor(note({ anchorStart: -3, anchorEnd: 4, anchorText: 'zzz' }), 'abcdefgh')).toEqual({ start: 0, end: 4 });
    expect(resolveNoteAnchor(note({ anchorStart: -3, anchorEnd: 0 }), 'abcdefgh')).toBeUndefined();
  });

  it('when the stored range has drifted, picks the occurrence nearest to where it was stored', () => {
    fc.assert(
      fc.property(anchoredNote, ({ body, note: item }) => {
        fc.pre(isDrifted(body, item));
        const anchor = resolveNoteAnchor(item, body)!;
        const distances = occurrences(body, item.anchorText!).map((at) => Math.abs(at - item.anchorStart!));
        expect(Math.abs(anchor.start - item.anchorStart!)).toBe(Math.min(...distances));
      }),
    );
  });

  it('draws drifted, repeated, wild and missing anchors often enough that the properties above are not vacuous', () => {
    const samples = fc.sample(anchoredNote, { numRuns: 1000, seed: 1 });
    const count = (predicate: (sample: (typeof samples)[number]) => boolean) => samples.filter(predicate).length;
    expect(count(({ body, note: item }) => isDrifted(body, item))).toBeGreaterThan(20);
    expect(count(({ body, note: item }) => isDrifted(body, item) && occurrences(body, item.anchorText!).length >= 2)).toBeGreaterThan(20);
    expect(count(({ note: item }) => (item.anchorStart ?? 0) < 0)).toBeGreaterThan(20);
    expect(count(({ note: item }) => item.anchorText === undefined)).toBeGreaterThan(20);
    expect(count(({ body, note: item }) => !!item.anchorText && !body.includes(item.anchorText))).toBeGreaterThan(20);
  });
});
