// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TakeReviewPanel } from './TakeReviewPanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

function renderPanel(chapterTrackName: string, overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <TakeReviewPanel chapterTrackName={chapterTrackName} />
    </ApiProvider>,
  );
  return api;
}

describe('TakeReviewPanel', () => {
  it('names the track it will scan and starts idle, with no results table yet', () => {
    renderPanel('Chapter 1');

    expect(screen.getByText(/Scan .Chapter 1. for alternate reads/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('runs a scan and lists the pickup and duplicate_read findings with no composite score column', async () => {
    const user = userEvent.setup();
    renderPanel('Chapter 1');

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));

    const table = await screen.findByRole('table', { name: 'Pickup and duplicate findings' });
    expect(table.textContent).toContain('Pickup');
    expect(table.textContent).toContain('Duplicate read');
    expect(table.textContent).toContain('Chapter 1');
    // Q9: per-category evidence only, never a composite/ranking score.
    expect(table.textContent).not.toMatch(/score|rank|best take/i);
    expect(screen.queryByText(/no repeated reads/i)).toBeNull();
  });

  it('reports no repeated reads when the scan finds nothing', async () => {
    const user = userEvent.setup();
    renderPanel('Chapter 2'); // the mock only seeds findings for "Chapter 1"

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));

    expect(await screen.findByText('No repeated reads found on this track.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a readable error when the scan fails', async () => {
    const user = userEvent.setup();
    renderPanel('Chapter 1', { takeReviewScan: async () => Promise.reject(new Error('choose a track to scan for pickups and duplicates')) });

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('choose a track to scan');
  });

  it('disables the scan action when there is no track to scan', () => {
    renderPanel('');

    expect((screen.getByRole('button', { name: 'Scan for pickups & duplicates' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds a candidate as a new take after the narrator picks a target and a candidate and confirms', async () => {
    const user = userEvent.setup();
    let received: unknown;
    const api = renderPanel('Chapter 1', {
      takeReviewCreateTake: async (request) => {
        received = request;
        return { targetItemGuid: request.targetItemGuid, newTakeGuid: '{99999999-0000-4000-8000-000000000099}' };
      },
    });
    void api;

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));
    await screen.findByRole('table', { name: 'Pickup and duplicate findings' });

    const [addAsTake] = screen.getAllByRole('button', { name: 'Add as take' });
    await user.click(addAsTake);

    const dialog = await screen.findByRole('alertdialog', { name: 'Add candidate as a new take' });
    await user.selectOptions(screen.getByLabelText('Target item'), '{11111111-0000-0000-0000-000000000001}');
    await user.selectOptions(screen.getByLabelText('Candidate read'), '{11111111-0000-0000-0000-000000000002}');
    await user.click(screen.getByRole('button', { name: 'Create take' }));

    await screen.findByText('Take added');
    expect(document.body.contains(dialog)).toBe(false);
    expect(received).toMatchObject({
      findingId: 'f24ca7396d9cf9e023f63fd8',
      targetItemGuid: '{11111111-0000-0000-0000-000000000001}',
      candidateItemGuid: '{11111111-0000-0000-0000-000000000002}',
      sourceFile: 'C:/Projects/Alice-in-Wonderland/media/ch1_take2.wav',
      sourceRangeStart: 10,
      sourceRangeEnd: 13.1,
    });
  });

  it('refuses to create a take until both a target and a candidate are chosen', async () => {
    const user = userEvent.setup();
    const createTake = vi.fn();
    renderPanel('Chapter 1', { takeReviewCreateTake: createTake });

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));
    await screen.findByRole('table', { name: 'Pickup and duplicate findings' });
    await user.click(screen.getAllByRole('button', { name: 'Add as take' })[0]);
    await screen.findByRole('alertdialog', { name: 'Add candidate as a new take' });

    await user.click(screen.getByRole('button', { name: 'Create take' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Choose a target item and a different candidate read.');
    expect(createTake).not.toHaveBeenCalled();
  });

  it('shows a readable error when take creation fails', async () => {
    const user = userEvent.setup();
    renderPanel('Chapter 1', {
      takeReviewCreateTake: async () => Promise.reject(new Error('the project has changed in REAPER since this finding was found')),
    });

    await user.click(screen.getByRole('button', { name: 'Scan for pickups & duplicates' }));
    await screen.findByRole('table', { name: 'Pickup and duplicate findings' });
    await user.click(screen.getAllByRole('button', { name: 'Add as take' })[0]);
    await screen.findByRole('alertdialog', { name: 'Add candidate as a new take' });
    await user.selectOptions(screen.getByLabelText('Target item'), '{11111111-0000-0000-0000-000000000001}');
    await user.selectOptions(screen.getByLabelText('Candidate read'), '{11111111-0000-0000-0000-000000000002}');

    await user.click(screen.getByRole('button', { name: 'Create take' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('the project has changed in REAPER since this finding was found');
  });
});
