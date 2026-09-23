// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_FINDINGS } from '../../api/mockFixtures';
import { TooltipProvider } from '../primitives/Tooltip';
import type { Finding, NarrationApi } from '../../types';
import { ReviewPage } from './ReviewPage';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

function renderPage({
  overrides = {},
  initial = {},
  hasManuscript = true,
}: { overrides?: Partial<NarrationApi>; initial?: Initial; hasManuscript?: boolean } = {}) {
  const api = createMockApi(overrides, initial);
  const goToManuscript = vi.fn();
  const goToStoryBible = vi.fn();
  const notify = vi.fn();
  render(
    <ApiProvider api={api}>
      <TooltipProvider>
        <ReviewPage notify={notify} hasManuscript={hasManuscript} goToManuscript={goToManuscript} goToStoryBible={goToStoryBible} />
      </TooltipProvider>
    </ApiProvider>,
  );
  return { api, goToManuscript, goToStoryBible, notify };
}

const rows = async () => {
  const table = await screen.findByRole('table', { name: 'Findings' });
  await waitFor(() => expect(within(table).queryAllByRole('row').length).toBeGreaterThan(1));
  return within(table).getAllByRole('row').slice(1);
};

const openFinding = async (user: ReturnType<typeof userEvent.setup>, text: RegExp) => {
  const row = (await rows()).find((candidate) => text.test(candidate.textContent ?? ''));
  if (!row) throw new Error(`no row matches ${text}`);
  await user.click(row);
};

describe('ReviewPage', () => {
  it('lists the latest run with the counts by status, and asks the narrator to pick a finding', async () => {
    renderPage();
    expect(await rows()).toHaveLength(4);
    expect(await screen.findByText('3 to review · 0 accepted · 1 dismissed · 0 deferred')).toBeTruthy();
    expect(screen.getByText(/Select a finding to see its evidence/)).toBeTruthy();
    const first = (await rows())[0];
    expect(first.textContent).toContain('“a White Rabbit with pink eyes” read as “a white rabbit with pale eyes”');
    expect(first.textContent).toContain('90%');
  });

  it('says there is nothing to review yet, with no filters, when the project has no findings', async () => {
    renderPage({ initial: { findings: [] } });
    expect(await screen.findByRole('heading', { name: 'Nothing to review yet' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Filter findings' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('sends each filter to the host and shows what it answers', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const list = vi.spyOn(api, 'findingsList');
    await rows();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Check' }), 'story-bible');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ analyzer: 'story-bible', sort: 'chapter' })));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    await user.click(screen.getByRole('switch', { name: 'Include findings the latest run did not repeat' }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect((await rows())[1].textContent).toContain('not in the latest run');
  });

  it('hides low-confidence and unscored findings with the confidence switch', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await user.click(screen.getByRole('switch', { name: 'Only findings scored 50% or more' }));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
  });

  it('offers to clear filters that match nothing, and clearing brings the list back', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'deferred');
    expect(await screen.findByText('No findings match these filters.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Findings' });
    await user.click(within(table).getByRole('button', { name: 'Clear filters' }));
    await waitFor(async () => expect(await rows()).toHaveLength(4));
    expect((screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement).value).toBe('');
  });

  it('shows a finding with its evidence and confidence reason, and no REAPER controls yet', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    const detail = screen.getByRole('region', { name: 'Transcript difference' });
    expect(within(detail).getByText('a White Rabbit with pink eyes')).toBeTruthy();
    expect(within(detail).getByText('Misread')).toBeTruthy();
    expect(within(detail).getByText('0.42 s')).toBeTruthy();
    expect(within(detail).getByText('0:12.4')).toBeTruthy();
    expect(within(detail).getByText(/measured a clear pause/)).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: /go to|loop/i })).toBeNull();
  });

  it('records a decision with its note, says so, and updates the list and the counts', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    const review = vi.spyOn(api, 'findingsReview');
    await openFinding(user, /pink eyes/);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Re-record the line');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Saved as accepted.')).toBeTruthy();
    expect(review).toHaveBeenCalledWith({
      id: WIRE_FINDINGS[0].id,
      evidenceVersion: WIRE_FINDINGS[0].evidence_version,
      status: 'accepted',
      note: 'Re-record the line',
    });
    expect(await screen.findByText('2 to review · 1 accepted · 1 dismissed · 0 deferred')).toBeTruthy();
    expect((await rows())[0].textContent).toContain('Accepted');
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('explains a decision refused on changed evidence in plain words, shows the latest version and keeps the note', async () => {
    const user = userEvent.setup();
    const { api } = renderPage({ initial: { findingsRerun: true } });
    const review = vi.spyOn(api, 'findingsReview');
    await openFinding(user, /pink eyes/);
    await user.type(screen.getByRole('textbox', { name: 'Note (optional)' }), 'Pale is fine');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Not saved: this finding changed since you opened it, because its check ran again\./);
    expect((screen.getByRole('textbox', { name: 'Note (optional)' }) as HTMLTextAreaElement).value).toBe('Pale is fine');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('Saved as dismissed.')).toBeTruthy();
    expect(review).toHaveBeenLastCalledWith(expect.objectContaining({ evidenceVersion: `${WIRE_FINDINGS[0].evidence_version}-rerun`, note: 'Pale is fine' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the host’s own reason when a decision is refused for anything else', async () => {
    const user = userEvent.setup();
    renderPage({ overrides: { findingsReview: () => Promise.reject(new Error('the findings file could not be written')) } });
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Defer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Not saved: the findings file could not be written');
  });

  it('will not send a note over the host’s limit', async () => {
    const user = userEvent.setup();
    renderPage();
    await openFinding(user, /pink eyes/);
    const note = screen.getByRole('textbox', { name: 'Note (optional)' });
    await user.click(note);
    await user.paste('x'.repeat(2001));
    expect(screen.getByText('A note can be at most 2000 characters.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a finding is not in the latest run', async () => {
    const user = userEvent.setup();
    renderPage();
    await rows();
    await user.click(screen.getByRole('switch', { name: 'Include findings the latest run did not repeat' }));
    await waitFor(async () => expect(await rows()).toHaveLength(5));
    await openFinding(user, /Antipathies/);
    expect(screen.getByText(/The latest run did not find this again/)).toBeTruthy();
    expect(screen.getByText('low')).toBeTruthy();
    expect(screen.getByText('In the script')).toBeTruthy();
  });

  it('opens the manuscript at the finding’s line, and the Story Bible at its entry', async () => {
    const user = userEvent.setup();
    const { goToManuscript, goToStoryBible } = renderPage();
    await openFinding(user, /pink eyes/);
    await user.click(screen.getByRole('button', { name: 'Show in manuscript' }));
    await waitFor(() => expect(goToManuscript).toHaveBeenCalledWith('chapter-1', 1));
    await openFinding(user, /^.White Rabbit./);
    await user.click(screen.getByRole('button', { name: 'Open in Story Bible' }));
    expect(goToStoryBible).toHaveBeenCalledWith('white-rabbit');
  });

  it('keeps Show in manuscript off, with the reason, when there is no manuscript', async () => {
    const user = userEvent.setup();
    renderPage({ hasManuscript: false });
    await openFinding(user, /pink eyes/);
    expect((screen.getByRole('button', { name: 'Show in manuscript' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('group', { name: 'Import a manuscript to open this finding in it.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in Story Bible' })).toBeNull();
  });

  it('pages a long queue with Show more', async () => {
    const user = userEvent.setup();
    const many: Finding[] = Array.from({ length: 130 }, (_, index) => ({
      ...WIRE_FINDINGS[0],
      id: `f${String(index).padStart(3, '0')}`,
    }));
    renderPage({ initial: { findings: many } });
    expect(await rows()).toHaveLength(100);
    expect(screen.getByText('Showing 100 of 130')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(async () => expect(await rows()).toHaveLength(130));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('shows a load error with Retry when the first load fails', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderPage({
      overrides: {
        findingsSummary: () =>
          fail
            ? Promise.reject(new Error('no project is open'))
            : Promise.resolve({
                total: 0,
                unreviewed: 0,
                accepted: 0,
                dismissed: 0,
                deferred: 0,
                notInLatestRun: 0,
                analyzers: [],
                categories: [],
                chapters: [],
              }),
      },
    });
    expect(await screen.findByText('This page could not be loaded')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Nothing to review yet' })).toBeTruthy();
  });
});
