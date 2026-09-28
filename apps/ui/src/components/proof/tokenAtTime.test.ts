import { describe, expect, it } from 'vitest';
import type { WorkspaceItem, WorkspaceToken } from '../../api/contracts/workspace';
import { buildTokenIndex, currentTokenIndex, seekTargetForToken } from './tokenAtTime';

const items: WorkspaceItem[] = [
  { index: 0, itemGuid: '{item-0}', live: true, sourceStart: 0 },
  { index: 1, itemGuid: '{item-1}', live: true, sourceStart: 20 },
];

const tokens: WorkspaceToken[] = [
  { i: 0, w: 0, text: 'Once', status: 'read', item: 0, start: 0, end: 0.4 },
  { i: 1, w: 1, text: 'upon', status: 'read', item: 0, start: 0.4, end: 0.8 },
  { i: 2, w: 2, text: 'a', status: 'skip' }, // no time: a skipped word
  { i: 3, w: 3, text: 'time,', status: 'read', item: 0, start: 0.8, end: 1.3 },
  { i: 4, w: 0, text: 'she', status: 'read', item: 1, start: 20, end: 20.3 },
];

describe('currentTokenIndex', () => {
  const index = buildTokenIndex(tokens);

  it('finds the token whose interval contains the playhead', () => {
    expect(currentTokenIndex(index, items, '{item-0}', 0.5)).toBe(1);
  });

  it('finds the nearest token before the playhead during a pause (a skipped word)', () => {
    expect(currentTokenIndex(index, items, '{item-0}', 0.79)).toBe(1);
  });

  it('never crosses into another item’s tokens', () => {
    expect(currentTokenIndex(index, items, '{item-1}', 20.1)).toBe(4);
  });

  it('is undefined before the item’s first timed token', () => {
    expect(currentTokenIndex(index, items, '{item-0}', -1)).toBeUndefined();
  });

  it('is undefined for an unknown item GUID', () => {
    expect(currentTokenIndex(index, items, '{missing}', 1)).toBeUndefined();
  });

  it('is undefined with no itemGuid (nothing loaded yet)', () => {
    expect(currentTokenIndex(index, items, undefined, 1)).toBeUndefined();
  });

  it('holds the last token past the item’s final interval (still reading it during the pause after)', () => {
    expect(currentTokenIndex(index, items, '{item-0}', 99)).toBe(3);
  });
});

describe('seekTargetForToken', () => {
  it('resolves to the token’s item and applies the pre-roll', () => {
    expect(seekTargetForToken(tokens[3], items, 1)).toEqual({ itemGuid: '{item-0}', sourceTime: 0 });
  });

  it('clamps the pre-roll to the item’s own played start, never before it', () => {
    expect(seekTargetForToken(tokens[0], items, 1)).toEqual({ itemGuid: '{item-0}', sourceTime: 0 });
  });

  it('is undefined for a token with no recorded time (a skip)', () => {
    expect(seekTargetForToken(tokens[2], items, 1)).toBeUndefined();
  });

  it('is undefined when the item is no longer live in the saved project', () => {
    const goneItems: WorkspaceItem[] = [{ index: 0, itemGuid: '{item-0}', live: false }];
    expect(seekTargetForToken(tokens[3], goneItems, 1)).toBeUndefined();
  });
});
