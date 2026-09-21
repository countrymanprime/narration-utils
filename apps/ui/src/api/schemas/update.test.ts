import { describe, expect, it } from 'vitest';
import { parseWire } from '../wire/parseWire';
import { WireError } from '../wire/WireError';
import { updateJobSchema, updateStatusSchema } from './update';

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
  canInstall: true,
  installBlockedReason: '',
  downloaded: null,
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
    ['no canInstall', { ...status, canInstall: undefined }],
    ['no downloaded (the host sends null, never nothing)', { ...status, downloaded: undefined }],
    ['a downloaded update with no job', { ...status, downloaded: { version: '0.2.7' } }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseWire(updateStatusSchema, value, ctx)).toThrow(WireError);
  });
});

const job = { id: 'update-1', version: '0.2.7', phase: 'downloading', message: 'Downloading', percent: 40, bytesDone: 4, bytesTotal: 10, error: '' };

describe('updateJobSchema', () => {
  it.each(['downloading', 'verifying', 'unpacking', 'ready', 'installing', 'error', 'cancelled'])('accepts the phase %s', (phase) => {
    expect(parseWire(updateJobSchema, { ...job, phase }, ctx).phase).toBe(phase);
  });

  it.each([
    ['a phase it does not know', { ...job, phase: 'restarting' }],
    ['a percent over 100', { ...job, percent: 101 }],
    ['a negative percent', { ...job, percent: -1 }],
    ['negative bytes', { ...job, bytesDone: -1 }],
    ['bytes that are text', { ...job, bytesTotal: '10' }],
    ['no error text', { ...job, error: undefined }],
    ['no id', { ...job, id: undefined }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseWire(updateJobSchema, value, ctx)).toThrow(WireError);
  });
});
