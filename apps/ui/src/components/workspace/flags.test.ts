import { describe, expect, it } from 'vitest';
import type { WorkspaceExtra, WorkspaceToken } from '../../api/contracts/workspace';
import { buildFlags } from './flags';

function token(overrides: Partial<WorkspaceToken>): WorkspaceToken {
  return { i: 0, w: 0, text: 'word', status: 'read', ...overrides };
}

describe('buildFlags', () => {
  it('produces no flags for plain read tokens', () => {
    expect(buildFlags([token({ i: 0 }), token({ i: 1 })], [])).toEqual([]);
  });

  it('groups a run of consecutive skipped tokens into one flag', () => {
    const tokens = [token({ i: 0 }), token({ i: 1, status: 'skip' }), token({ i: 2, status: 'skip' }), token({ i: 3 })];
    const flags = buildFlags(tokens, []);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'skip', tokenStart: 1, tokenEnd: 2 });
  });

  it('splits two separate skip runs into two flags', () => {
    const tokens = [token({ i: 0, status: 'skip' }), token({ i: 1 }), token({ i: 2, status: 'skip' })];
    expect(buildFlags(tokens, [])).toHaveLength(2);
  });

  it('never merges a misread with its neighbours, even other misreads', () => {
    const tokens = [token({ i: 0, status: 'misread', heard: 'a' }), token({ i: 1, status: 'misread', heard: 'b' })];
    const flags = buildFlags(tokens, []);
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.heard)).toEqual(['a', 'b']);
  });

  it('groups short_read and different_text together as "partial"', () => {
    const tokens = [token({ i: 0, status: 'short_read' }), token({ i: 1, status: 'different_text' })];
    const flags = buildFlags(tokens, []);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('partial');
  });

  it('labels head and tail as "not recorded yet"', () => {
    const flags = buildFlags([token({ i: 0, status: 'tail' })], []);
    expect(flags[0]).toMatchObject({ kind: 'not_recorded', label: 'Not recorded yet' });
  });

  it('carries the run’s first timed token as its seek target', () => {
    const tokens = [token({ i: 0, status: 'short_read' }), token({ i: 1, status: 'short_read', item: 0, start: 1, end: 1.4 })];
    const flags = buildFlags(tokens, []);
    expect(flags[0].seekTokenIndex).toBe(1);
  });

  it('leaves seekTokenIndex undefined for a run with no recorded time at all (a pure skip)', () => {
    const flags = buildFlags([token({ i: 0, status: 'skip' })], []);
    expect(flags[0].seekTokenIndex).toBeUndefined();
  });

  it('includes one flag per extra (unmatched audio) run, ordered by where it happened', () => {
    const tokens = [token({ i: 0 }), token({ i: 1 })];
    const extras: WorkspaceExtra[] = [
      {
        text: 'again again',
        tokens: 2,
        start: { itemIndex: 0, itemGuid: '{a}', sourceTime: 1 },
        end: { itemIndex: 0, itemGuid: '{a}', sourceTime: 1.5 },
        afterToken: 0,
      },
    ];
    const flags = buildFlags(tokens, extras);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'extra', heard: 'again again' });
  });

  it('orders token flags and extras together by position', () => {
    const tokens = [token({ i: 0 }), token({ i: 1, status: 'skip' }), token({ i: 2 })];
    const extras: WorkspaceExtra[] = [
      {
        text: 'oops',
        tokens: 1,
        start: { itemIndex: 0, itemGuid: '{a}', sourceTime: 0 },
        end: { itemIndex: 0, itemGuid: '{a}', sourceTime: 0.2 },
        afterToken: 2,
      },
    ];
    const flags = buildFlags(tokens, extras);
    expect(flags.map((flag) => flag.kind)).toEqual(['skip', 'extra']);
  });
});
