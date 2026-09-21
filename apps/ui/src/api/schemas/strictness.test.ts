import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { optionalFromNull } from './base';
import { unknownKeys } from './strictness';

const schema = z.object({
  id: z.string(),
  nested: z.object({ a: z.number() }),
  list: z.array(z.object({ name: z.string() })),
  maybe: z.object({ x: z.string() }).nullable(),
  optional: z.object({ y: z.string() }).optional(),
  fromNull: optionalFromNull(z.object({ z: z.string() })),
  withDefault: z.object({ d: z.string() }).default({ d: '' }),
  byKey: z.record(z.string(), z.object({ k: z.string() })),
  pair: z.tuple([z.string(), z.object({ t: z.number() })]),
  either: z.union([z.object({ kind: z.literal('a'), a: z.string() }), z.object({ kind: z.literal('b'), b: z.string() })]),
  tagged: z.discriminatedUnion('type', [z.object({ type: z.literal('one'), one: z.string() }), z.object({ type: z.literal('two'), two: z.string() })]),
});

const valid = {
  id: 'x',
  nested: { a: 1 },
  list: [{ name: 'n' }],
  maybe: { x: 's' },
  optional: { y: 's' },
  fromNull: { z: 's' },
  withDefault: { d: 's' },
  byKey: { first: { k: 'v' } },
  pair: ['p', { t: 1 }],
  either: { kind: 'b', b: 's' },
  tagged: { type: 'two', two: 's' },
};

describe('unknownKeys', () => {
  it('finds nothing in a payload that declares every key', () => {
    expect(unknownKeys(schema, valid)).toEqual([]);
  });

  it.each([
    ['at the top level', { ...valid, extra: 1 }, ['extra']],
    ['in a nested object', { ...valid, nested: { a: 1, more: 2 } }, ['nested.more']],
    ['in an array item', { ...valid, list: [{ name: 'n' }, { name: 'm', oops: 1 }] }, ['list[1].oops']],
    ['under a nullable', { ...valid, maybe: { x: 's', q: 1 } }, ['maybe.q']],
    ['under an optional', { ...valid, optional: { y: 's', q: 1 } }, ['optional.q']],
    ['under a null-to-undefined field', { ...valid, fromNull: { z: 's', q: 1 } }, ['fromNull.q']],
    ['under a default', { ...valid, withDefault: { d: 's', q: 1 } }, ['withDefault.q']],
    ['in a record value', { ...valid, byKey: { first: { k: 'v', q: 1 } } }, ['byKey.first.q']],
    ['in a tuple item', { ...valid, pair: ['p', { t: 1, q: 1 }] }, ['pair[1].q']],
    ['in the matching union branch', { ...valid, either: { kind: 'a', a: 's', q: 1 } }, ['either.q']],
    ['in the matching discriminated branch', { ...valid, tagged: { type: 'one', one: 's', q: 1 } }, ['tagged.q']],
  ])('finds an undeclared key %s', (_name, payload, expected) => {
    expect(unknownKeys(schema, payload)).toEqual(expected);
  });

  it('refuses a schema kind it cannot walk, instead of silently reporting nothing', () => {
    expect(() =>
      unknownKeys(
        z.lazy(() => z.object({ a: z.string() })),
        { a: 'x', b: 1 },
      ),
    ).toThrow(/does not know the schema kind "lazy"/);
  });

  it('does not look under a value that is null, missing or not an object', () => {
    expect(unknownKeys(schema, { ...valid, maybe: null, optional: undefined, fromNull: null })).toEqual([]);
    expect(unknownKeys(schema, 'not an object')).toEqual([]);
  });
});
