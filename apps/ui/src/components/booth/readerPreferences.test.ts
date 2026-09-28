// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FLAG_VISIBILITY } from './readerFlags';
import { DEFAULT_RAIL, FLAG_STORAGE_KEY, loadFlagVisibility, loadRailState, RAIL_STORAGE_KEY, saveFlagVisibility, saveRailState } from './readerPreferences';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('read-aloud rail preferences', () => {
  it('round-trips the rail state through browser storage', () => {
    saveRailState({ open: false, tab: 'notes' });
    expect(loadRailState()).toEqual({ open: false, tab: 'notes' });
    saveRailState({ open: true, tab: 'flags' });
    expect(loadRailState()).toEqual({ open: true, tab: 'flags' });
  });

  it('falls back to the default when nothing, garbage or an unknown tab is stored', () => {
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    window.localStorage.setItem(RAIL_STORAGE_KEY, '{not json');
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ open: 'yes', tab: 'marks' }));
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    window.localStorage.setItem(RAIL_STORAGE_KEY, 'null');
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
  });

  it('survives storage that throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    expect(() => saveRailState({ open: true, tab: 'bible' })).not.toThrow();
  });
});

describe('read-aloud flag visibility preferences', () => {
  it('starts from the owner default and round-trips the narrator’s choice', () => {
    expect(loadFlagVisibility()).toEqual(DEFAULT_FLAG_VISIBILITY);
    saveFlagVisibility({ ...DEFAULT_FLAG_VISIBILITY, misread: true });
    expect(loadFlagVisibility()).toEqual({ ...DEFAULT_FLAG_VISIBILITY, misread: true });
  });

  it('takes the default for any kind that is missing or not a boolean, and for garbage', () => {
    window.localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify({ extra: true, skipped: 'no' }));
    expect(loadFlagVisibility()).toEqual({ ...DEFAULT_FLAG_VISIBILITY, extra: true });
    window.localStorage.setItem(FLAG_STORAGE_KEY, '[1, 2');
    expect(loadFlagVisibility()).toEqual(DEFAULT_FLAG_VISIBILITY);
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(loadFlagVisibility()).toEqual(DEFAULT_FLAG_VISIBILITY);
    expect(() => saveFlagVisibility(DEFAULT_FLAG_VISIBILITY)).not.toThrow();
  });
});
