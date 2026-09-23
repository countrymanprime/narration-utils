// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
});
