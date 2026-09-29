// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { PRODUCTION_SCENARIOS } from '../../api/productionMock';
import { productionOverviewSchema } from '../../api/schemas/production';
import type { NarrationApi } from '../../types';
import { ProductionPage } from './ProductionPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The host's own payload (written by internal/production/overview_test.go), so the page is tested against what the host sends.
const contract = (name: string) =>
  productionOverviewSchema.parse(JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', name), 'utf8')));

async function renderPage({ overrides = {}, initial = {} }: { overrides?: Partial<NarrationApi>; initial?: Initial } = {}) {
  const api = createMockApi(overrides, initial);
  const data = await api.bootstrap();
  const onOverview = vi.fn();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <ProductionPage
          data={data}
          go={vi.fn()}
          notify={vi.fn()}
          goToScript={vi.fn()}
          goToProofChapter={vi.fn()}
          refreshBootstrap={async () => {}}
          onOverview={onOverview}
        />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { api, onOverview };
}

const actions = () => screen.getByRole('group', { name: 'Production actions' });

/** The board row a chapter heads, by its title. */
const boardRow = (title: string) =>
  within(screen.getByRole('grid', { name: 'Chapter pipeline' }))
    .getByRole('rowheader', { name: new RegExp(`^${title} —`) })
    .closest('tr') as HTMLElement;

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
    await renderPage();
    expect((await tile('Hours per finished hour')).textContent).toContain('—');
    expect((await tile('Hours per finished hour')).textContent).toContain('Not enough measured time and logged hours yet');
    expect((await tile('Effective rate')).textContent).toContain('No contracted amount set yet');
    // Nothing measures a delivery check or counts pickups yet: the tiles say so instead of showing a made-up number.
    expect((await tile('Delivery check')).textContent).toContain('—');
    expect((await tile('Delivery check')).textContent).toContain('No delivery check run yet');
    expect((await tile('Open pickups')).textContent).toContain('—');
    expect((await tile('Work time logged')).textContent).toContain('0:00');
    expect(within(actions()).queryByRole('button', { name: 'Stop timer' })).toBeNull();
  });

  it('shows the pickups REAPER last reported as the Open pickups figure, and asks nothing of REAPER to do it', async () => {
    const pickupsCount = vi.fn<NarrationApi['pickupsCount']>();
    await renderPage({
      overrides: {
        pickupsCount,
        pickupsState: async () => ({ phase: 'success', message: '', remaining: 9, total: 14, csv: '' }),
      },
    });
    const open = await tile('Open pickups');
    await waitFor(() => expect(open.textContent).toContain('9'));
    expect(open.textContent).toContain('of 14 total');
    expect(pickupsCount).not.toHaveBeenCalled();
  });

  it('draws the pace pill and the hours-logged chart: unknown with nothing logged, a projection once chapters are finalized', async () => {
    await renderPage();
    await tile('Delivery check');
    expect(screen.getByText(/^Pace unknown · no hours logged yet$/)).toBeTruthy();
    expect(screen.getByText('No hours logged yet: start a timer on a chapter.')).toBeTruthy();
    cleanup();
    await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    await tile('Delivery check');
    expect(await screen.findByText(/at current pace done/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Hours logged: / })).toBeTruthy();
  });

  it('says the pace is unknown, not that the chart is empty, when the hours cannot be read', async () => {
    await renderPage({ overrides: { productionBurndown: async () => Promise.reject(new Error('no log')) } });
    await tile('Delivery check');
    expect(await screen.findByText(/^Pace unknown · the hours could not be read$/)).toBeTruthy();
    expect(screen.getByText('The hours logged could not be read.')).toBeTruthy();
  });

  it('says in the subtitle how many chapters and words the book has, and that no delivery date is set, with the figures explained', async () => {
    await renderPage();
    await tile('Delivery check');
    expect(screen.getByText(/^12 chapters · [\d,]+ words · no delivery date set$/)).toBeTruthy();
    expect(screen.getByLabelText('About these figures')).toBeTruthy();
  });

  it('shows an on-pace book: its figures, its delivery date, the running timer and its board', async () => {
    const { onOverview } = await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    await tile('Delivery check');
    expect((await tile('Effective rate')).textContent).not.toContain('—');
    expect(screen.getByText(/ · delivery due Oct 14 \(18 days\)$/)).toBeTruthy();
    // The running timer shows in the app header's chip (fed by onOverview); the page offers only its Stop.
    expect(within(actions()).getByRole('button', { name: 'Stop timer' })).toBeTruthy();
    expect(onOverview).toHaveBeenCalledWith(expect.objectContaining({ running: expect.objectContaining({ chapterId: 'chapter-6' }) }));
    expect(
      within(boardRow('Chapter 1'))
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent),
    ).toEqual(['11:48', '—', '✓', '✓', '✓', '—', '—', '—']);
  });

  // Mock 01 (ADR 0645): the six figures are one card (StatStrip), and the board and Next up sit side by side in the page's grid.
  it('draws the figures as one card of six tiles', async () => {
    await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    await tile('Delivery check');
    const figures = screen.getByRole('list', { name: 'Production figures' });
    expect(within(figures).getAllByRole('listitem')).toHaveLength(6);
    expect(figures.parentElement?.className).toContain('rounded-[var(--radius-card)]');
  });

  it('marks an at-risk deadline and lists the chapters that threaten it first', async () => {
    await renderPage({ initial: { production: PRODUCTION_SCENARIOS['at-risk'] } });
    await tile('Delivery check');
    expect(screen.getByText(/ · delivery due \w+ \d+ \(3 days\)$/)).toBeTruthy();
    const nextUp = screen.getByRole('list', { name: 'Next up' });
    const items = within(nextUp).getAllByRole('listitem');
    // Chapters 4-6 are recording with part of their text not read (the stage mock's not_ready), so they come first.
    expect(items[0].textContent).toContain('Chapter 4');
    expect(items[0].textContent).toContain('Finish recording');
  });

  it("renders the host's own payload", async () => {
    const { onOverview } = await renderPage({ overrides: { productionOverview: async () => contract('production-overview.json') } });
    await tile('Delivery check');
    expect(screen.getByText(/delivery due Oct 14 \(18 days\)$/)).toBeTruthy();
    expect((await tile('Effective rate')).textContent).toContain('1,067');
    expect(within(actions()).getByRole('button', { name: 'Stop timer' })).toBeTruthy();
    expect(onOverview.mock.calls[0][0].running).not.toBeNull();
  });

  it('starts a timer on a listed chapter and stops it, without ever setting a chapter status', async () => {
    const setStatus = vi.fn<NarrationApi['manuscriptSetChapterStatus']>();
    const confirm = vi.fn<NarrationApi['stageConfirm']>();
    const { api, onOverview } = await renderPage({ overrides: { manuscriptSetChapterStatus: setStatus, stageConfirm: confirm } });
    const user = userEvent.setup();
    const nextUp = await screen.findByRole('list', { name: 'Next up' });
    await user.click(within(nextUp).getAllByRole('button', { name: /^Start timer/ })[0]);
    const stop = await within(actions()).findByRole('button', { name: 'Stop timer' });
    expect((await api.productionOverview()).running?.chapterId).toBe('chapter-4');
    expect(onOverview.mock.lastCall?.[0].running?.chapterId).toBe('chapter-4');
    // While a timer runs no other can be started from the page.
    expect(within(screen.getByRole('list', { name: 'Next up' })).queryAllByRole('button', { name: /^Start timer/ })).toEqual([]);
    await user.click(stop);
    expect((await screen.findByText(/Timer stopped/)).textContent).toContain('Chapter 4');
    expect(within(actions()).queryByRole('button', { name: 'Stop timer' })).toBeNull();
    expect(onOverview.mock.lastCall?.[0].running).toBeNull();
    expect(setStatus).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the host's refusal when another timer is already running", async () => {
    await renderPage({
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
    await renderPage({ overrides: { productionOverview: async () => Promise.reject(new Error('the time log could not be read')) } });
    expect((await screen.findByRole('alert')).textContent).toContain('the time log could not be read');
  });

  it('reads the overview again on Refresh', async () => {
    const { api } = await renderPage();
    await tile('Delivery check');
    const read = vi.spyOn(api, 'productionOverview');
    const user = userEvent.setup();
    await user.click(within(actions()).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(read).toHaveBeenCalled());
  });

  it('opens the status report export in its own slide-over', async () => {
    await renderPage();
    await tile('Delivery check');
    expect(screen.queryByRole('dialog', { name: 'Status report' })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(actions()).getByRole('button', { name: 'Export status report' }));
    const report = await screen.findByRole('dialog', { name: 'Status report' });
    expect(within(report).getByRole('button', { name: 'Export status report' })).toBeTruthy();
  });

  it('offers to replace the manuscript from the header', async () => {
    await renderPage();
    await tile('Delivery check');
    expect(within(actions()).getByRole('button', { name: 'Replace manuscript' })).toBeTruthy();
  });

  it('is the import, and reads no overview, when there is no manuscript', async () => {
    const productionOverview = vi.fn<NarrationApi['productionOverview']>();
    await renderPage({ overrides: { productionOverview }, initial: { noManuscript: true } });
    expect(await screen.findByText('No imported manuscript')).toBeTruthy();
    expect(screen.getByText('Import the manuscript to plan, record and deliver this book.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import manuscript' })).toBeTruthy();
    expect(within(actions()).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Production figures' })).toBeNull();
    expect(productionOverview).not.toHaveBeenCalled();
  });
});
