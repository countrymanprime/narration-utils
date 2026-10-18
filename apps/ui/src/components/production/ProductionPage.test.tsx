// @vitest-environment jsdom
// SN-P8's acceptance tests for the swapped Production page, end to end against the mock host: the Studio Next layout, the dialogs its
// icons open, the timer and the chip's feed, chapter sync, and the row menu that keeps the features the mock has no equivalent for.
import { APP_STARTED_AT } from './pipeline/dawConnectGrace';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { PRODUCTION_SCENARIOS } from '../../api/productionMock';
import { DAW_SETUPS } from '../../fixtures/daw';
import { overlay } from '../../overlay/overlayService';
import { OverlayHost } from '../../overlay/OverlayHost';
import { contextItemsFor } from '../../registries/context';
import type { NarrationApi } from '../../types';
import { TooltipProvider } from '../primitives/Tooltip';
import { ProductionPage } from './ProductionPage';

afterEach(() => {
  cleanup();
  // Layers the overlay singleton still holds belong to the test that opened them.
  act(() => overlay.getSnapshot().dialogs.forEach((entry) => ('close' in entry ? entry.close() : entry.answer(false))));
});

type Initial = Parameters<typeof createMockApi>[1];

async function renderPage({
  overrides = {},
  initial = {},
  onManuscriptChanged,
  dawConnectGraceMs = 0,
}: { overrides?: Partial<NarrationApi>; initial?: Initial; onManuscriptChanged?: () => void; dawConnectGraceMs?: number } = {}) {
  const api = createMockApi(overrides, initial);
  const data = await api.bootstrap();
  const onOverview = vi.fn();
  const go = vi.fn();
  const goToBooth = vi.fn();
  const notify = vi.fn();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <TooltipProvider>
          <ProductionPage
            data={data}
            go={go}
            notify={notify}
            goToScript={vi.fn()}
            goToEditing={vi.fn()}
            goToBooth={goToBooth}
            refreshBootstrap={async () => {}}
            onOverview={onOverview}
            onManuscriptChanged={onManuscriptChanged}
            dawConnectGraceMs={dawConnectGraceMs}
          />
        </TooltipProvider>
        <OverlayHost />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { api, onOverview, go, goToBooth, notify };
}

const pipeline = () => screen.findByRole('table', { name: 'Chapter pipeline' });

describe('production-route-draws-the-mock-page', () => {
  it('draws the header, the KPI row, the stage bar, This week, the recording check, the pipeline, Next up and the chart', async () => {
    await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Production' })).toBeTruthy();
    const kpis = await screen.findByRole('list', { name: 'Production figures' });
    expect(
      within(kpis)
        .getAllByRole('listitem')
        .map((item) => item.querySelector('span')?.textContent),
    ).toHaveLength(6);
    for (const title of ['Where the book stands', 'This week', 'Recording check', 'Chapter pipeline', 'Next up', 'Recorded vs plan']) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(await pipeline()).toBeTruthy();
  });

  it('is the import when there is no manuscript', async () => {
    await renderPage({ initial: { noManuscript: true } });
    expect(await screen.findByRole('button', { name: 'Import manuscript' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Production figures' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Chapter pipeline' })).toBeNull();
  });

  // ML-5: Replace manuscript is in Settings, under Manuscript, and nowhere else.
  it('has no Replace manuscript once a manuscript exists', async () => {
    await renderPage();
    await pipeline();
    expect(screen.queryByRole('button', { name: /replace manuscript/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /import manuscript/i })).toBeNull();
    expect(screen.queryByText(/replace manuscript/i)).toBeNull();
  });

  it('imports no file the swap deleted', () => {
    const source = readFileSync(join(__dirname, 'ProductionPage.tsx'), 'utf8');
    for (const gone of ['ChapterBoard', 'PlanPanel', 'StatusReportPanel', 'StageSummary']) expect(source).not.toContain(gone);
  });
});

describe('header-icons-and-dialogs-open', () => {
  it('opens the status report dialog from Export status report', async () => {
    await renderPage();
    await pipeline();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export status report' }));
    expect(await screen.findByRole('dialog', { name: 'Export status report' })).toBeTruthy();
  });

  it('opens Check recordings from the Recording check card', async () => {
    await renderPage();
    await pipeline();
    const card = screen.getByRole('heading', { name: 'Recording check' }).closest('section') as HTMLElement;
    const button = within(card).getByRole('button', { name: 'Check recordings' });
    if (button.getAttribute('aria-disabled') === 'true') return; // every chapter checked: nothing to preselect
    await userEvent.setup().click(button);
    expect(await screen.findByRole('dialog', { name: /Check recordings/ })).toBeTruthy();
  });

  it('draws the target info icon on the Recording tile', async () => {
    await renderPage();
    const kpis = await screen.findByRole('list', { name: 'Production figures' });
    expect(within(kpis).getByRole('button', { name: /target/i })).toBeTruthy();
  });

  it('opens the Schedule from the verdict pill and the Due tile', async () => {
    const { go } = await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    await pipeline();
    const user = userEvent.setup();
    const kpis = screen.getByRole('list', { name: 'Production figures' });
    await user.click(
      within(kpis)
        .getAllByRole('button')
        .find((b) => b.textContent?.startsWith('Due')) as HTMLElement,
    );
    expect(go).toHaveBeenLastCalledWith('/schedule');
  });
});

describe('timer-and-chip-still-work', () => {
  it('feeds the shell chip from every overview read, and Stop timer stops the running one', async () => {
    const { onOverview } = await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    await waitFor(() => expect(onOverview).toHaveBeenCalledWith(expect.objectContaining({ running: expect.objectContaining({ chapterId: 'chapter-6' }) })));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Stop timer' }));
    expect(await screen.findByText(/Timer stopped/)).toBeTruthy();
    await waitFor(() => expect(onOverview.mock.lastCall?.[0].running).toBeNull());
    expect(screen.queryByRole('button', { name: 'Stop timer' })).toBeNull();
  });

  it('keeps the stage timer figures, drawn once time is logged', async () => {
    await renderPage({ initial: { production: PRODUCTION_SCENARIOS['on-pace'] } });
    const strip = await screen.findByRole('list', { name: 'Stage timer figures' });
    for (const label of ['Work time logged', 'Hours per finished hour', 'Effective rate']) expect(strip.textContent).toContain(label);
  });

  it('draws no timer figures before anything is logged', async () => {
    await renderPage();
    await pipeline();
    expect(screen.queryByRole('list', { name: 'Stage timer figures' })).toBeNull();
  });
});

describe('daw-banner-retry', () => {
  it('reads the DAW again on Retry and says so when it is still not running (the mock)', async () => {
    const dawCapabilities = vi.fn(async () => structuredClone(DAW_SETUPS['reaper-off']));
    const { notify } = await renderPage({ overrides: { dawCapabilities } });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Still not running. Start REAPER and try again.'));
    expect(dawCapabilities.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('drops the banner on Retry once the DAW is running, and says nothing', async () => {
    let running = false;
    const dawCapabilities = vi.fn(async () => structuredClone(DAW_SETUPS[running ? 'reaper' : 'reaper-off']));
    const { notify } = await renderPage({ overrides: { dawCapabilities } });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    running = true;
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Still not running/));
  });
});

describe('daw-banner-connect-grace', () => {
  it('shows Connecting while the app has just opened, then the not-running banner if it never connects', async () => {
    await renderPage({
      overrides: { dawCapabilities: vi.fn(async () => structuredClone(DAW_SETUPS['reaper-off'])) },
      dawConnectGraceMs: Date.now() - APP_STARTED_AT + 400,
    });
    expect(await screen.findByText('Connecting to REAPER…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('Connecting to REAPER…')).toBeNull();
  });

  it('never shows the banner when the host connects inside the grace', async () => {
    let push: (next: (typeof DAW_SETUPS)['reaper']) => void = () => {};
    await renderPage({
      overrides: {
        dawCapabilities: vi.fn(async () => structuredClone(DAW_SETUPS['reaper-off'])),
        subscribeDawCapabilities: (onUpdate: typeof push) => {
          push = onUpdate;
          return () => {};
        },
      },
      dawConnectGraceMs: 60_000, // counted from when the code loaded, so far longer than the test runs
    });
    await screen.findByText('Connecting to REAPER…');
    act(() => push(structuredClone(DAW_SETUPS['reaper'])));
    await waitFor(() => expect(screen.queryByText('Connecting to REAPER…')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('daw-banner-follows-the-host', () => {
  it('drops the banner when the host pushes a reachable DAW, with no Retry', async () => {
    let push: (next: (typeof DAW_SETUPS)['reaper']) => void = () => {};
    const subscribeDawCapabilities = vi.fn((onUpdate: typeof push) => {
      push = onUpdate;
      return () => {};
    });
    await renderPage({
      overrides: { dawCapabilities: vi.fn(async () => structuredClone(DAW_SETUPS['reaper-off'])), subscribeDawCapabilities },
    });
    await screen.findByRole('button', { name: 'Retry' });
    act(() => push(structuredClone(DAW_SETUPS['reaper'])));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  });
});

describe('chapter-sync-feeds-survive', () => {
  it('reads the chapters again on a later chaptersync:state', async () => {
    const { api } = await renderPage();
    await pipeline();
    const read = vi.spyOn(api, 'productionOverview');
    const state = await api.chapterSyncState();
    act(() => (api as unknown as { emitChapterSync?: (s: typeof state) => void }).emitChapterSync?.(state));
    if (!(api as unknown as { emitChapterSync?: unknown }).emitChapterSync) return;
    await waitFor(() => expect(read).toHaveBeenCalled());
  });
});

describe('the row menu keeps the features the mock has none for', () => {
  it('offers the mock items, the chapter track, the checks and the status override on a pipeline row', async () => {
    await renderPage();
    const table = await pipeline();
    // The rows after the header: the opening credits, then chapter 1.
    const row = within(table).getAllByRole('row')[2];
    await waitFor(() => expect(contextItemsFor(row)?.find((item) => item.key === 'recording')?.unavailable).toBeUndefined());
    const labels = (contextItemsFor(row) ?? []).map((item) => item.label);
    for (const label of ['Open prep in Script', 'Open in Booth', 'Open Proof', 'Open Master & QC', 'Chapter track…', 'Recording check…', 'Editing check…']) {
      expect(labels).toContain(label);
    }
    expect(labels.some((label) => label.startsWith('Set status: '))).toBe(true);
  });

  it('says the manuscript changed after a chapter status is set, so other pages read the chapter list again', async () => {
    const onManuscriptChanged = vi.fn();
    await renderPage({ onManuscriptChanged });
    const table = await pipeline();
    const row = within(table).getAllByRole('row')[2];
    await waitFor(() => expect(contextItemsFor(row)?.find((item) => item.label.startsWith('Set status: '))).toBeTruthy());
    const baseline = onManuscriptChanged.mock.calls.length;
    await act(async () =>
      contextItemsFor(row)
        ?.find((item) => item.label.startsWith('Set status: '))
        ?.onSelect(),
    );
    await waitFor(() => expect(onManuscriptChanged.mock.calls.length).toBeGreaterThan(baseline));
  });

  it('opens the recording check from the row menu', async () => {
    await renderPage();
    const table = await pipeline();
    // The rows after the header: the opening credits, then chapter 1.
    const row = within(table).getAllByRole('row')[2];
    await waitFor(() => expect(contextItemsFor(row)?.find((item) => item.key === 'recording')?.unavailable).toBeUndefined());
    act(() =>
      contextItemsFor(row)
        ?.find((item) => item.key === 'recording')
        ?.onSelect(),
    );
    expect(await screen.findByRole('dialog', { name: /^Recording check: / })).toBeTruthy();
  });

  // REAPER with Select a track switched on.
  const selecting = async () => {
    const setup = structuredClone(DAW_SETUPS.reaper);
    setup.capabilities.track_select = { level: 'experimental', available: true };
    return setup;
  };

  it("goes to a linked chapter's track in the DAW, as the mock's Go to this chapter in REAPER", async () => {
    const trackSelectInReaper = vi.fn(async (trackGuid: string) => ({ outcome: 'selected' as const, trackGuid }));
    const { notify } = await renderPage({ overrides: { trackSelectInReaper, dawCapabilities: selecting }, initial: { chapterSync: 'activity' } });
    const table = await pipeline();
    const row = within(table).getAllByRole('row')[2];
    const goto = () => contextItemsFor(row)?.find((item) => item.key === 'goto');
    await waitFor(() => expect(goto()?.unavailable).toBeUndefined());
    expect(goto()?.label).toBe('Go to this chapter in REAPER');
    act(() => goto()?.onSelect());
    await waitFor(() => expect(trackSelectInReaper).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Selected in REAPER.'));
  });

  it('says why Go to this chapter is off: the DAW cannot select a track, or the chapter has no linked track', async () => {
    await renderPage();
    const offTable = await pipeline();
    const offRow = within(offTable).getAllByRole('row')[2];
    await waitFor(() => expect(contextItemsFor(offRow)?.find((item) => item.key === 'goto')?.unavailable).toMatch(/Experimental/));
    cleanup();
    await renderPage({ overrides: { dawCapabilities: selecting } });
    const table = await pipeline();
    const row = within(table).getAllByRole('row')[2];
    await waitFor(() => expect(contextItemsFor(row)?.find((item) => item.key === 'recording')?.unavailable).toBeUndefined());
    expect(contextItemsFor(row)?.find((item) => item.key === 'goto')?.unavailable).toMatch(/No chapter track is linked/);
  });

  it('matches nothing outside the pipeline', async () => {
    await renderPage();
    await pipeline();
    expect(contextItemsFor(screen.getByRole('heading', { level: 1, name: 'Production' }))).toBeNull();
  });
});

describe('the pipeline lists the credits as the mock does (issue 1705)', () => {
  const rowNames = (table: HTMLElement) =>
    within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

  it('puts the opening credits before chapter 1 and the closing credits after the last chapter', async () => {
    await renderPage();
    const names = rowNames(await pipeline());
    await waitFor(async () => expect(rowNames(await pipeline())[0]).toBe('Opening credits'));
    expect(rowNames(await pipeline()).at(-1)).toBe('Closing credits');
    expect(names.length).toBeGreaterThan(2);
  });

  it('draws the credits rows in the pipeline format: a cell for each stage, a dash where nothing measures it', async () => {
    await renderPage();
    const table = await pipeline();
    const opening = await within(table).findByRole('row', { name: /Opening credits/ });
    expect(within(opening).getAllByRole('cell')).toHaveLength(9);
    expect(within(opening).getByRole('button', { name: /^Opening credits: Prep / })).toBeTruthy();
    expect(within(opening).getByRole('button', { name: /^Opening credits: Record / })).toBeTruthy();
  });

  it('offers the credits row its own row menu: Script, Booth, the credits panel and the status override', async () => {
    await renderPage();
    const table = await pipeline();
    const opening = await within(table).findByRole('row', { name: /Opening credits/ });
    const labels = (contextItemsFor(opening) ?? []).map((item) => item.label);
    for (const label of ['Open prep in Script', 'Open in Booth', 'Credits…']) expect(labels).toContain(label);
    expect(labels.some((label) => label.startsWith('Set status: '))).toBe(true);
    expect(labels).not.toContain('Chapter track…');
  });

  it('opens a credits row in Script and the Booth at the credits, not at a chapter', async () => {
    const { goToBooth } = await renderPage();
    const table = await pipeline();
    const opening = await within(table).findByRole('row', { name: /Opening credits/ });
    await userEvent.click(within(opening).getByRole('button', { name: /^Opening credits: Record / }));
    expect(goToBooth).toHaveBeenCalledWith('credits-opening');
  });

  it('has no separate Credits list under the pipeline: the rows are where the credits are', async () => {
    await renderPage();
    await pipeline();
    expect(screen.queryByRole('region', { name: 'Credits' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Opening credits' })).toBeNull();
  });
});

describe('deleted-files-have-no-importers', () => {
  const SRC = join(__dirname, '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
    );
  it.each(['ChapterBoard', 'PlanPanel', 'StatusReportPanel', 'StageSummary'])('no source imports %s', (name) => {
    const importers = sources(SRC).filter((file) => new RegExp(`from '[^']*/${name}'`).test(readFileSync(file, 'utf8')));
    expect(importers).toEqual([]);
  });
});
