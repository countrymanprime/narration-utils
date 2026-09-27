import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { EMPTY_KEYMAP_OVERRIDES, keymapOverridesSchema } from './keymap';

const ctx = { boundary: 'host.binding', payload: 'Keymap.overrides' };

describe('keymapOverridesSchema', () => {
  it('accepts the empty document a fresh install starts from', () => {
    expect(parseWire(keymapOverridesSchema, EMPTY_KEYMAP_OVERRIDES, ctx)).toEqual({ version: 1, bindings: {} });
  });

  it('accepts one gesture list per remapped command id', () => {
    const document = { version: 1, bindings: { 'reading.toggle': ['PageDown'], 'nav.back': ['Alt+ArrowLeft', 'BrowserBack'] } };
    expect(parseWire(keymapOverridesSchema, document, ctx)).toEqual(document);
  });

  it('rejects a version other than 1, a gesture that is not a string, and a non-array binding', () => {
    expect(() => parseWire(keymapOverridesSchema, { version: 2, bindings: {} }, ctx)).toThrow(WireError);
    expect(() => parseWire(keymapOverridesSchema, { version: 1, bindings: { 'nav.back': [1] } }, ctx)).toThrow(WireError);
    expect(() => parseWire(keymapOverridesSchema, { version: 1, bindings: { 'nav.back': 'Alt+ArrowLeft' } }, ctx)).toThrow(WireError);
  });
});
