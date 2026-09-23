// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RAIL, loadRailState, RAIL_STORAGE_KEY, saveRailState } from './readerPreferences';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('read-aloud rail preferences', () => {
  it('round-trips the rail state through browser storage', () => {
    saveRailState({ open: false, tab: 'notes' });
    expect(loadRailState()).toEqual({ open: false, tab: 'notes' });
  });

  it('falls back to the default when nothing, garbage or an unknown tab is stored', () => {
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    window.localStorage.setItem(RAIL_STORAGE_KEY, '{not json');
    expect(loadRailState()).toEqual(DEFAULT_RAIL);
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ open: 'yes', tab: 'flags' }));
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
