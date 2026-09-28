// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WaveformStrip } from './WaveformStrip';
import type { PlaylistSegment } from './playlist';
import type { WorkspacePeaksResult, WorkspaceToken } from '../../api/contracts/workspace';
import type { Flag } from './flags';

const playlist: PlaylistSegment[] = [
  { itemGuid: 'g1', sourceFile: 'a.wav', sourceStart: 0, sourceEnd: 10, elapsedStart: 0, elapsedEnd: 10, overlapsPrevious: false },
];

const peaks: WorkspacePeaksResult = {
  chapterId: 'c-0001',
  items: [{ index: 0, peaks: { startSeconds: 0, bucketsPerSecond: 50, buckets: 500, minMax: 'AAA=', sampleRate: 48000, channels: 1 } }],
};

describe('WaveformStrip', () => {
  afterEach(cleanup);

  it('renders a labelled region without throwing, even with no ResizeObserver (jsdom)', () => {
    render(
      <WaveformStrip
        playlist={playlist}
        alignmentItems={[{ index: 0, itemGuid: 'g1', live: true }]}
        peaks={peaks}
        tokens={[]}
        flags={[]}
        elapsed={3}
        duration={10}
      />,
    );
    expect(screen.getByRole('region', { name: "The chapter's waveform" })).toBeTruthy();
  });

  it('renders with no peaks loaded yet and no live items', () => {
    render(<WaveformStrip playlist={[]} alignmentItems={[]} peaks={undefined} tokens={[]} flags={[]} elapsed={0} duration={0} />);
    expect(screen.getByRole('region', { name: "The chapter's waveform" })).toBeTruthy();
  });

  it('activating a flag marker calls onSelectFlag with its index into the flags array', async () => {
    const user = userEvent.setup();
    const tokens: WorkspaceToken[] = [{ i: 0, w: 0, text: 'x', status: 'misread', item: 0, start: 2, end: 2.5 }];
    const flags: Flag[] = [{ id: 'f1', kind: 'misread', label: 'Misread word', tokenStart: 0, tokenEnd: 0, seekTokenIndex: 0 }];
    const onSelectFlag = vi.fn();
    render(
      <WaveformStrip
        playlist={playlist}
        alignmentItems={[{ index: 0, itemGuid: 'g1', live: true }]}
        peaks={peaks}
        tokens={tokens}
        flags={flags}
        elapsed={0}
        duration={10}
        onSelectFlag={onSelectFlag}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Misread word/ }));
    expect(onSelectFlag).toHaveBeenCalledWith(0);
  });
});
