import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { updateStatusSchema } from './update';

const ctx = { boundary: 'host.binding', payload: 'UpdateStatus' };

const available = {
  version: '0.2.7',
  tag: 'v0.2.7-rc',
  candidate: true,
  notesUrl: 'https://github.com/countrymanprime/narration-utils/releases/tag/v0.2.7-rc',
  size: 419895808,
  publishedAt: '2026-09-20T10:00:00Z',
  replaces: true,
};
const status = {
  version: '0.2.6',
  development: false,
  platform: 'windows-x64',
  channel: 'candidates',
  lastChecked: '2026-09-21T12:00:00Z',
  failure: '',
  available,
};

describe('updateStatusSchema', () => {
  it('accepts a status with a release and one without', () => {
    expect(parseWire(updateStatusSchema, status, ctx).available?.version).toBe('0.2.7');
    expect(parseWire(updateStatusSchema, { ...status, available: null }, ctx).available).toBeNull();
  });

  it('accepts both channels and nothing else', () => {
    expect(parseWire(updateStatusSchema, { ...status, channel: 'stable' }, ctx).channel).toBe('stable');
    expect(() => parseWire(updateStatusSchema, { ...status, channel: 'beta' }, ctx)).toThrow(WireError);
  });

  it.each([
    ['a missing version', { ...status, version: undefined }],
    ['a version that is a number', { ...status, version: 7 }],
    ['a missing available (the host sends null, never nothing)', { ...status, available: undefined }],
    ['a release with a size that is text', { ...status, available: { ...available, size: 'big' } }],
    ['a release with no notes address', { ...status, available: { ...available, notesUrl: undefined } }],
    ['a development flag that is text', { ...status, development: 'yes' }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseWire(updateStatusSchema, value, ctx)).toThrow(WireError);
  });
});
