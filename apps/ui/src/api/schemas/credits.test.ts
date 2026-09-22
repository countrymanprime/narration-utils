import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { creditsProjectValuesResultSchema, creditsRenderResultSchema, creditTemplateSchema, creditTemplatesSchema } from './credits';

const ctx = { boundary: 'host.binding', payload: 'test' };

describe('creditTemplateSchema / creditTemplatesSchema', () => {
  it('accepts a template with builtIn omitted (a narrator-added one)', () => {
    const parsed = parseWire(creditTemplateSchema, { id: 't-1', kind: 'opening', name: 'Mine', body: '[Title]' }, ctx);
    expect(parsed.builtIn).toBeUndefined();
  });

  it('accepts builtIn true for a shipped default', () => {
    const parsed = parseWire(
      creditTemplateSchema,
      { id: 'default-opening-acx-minimum', kind: 'opening', name: 'ACX minimum', body: '[Title]', builtIn: true },
      ctx,
    );
    expect(parsed.builtIn).toBe(true);
  });

  it('turns a null template list into an empty one', () => {
    expect(parseWire(creditTemplatesSchema, null, ctx)).toEqual([]);
  });

  it('rejects a template missing a required field', () => {
    expect(() => parseWire(creditTemplateSchema, { id: 't-1', kind: 'opening', name: 'Mine' }, ctx)).toThrow(WireError);
  });
});

describe('creditsRenderResultSchema', () => {
  it('turns a null unresolved list into an empty one (every token resolved)', () => {
    const parsed = parseWire(creditsRenderResultSchema, { text: 'Neon.', words: 1, unresolved: null }, ctx);
    expect(parsed.unresolved).toEqual([]);
  });

  it('keeps the unresolved token names in order', () => {
    const parsed = parseWire(creditsRenderResultSchema, { text: 'Read by [Narrator].', words: 3, unresolved: ['Narrator'] }, ctx);
    expect(parsed.unresolved).toEqual(['Narrator']);
  });
});

describe('creditsProjectValuesResultSchema', () => {
  it('accepts an empty values object (a project with no credits saved yet)', () => {
    const parsed = parseWire(creditsProjectValuesResultSchema, { values: {}, narratorGlobal: '', suggestions: {} }, ctx);
    expect(parsed.values).toEqual({});
    expect(parsed.suggestions).toEqual({});
  });

  it('accepts suggestions seeded from the manuscript (never required, always optional to use)', () => {
    const parsed = parseWire(
      creditsProjectValuesResultSchema,
      { values: { title: 'Neon' }, narratorGlobal: 'A. Narrator', suggestions: { Title: 'Neon (suggested)', Author: 'A. Writer' } },
      ctx,
    );
    expect(parsed.suggestions).toEqual({ Title: 'Neon (suggested)', Author: 'A. Writer' });
  });
});
