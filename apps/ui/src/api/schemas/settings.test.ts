import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { settingsForScopeSchema } from './settings';

const ctx = { boundary: 'host.binding', payload: 'SystemSettingsForScope' };
const field = (overrides: Record<string, unknown>) => ({
  key: 'notify',
  label: 'Notify me',
  kind: 'bool',
  choices: null,
  value: '',
  isSet: false,
  effectiveValue: 'true',
  effectiveSource: 'repo_default',
  ...overrides,
});

describe('settingsForScopeSchema', () => {
  it('accepts the bool kind, whose value is the text "true" or "false" like every other setting', () => {
    const parsed = parseWire(settingsForScopeSchema, { General: [field({ value: 'false', isSet: true })] }, ctx);
    expect(parsed.General?.[0]).toMatchObject({ kind: 'bool', value: 'false', isSet: true, choices: [] });
  });

  it('turns the null choices of a text or colour field into an empty list', () => {
    expect(parseWire(settingsForScopeSchema, { Manuscript: [field({ kind: 'color' })] }, ctx).Manuscript?.[0]?.choices).toEqual([]);
  });

  it('rejects a field kind the page cannot render, and a value that is not text', () => {
    expect(() => parseWire(settingsForScopeSchema, { General: [field({ kind: 'slider' })] }, ctx)).toThrow(WireError);
    expect(() => parseWire(settingsForScopeSchema, { General: [field({ value: true })] }, ctx)).toThrow(WireError);
  });
});
