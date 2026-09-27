// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { productionOverviewSchema } from '../../api/schemas/production';
import type { NarrationApi } from '../../types';
import { ProductionPage } from './ProductionPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The host's own payload (written by internal/production/overview_test.go), so the page is tested against what the host sends.
const contract = (name: string) =>
  productionOverviewSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

function renderPage({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ApiProvider api={api}>
      <ProductionPage />
    </ApiProvider>,
  );
  return api;
}

const tile = async (label: string) => {
  const kpis = await screen.findByRole('list', { name: 'Production figures' });
  const item = within(kpis)
    .getAllByRole('listitem')
    .find((candidate) => candidate.textContent?.startsWith(label));
  if (!item) throw new Error(`no ${label} tile`);
  return item;
};

describe('ProductionPage', () => {
  it('shows every undefined figure as a dash, and says why, before anything is logged or set (no data yet)', async () => {
    renderPage();
    expect((await tile('Hours per finished hour')).textContent).toContain('—');
    expect((await tile('Hours per finished hour')).textContent).toContain('Not enough measured time and logged hours yet');
    expect((await tile('Effective rate')).textContent).toContain('No contracted amount set yet');
    expect((await tile('Delivery date')).textContent).toContain('No delivery date set yet');
    expect((await tile('Work time logged')).textContent).toContain('0:00');
    expect(screen.queryByRole('status', { name: /timer running/i })).toBeNull();
  });

  it('shows an on-pace book: its figures, the running timer and its board', async () => {
    renderPage({ initial: { production: 'on-pace' } });
    expect((await tile('Delivery date')).textContent).toContain('18 days');
    expect((await tile('Delivery date')).textContent).toContain('Due 14 Oct 2026');
    expect((await tile('Effective rate')).textContent).not.toContain('—');
    const timer = await screen.findByRole('status', { name: /timer running/i });
    expect(timer.textContent).toContain('Chapter 6 — Pig and Pepper');
    const board = screen.getByRole('grid', { name: 'Chapter pipeline' });
    const first = within(board).getAllByRole('row')[1];
    expect(within(first).getByRole('rowheader').textContent).toContain('Chapter 1 — Down the Rabbit-Hole');
    expect(
      within(first)
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent),
    ).toEqual(['11:48', 'Done', 'Done', 'Done', 'Not available', 'Not available']);
  });

  it('marks an at-risk deadline and lists the chapters that threaten it first', async () => {
    renderPage({ initial: { production: 'at-risk' } });
    expect((await tile('Delivery date')).textContent).toContain('3 days');
    const nextUp = screen.getByRole('list', { name: 'Next up' });
    const items = within(nextUp).getAllByRole('listitem');
    // Chapters 4-6 are recording with part of their text not read (the stage mock's not_ready), so they come first.
    expect(items[0].textContent).toContain('Chapter 4');
    expect(items[0].textContent).toContain('Finish recording');
  });

  it("renders the host's own payload", async () => {
    renderPage({ overrides: { productionOverview: async () => contract('production-overview.json') } });
    expect((await tile('Delivery date')).textContent).toContain('18 days');
    expect((await tile('Effective rate')).textContent).toContain('1,067');
    expect(screen.getByRole('status', { name: /timer running/i }).textContent).toContain('The Pool of Tears');
  });

  it('starts a timer on a listed chapter and stops it, without ever setting a chapter status', async () => {
    const setStatus = vi.fn<NarrationApi['manuscriptSetChapterStatus']>();
    const confirm = vi.fn<NarrationApi['stageConfirm']>();
    const api = renderPage({ overrides: { manuscriptSetChapterStatus: setStatus, stageConfirm: confirm } });
    const user = userEvent.setup();
    const nextUp = await screen.findByRole('list', { name: 'Next up' });
    await user.click(within(nextUp).getAllByRole('button', { name: /^Start timer/ })[0]);
    const timer = await screen.findByRole('status', { name: /timer running/i });
    expect(timer.textContent).toContain('Chapter 4');
    expect((await api.productionOverview()).running?.chapterId).toBe('chapter-4');
    // While a timer runs no other can be started from the page.
    expect(within(screen.getByRole('list', { name: 'Next up' })).queryAllByRole('button', { name: /^Start timer/ })).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Stop timer' }));
    expect((await screen.findByText(/Timer stopped/)).textContent).toContain('Chapter 4');
    expect(screen.queryByRole('status', { name: /timer running/i })).toBeNull();
    expect(setStatus).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the host's refusal when another timer is already running", async () => {
    renderPage({
      overrides: {
        productionStartTimer: async () => ({
          status: 'refused',
          reason: 'timer_running',
          message: 'a timer is already running on chapter-9 (proofing); stop it first',
        }),
      },
    });
    const user = userEvent.setup();
    const nextUp = await screen.findByRole('list', { name: 'Next up' });
    await user.click(within(nextUp).getAllByRole('button', { name: /^Start timer/ })[0]);
    expect((await screen.findByRole('alert')).textContent).toContain('a timer is already running on chapter-9');
  });

  it('says so when the overview cannot be read', async () => {
    renderPage({ overrides: { productionOverview: async () => Promise.reject(new Error('the time log could not be read')) } });
    expect((await screen.findByRole('alert')).textContent).toContain('the time log could not be read');
  });
});
