import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseWire, parseWireJson, type WireContext } from './parseWire';
import { WireError, USER_MESSAGE } from './WireError';
import type { StandardSchemaV1 } from './standardSchema';

const ctx: WireContext = { boundary: 'host.binding', payload: 'Sample' };
const sample = z.object({ id: z.string(), count: z.number(), tags: z.array(z.object({ name: z.string() })) });

describe('parseWire', () => {
  it('returns the parsed value for a payload that matches', () => {
    expect(parseWire(sample, { id: 'a', count: 2, tags: [{ name: 'x' }] }, ctx)).toEqual({ id: 'a', count: 2, tags: [{ name: 'x' }] });
  });

  it('ignores keys the schema does not declare, so a newer host still loads (lenient reads)', () => {
    const parsed = parseWire(sample, { id: 'a', count: 2, tags: [], added: 'later' }, ctx);
    expect(parsed).toEqual({ id: 'a', count: 2, tags: [] });
  });

  it('throws a WireError naming the boundary, the payload and every failing path', () => {
    const bad = { id: 4, tags: [{ name: 'ok' }, { name: 9 }] };
    let caught: unknown;
    try {
      parseWire(sample, bad, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WireError);
    const wire = caught as WireError;
    expect(wire.boundary).toBe('host.binding');
    expect(wire.payload).toBe('Sample');
    expect(wire.issues.map((issue) => issue.path)).toEqual(['id', 'count', 'tags[1].name']);
    expect(wire.userMessage).toBe(USER_MESSAGE);
    expect(wire.details()).toContain('host.binding Sample');
    expect(wire.details()).toContain('tags[1].name');
  });

  it('never puts a payload value in the error, whatever kind of rule failed', () => {
    const secret = 'CHAPTER-ONE-TEXT-THAT-MUST-NOT-LEAK';
    const strict = z.object({ kind: z.enum(['a', 'b']), fixed: z.literal('x'), n: z.number(), either: z.union([z.number(), z.boolean()]) });
    let caught: unknown;
    try {
      parseWire(strict, { kind: secret, fixed: secret, n: secret, either: secret, [secret]: secret }, ctx);
    } catch (error) {
      caught = error;
    }
    const wire = caught as WireError;
    expect(wire.issues.length).toBeGreaterThan(0);
    expect(wire.message).not.toContain(secret);
    expect(wire.details()).not.toContain(secret);
    expect(JSON.stringify(wire.issues)).not.toContain(secret);
  });

  it('caps a long issue list and says how many were left out', () => {
    const wide = z.object(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`f${index}`, z.string()])));
    const wire = (() => {
      try {
        return parseWire(wide, {}, ctx);
      } catch (error) {
        return error as WireError;
      }
    })() as WireError;
    expect(wire.issues).toHaveLength(10);
    expect(wire.omitted).toBe(15);
    expect(wire.details()).toContain('15 more');
  });

  it('formats root and numeric paths', () => {
    const list = z.array(z.number());
    try {
      parseWire(list, [1, 'x'], ctx);
      expect.unreachable();
    } catch (error) {
      expect((error as WireError).issues[0]?.path).toBe('[1]');
    }
    try {
      parseWire(list, 'not a list', ctx);
      expect.unreachable();
    } catch (error) {
      expect((error as WireError).issues[0]?.path).toBe('(root)');
    }
  });

  it('accepts any Standard Schema, not only Zod (the library stays swappable)', () => {
    const handWritten: StandardSchemaV1<unknown, number> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => (typeof value === 'number' ? { value } : { issues: [{ message: 'expected a number', path: ['n'] }] }),
      },
    };
    expect(parseWire(handWritten, 3, ctx)).toBe(3);
    expect(() => parseWire(handWritten, 'x', ctx)).toThrow(WireError);
  });

  it('refuses a schema that validates asynchronously', () => {
    const asyncSchema: StandardSchemaV1<unknown, number> = {
      '~standard': { version: 1, vendor: 'test', validate: () => Promise.resolve({ value: 1 }) },
    };
    expect(() => parseWire(asyncSchema, 1, ctx)).toThrow(/synchronous/);
  });
});

describe('parseWireJson', () => {
  it('parses a JSON string and validates it', () => {
    expect(parseWireJson(sample, '{"id":"a","count":1,"tags":[]}', ctx)).toEqual({ id: 'a', count: 1, tags: [] });
  });

  it('turns text that is not JSON into a WireError that does not quote the text', () => {
    try {
      parseWireJson(sample, 'this is not json {"secret": 1', ctx);
      expect.unreachable();
    } catch (error) {
      const wire = error as WireError;
      expect(wire).toBeInstanceOf(WireError);
      expect(wire.issues[0]?.message).toBe('not valid JSON');
      expect(wire.details()).not.toContain('secret');
    }
  });

  it('treats an empty string as no value, which only a schema that accepts undefined allows', () => {
    expect(parseWireJson(z.undefined(), '', ctx)).toBeUndefined();
    expect(() => parseWireJson(sample, '', ctx)).toThrow(WireError);
  });
});
