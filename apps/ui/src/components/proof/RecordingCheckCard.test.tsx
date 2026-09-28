import { describe, expect, it } from 'vitest';
import type { Flag } from './flags';
import { checkSentence } from './RecordingCheckCard';

const flag = (kind: Flag['kind']): Flag => ({ id: kind, kind, label: kind, tokenStart: 0, tokenEnd: 0 });

describe('checkSentence (edit-and-proof mock 01: "2 regions not read, 3 misreads, 2 repeats.")', () => {
  it('names only the kinds the check found, counted', () => {
    expect(checkSentence([flag('skip'), flag('not_recorded'), flag('misread'), flag('misread'), flag('misread')])).toBe('2 regions not read, 3 misreads.');
    expect(checkSentence([flag('partial'), flag('extra')])).toBe('1 read short, 1 extra passage.');
  });

  it('says so when nothing is flagged, and ignores notes that are not the check’s own', () => {
    expect(checkSentence([])).toBe('Nothing flagged.');
    expect(checkSentence([flag('pickup'), flag('cleanup')])).toBe('Nothing flagged.');
  });
});
