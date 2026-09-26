// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { CoverageReport, ManuscriptChapter } from '../../types';
import { RecordingCheckReport } from './RecordingCheckReport';

afterEach(cleanup);

// The four figures the report draws through StatTile (recording-check-summary.prd.md Phase 1; studio-ui-primitives.prd.md
// Phase 4 moved them onto the shared primitive with no visible change): text present, paragraphs, audio checked and pace.
const chapter: ManuscriptChapter = {
  id: 'c-1',
  title: 'Chapter 1',
  index: 0,
  wordCount: 100,
  status: 'recording',
  paragraphIds: [
    { id: 'p-a', index: 40 },
    { id: 'p-b', index: 41 },
  ],
};

const report: CoverageReport = {
  model: 'small',
  alignment: { maxMisreadRun: 8, minAnchorRun: 3 },
  bodyTokens: 100,
  presentTokens: 84,
  missingTokens: 16,
  extraTokens: 0,
  longestMissingRun: 16,
  playedSeconds: 60,
  items: [{ index: 0, itemGuid: '{ITEM}', status: 'analyzed', words: 'transcribed', playedSeconds: 60, wordCount: 84 }],
  paragraphs: [
    { id: 'p-a', tokens: 50, present: 50, longestMissingRun: 0 },
    { id: 'p-b', tokens: 50, present: 34, longestMissingRun: 16 },
  ],
  regions: [],
};

function renderReport() {
  const api = createMockApi();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <RecordingCheckReport chapter={chapter} report={report} goToParagraph={() => undefined} />
      </ApiProvider>
    </MemoryRouter>,
  );
}

describe('RecordingCheckReport', () => {
  it('shows text present, with the word counts as its hint', () => {
    renderReport();
    expect(screen.getByText('Text present')).toBeTruthy();
    expect(screen.getByText('84%')).toBeTruthy();
    expect(screen.getByText('84 of 100 words')).toBeTruthy();
  });

  it('shows how many paragraphs were fully read', () => {
    renderReport();
    expect(screen.getByText('Paragraphs')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('fully read')).toBeTruthy();
  });

  it('shows the audio checked, with the item count as its hint', () => {
    renderReport();
    expect(screen.getByText('Audio checked')).toBeTruthy();
    expect(screen.getByText('1:00')).toBeTruthy();
    expect(screen.getByText('in 1 item')).toBeTruthy();
  });

  it('shows the pace only when the audio played long enough to compute one', () => {
    renderReport();
    expect(screen.getByText('Pace')).toBeTruthy();
    expect(screen.getByText('about 84/min')).toBeTruthy();
  });

  it('omits the pace tile when nothing was played', () => {
    render(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <RecordingCheckReport chapter={chapter} report={{ ...report, playedSeconds: 0 }} goToParagraph={() => undefined} />
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Pace')).toBeNull();
  });
});
