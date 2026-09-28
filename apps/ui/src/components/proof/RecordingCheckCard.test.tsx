// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ManuscriptChapter } from '../../api/contracts/manuscript';
import type { WorkspaceAlignmentResult } from '../../api/contracts/workspace';
import type { Flag } from './flags';
import { checkSentence, RecordingCheckCard } from './RecordingCheckCard';

afterEach(cleanup);

const flag = (kind: Flag['kind']): Flag => ({ id: kind, kind, label: kind, tokenStart: 0, tokenEnd: 0 });

const CHAPTER: ManuscriptChapter = {
  id: 'ch1',
  title: 'A Mad Tea-Party',
  index: 7,
  wordCount: 1200,
  recordedFraction: 0.97,
  recordedSeconds: 708,
  status: 'proofing',
};

const CURRENT_ALIGNMENT: WorkspaceAlignmentResult = {
  chapterId: 'ch1',
  state: 'current',
  reasons: [],
  basis: { label: 'take 4', modifiedAt: '2026-09-28T10:02:00Z', stale: false },
  needsAlignAgain: false,
  paragraphs: [],
  tokens: [],
  extras: [],
  items: [],
};

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

describe('RecordingCheckCard figures (mock-fidelity-primitives-and-components.prd.md Phase 9: the hand-drawn dl becomes StatTile)', () => {
  it('draws Recorded and Length as one figures strip, not a bare dl', () => {
    render(<RecordingCheckCard chapter={CHAPTER} alignment={CURRENT_ALIGNMENT} flags={[]} />);
    const strip = screen.getByRole('list', { name: 'Recording check figures' });
    expect(strip).toBeTruthy();
    expect(screen.getByText('Recorded')).toBeTruthy();
    expect(screen.getByText('97%')).toBeTruthy();
    expect(screen.getByText('Length')).toBeTruthy();
    expect(screen.getByText('11:48')).toBeTruthy();
  });

  it('omits the figures strip entirely when there is nothing to show', () => {
    render(<RecordingCheckCard chapter={{ ...CHAPTER, recordedFraction: undefined, recordedSeconds: undefined }} alignment={CURRENT_ALIGNMENT} flags={[]} />);
    expect(screen.queryByRole('list', { name: 'Recording check figures' })).toBeNull();
  });
});
