// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AudiobookEstimatePanel, rollupChapterStatuses } from './AudiobookEstimatePanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';

afterEach(cleanup);

describe('AudiobookEstimatePanel', () => {
  it('shows a total word count and a finished-audio estimate from the backend chapter list', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByText('Audiobook estimate')).toBeTruthy());
    expect(screen.getAllByText(/12 chapters/).length).toBeGreaterThan(0);
    expect(screen.getByText('Est. finished audio')).toBeTruthy();
  });

  it('reveals the per-chapter breakdown table on demand', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
      </ApiProvider>,
    );
    await waitFor(() => screen.getByText('Audiobook estimate'));
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByText((_, node) => node?.textContent === 'Chapter 1 — Down the Rabbit-Hole').length).toBeGreaterThan(0);
  });

  it('renders nothing when there are no manuscript chapters yet', async () => {
    const api = createMockApi({ manuscriptChapters: async () => [] });
    render(
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
      </ApiProvider>,
    );
    expect(await screen.findByText(/No manuscript chapters found yet/)).toBeTruthy();
  });

  it('merges chapters with the same status into one progress segment after edits', async () => {
    const api = createMockApi();
    render(
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={() => {}} goToManuscript={() => {}} />
      </ApiProvider>,
    );
    await screen.findByText('Audiobook estimate');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    const before = await api.manuscriptChapters();
    const previousFinalized = rollupChapterStatuses(before).finalized;
    const chapter = before.find((item) => item.status === 'recording')!;
    fireEvent.change(screen.getByLabelText(`${chapter.title} status`), { target: { value: 'finalized' } });
    await waitFor(() => expect((screen.getByLabelText(`${chapter.title} status`) as HTMLSelectElement).value).toBe('finalized'));
    const totals = rollupChapterStatuses(await api.manuscriptChapters());
    expect(totals.finalized.count).toBe(previousFinalized.count + 1);
    expect(totals.finalized.words).toBe(previousFinalized.words + chapter.wordCount);
    expect(document.querySelectorAll('.progress-segment')).toHaveLength(5);
  });
});
