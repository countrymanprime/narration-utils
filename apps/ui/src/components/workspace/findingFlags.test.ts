import { describe, expect, it } from 'vitest';
import type { Finding } from '../../types';
import type { WorkspaceItem, WorkspaceToken } from '../../api/contracts/workspace';
import { buildFlags } from './flags';
import { overlayFindings } from './findingFlags';

const ITEM_GUID = '{item-1}';
const ITEMS: WorkspaceItem[] = [{ index: 0, itemGuid: ITEM_GUID, live: true, sourceStart: 0, playRate: 1 }];

function token(overrides: Partial<WorkspaceToken>): WorkspaceToken {
  return { i: 0, w: 0, text: 'word', status: 'read', ...overrides };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    schema_version: 1,
    id: 'f1',
    analyzer: 'transcript-compare',
    project: {},
    source: { item_guid: ITEM_GUID },
    time_range: { start: 1, end: 1.4, source_start: 1, source_end: 1.4 },
    category: 'transcript_discrepancy',
    severity: 'warning',
    confidence: 0.9,
    confidence_reason: '',
    review: { status: 'unreviewed' },
    ...overrides,
  };
}

describe('overlayFindings', () => {
  it('attaches a transcript_discrepancy finding to the overlapping check-derived misread flag, without duplicating it', () => {
    const tokens = [token({ i: 0, status: 'misread', heard: 'orangeade', item: 0, start: 1, end: 1.4 })];
    const flags = buildFlags(tokens, []);
    const merged = overlayFindings(flags, [finding({})], ITEMS, tokens);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'misread', findingId: 'f1', analyzer: 'transcript-compare', confidence: 0.9 });
  });

  it('attaches a duplicate_read finding to the overlapping extra flag', () => {
    const tokens = [token({ i: 0, item: 0, start: 1, end: 1.4 }), token({ i: 1 })];
    const flags = buildFlags(tokens, [
      {
        text: 'again',
        tokens: 1,
        start: { itemIndex: 0, itemGuid: ITEM_GUID, sourceTime: 1 },
        end: { itemIndex: 0, itemGuid: ITEM_GUID, sourceTime: 1.4 },
        afterToken: 0,
      },
    ]);
    const merged = overlayFindings(flags, [finding({ category: 'duplicate_read', analyzer: 'take-review' })], ITEMS, tokens);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'extra', findingId: 'f1', analyzer: 'take-review' });
  });

  it('adds a standalone pickup flag anchored on the overlapping tokens when nothing already flags them', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    const merged = overlayFindings([], [finding({ category: 'pickup', analyzer: 'take-review' })], ITEMS, tokens);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'pickup', findingId: 'f1', tokenStart: 0, tokenEnd: 0 });
  });

  it('adds a standalone cleanup flag for a silence_cleanup finding', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    const merged = overlayFindings([], [finding({ category: 'silence_cleanup', analyzer: 'editing' })], ITEMS, tokens);
    expect(merged[0]).toMatchObject({ kind: 'cleanup', findingId: 'f1' });
  });

  it('leaves a finding off the text when its item is not in the current alignment (a stale or unlinked item)', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    const merged = overlayFindings([], [finding({ source: { item_guid: '{gone}' } })], ITEMS, tokens);
    expect(merged).toHaveLength(0);
  });

  it('leaves a finding off the text when its range overlaps nothing heard', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    const merged = overlayFindings([], [finding({ time_range: { start: 50, end: 50.4, source_start: 50, source_end: 50.4 } })], ITEMS, tokens);
    expect(merged).toHaveLength(0);
  });

  it('leaves a finding off the text when it has no item GUID or no time range', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    expect(overlayFindings([], [finding({ source: {} })], ITEMS, tokens)).toHaveLength(0);
    expect(overlayFindings([], [finding({ time_range: undefined })], ITEMS, tokens)).toHaveLength(0);
  });

  it('excludes a finding the latest run did not reproduce', () => {
    const tokens = [token({ i: 0, status: 'misread', heard: 'orangeade', item: 0, start: 1, end: 1.4 })];
    const flags = buildFlags(tokens, []);
    const merged = overlayFindings(flags, [finding({ not_in_latest_run: true })], ITEMS, tokens);
    expect(merged[0].findingId).toBeUndefined();
  });

  it('leaves a category with no text-overlay mapping (take_comparison) off the text', () => {
    const tokens = [token({ i: 0, status: 'read', item: 0, start: 1, end: 1.4 })];
    const merged = overlayFindings([], [finding({ category: 'take_comparison' })], ITEMS, tokens);
    expect(merged).toHaveLength(0);
  });

  it('keeps flags without a finding untouched and sorted alongside added ones', () => {
    const tokens = [token({ i: 0, status: 'skip' }), token({ i: 1, status: 'read', item: 0, start: 1, end: 1.4 })];
    const flags = buildFlags(tokens, []);
    const merged = overlayFindings(
      flags,
      [finding({ category: 'pickup', time_range: { start: 1, end: 1.4, source_start: 1, source_end: 1.4 } })],
      ITEMS,
      tokens,
    );
    expect(merged.map((flag) => flag.kind)).toEqual(['skip', 'pickup']);
    expect(merged[0].findingId).toBeUndefined();
  });
});
