import { describe, expect, it } from 'vitest';
import type { WorkspaceToken } from '../../api/contracts/workspace';
import type { Discrepancy } from '../../types';
import { buildFlags } from './flags';
import { overlayDiscrepancies } from './compareFlags';

function token(overrides: Partial<WorkspaceToken>): WorkspaceToken {
  return { i: 0, w: 0, text: 'word', status: 'read', ...overrides };
}

function row(overrides: Partial<Discrepancy>): Discrepancy {
  return { id: 'd', kind: 'MISREAD', name: '', docText: '', audioText: '', projectTime: 3, itemIndex: 0, srcpos: 0, paragraph: 7, ...overrides };
}

// Paragraph p1 is the manuscript's paragraph 7: "a White Rabbit ran", its first word timed; p2 (paragraph 8) never heard.
const TOKENS = [
  token({ i: 0, p: 'p1', text: 'a', start: 1, end: 1.2 }),
  token({ i: 1, p: 'p1', text: 'White', start: 1.3, end: 1.6, status: 'misread', heard: 'wide' }),
  token({ i: 2, p: 'p1', text: 'Rabbit,', start: 1.7, end: 2 }),
  token({ i: 3, p: 'p1', text: 'ran', start: 2.1, end: 2.4 }),
  token({ i: 4, p: 'p2', text: 'Oh' }),
  token({ i: 5, p: 'p2', text: 'dear' }),
];
const PARAGRAPH_IDS = [
  { id: 'p1', index: 7 },
  { id: 'p2', index: 8 },
];

describe('overlayDiscrepancies', () => {
  it('attaches a misread to the flag the check already put on its word, rather than adding a second one', () => {
    const flags = overlayDiscrepancies(buildFlags(TOKENS, []), [row({ id: 'd1', docText: 'White Rabbit', audioText: 'wide rabbit' })], TOKENS, PARAGRAPH_IDS);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'misread', tokenStart: 1, discrepancy: { id: 'd1' } });
  });

  it('adds its own flag on the word it names when the check flagged nothing there, matching past punctuation and case', () => {
    const flags = overlayDiscrepancies([], [row({ id: 'd2', docText: 'rabbit ran', audioText: 'rabbit' })], TOKENS, PARAGRAPH_IDS);
    expect(flags).toEqual([
      expect.objectContaining({
        id: 'compare-d2',
        kind: 'misread',
        tokenStart: 2,
        seekTokenIndex: 2,
        script: 'rabbit ran',
        heard: 'rabbit',
        analyzer: 'transcript-compare',
      }),
    ]);
  });

  it('places a skip and an extra at their paragraph, with nothing to seek to when that paragraph was never heard', () => {
    const flags = overlayDiscrepancies(
      [],
      [
        row({ id: 'd3', kind: 'EXTRA', docText: '(nothing written)', audioText: 'oh dear, oh dear', paragraph: 8 }),
        row({ id: 'd4', kind: 'SKIPPED', docText: 'dear', paragraph: 8 }),
      ],
      TOKENS,
      PARAGRAPH_IDS,
    );
    expect(flags.map((flag) => [flag.id, flag.kind, flag.tokenStart, flag.seekTokenIndex])).toEqual([
      ['compare-d3', 'extra', 4, undefined],
      ['compare-d4', 'skip', 5, undefined],
    ]);
  });

  it('keeps a discrepancy whose paragraph is not in this alignment, first, so it is never lost', () => {
    const flags = overlayDiscrepancies(buildFlags(TOKENS, []), [row({ id: 'd5', paragraph: 99, docText: 'Queen' })], TOKENS, PARAGRAPH_IDS);
    expect(flags[0]).toMatchObject({ id: 'compare-d5', tokenStart: -1, script: 'Queen' });
    expect(flags).toHaveLength(2);
  });

  it('never attaches two discrepancies to one flag', () => {
    const rows = [row({ id: 'a', docText: 'White' }), row({ id: 'b', docText: 'White' })];
    const flags = overlayDiscrepancies(buildFlags(TOKENS, []), rows, TOKENS, PARAGRAPH_IDS);
    expect(flags.map((flag) => flag.discrepancy?.id)).toEqual(['a', 'b']);
  });

  it('returns the flags untouched with no results', () => {
    const flags = buildFlags(TOKENS, []);
    expect(overlayDiscrepancies(flags, [], TOKENS, PARAGRAPH_IDS)).toEqual(flags);
  });
});
