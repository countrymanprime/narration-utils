// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AudiobookEstimatePanel } from './AudiobookEstimatePanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

type Initial = Parameters<typeof createMockApi>[1];

// The recording check on Home (docs/utilities/recording-coverage.md, ADR 0130), driven through the panel against the coverage mock, which
// answers the same states the host does: chapters 1-3 have a current check with every word, 4-6 a current check with a third missing,
// the rest were never checked.
async function openBreakdown(initial: Initial = {}, overrides: Partial<NarrationApi> = {}) {
  const api = createMockApi(overrides, initial);
  const goToManuscript = vi.fn();
  const notify = vi.fn();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={notify} goToManuscript={goToManuscript} />
      </ApiProvider>
    </MemoryRouter>,
  );
  await waitFor(() => screen.getByText('Audiobook estimate'));
  fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
  return { api, goToManuscript, notify };
}

const row = (title: string) => screen.getByRole('link', { name: new RegExp(`^${title}\\b`) }).closest('tr') as HTMLElement;
const openCheck = async (title: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Check recording of ${title}` }));
  return screen.findByRole('dialog', { name: `Recording check: ${title}` });
};

describe('recording check on Home', () => {
  it('never shows a status- or check-derived recorded length', async () => {
    await openBreakdown();
    // No estimate, checked or not: actual-recorded-column.prd.md Phase 1 drops the status guess and the check's word share alike.
    expect(within(row('Chapter 1')).queryByText('measured')).toBeNull();
    expect(within(row('Chapter 4')).queryByText('measured')).toBeNull();
    expect(within(row('Chapter 7')).queryByText('estimated from status')).toBeNull();
    // Scoped to the Actual recorded cell (4th column): a row's Chapter cell can also contain a bare "—" as
    // TitleSubtitle's title/subtitle separator (chapter-title-display-consistency.prd.md), which a row-wide
    // getByText('—') would otherwise match too.
    for (const title of ['Chapter 1', 'Chapter 4', 'Chapter 7']) expect(within(row(title)).getByText('—', { selector: 'td:nth-child(4) *' })).toBeTruthy();
  });

  it('says a stale check no longer measures the chapter', async () => {
    await openBreakdown({ coverage: { stale: [WIRE_CHAPTERS[3].id] } });
    const dialog = await openCheck('Chapter 4');
    expect(await within(dialog).findByText('This result is out of date')).toBeTruthy();
    expect(within(dialog).getByText('An item on the chapter’s track was trimmed since this check.')).toBeTruthy();
    // The last counts stay readable, labelled as from then.
    expect(within(dialog).getByText(/The counts below are from then/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('shows a chapter that was never checked and runs nothing until asked', async () => {
    const coverageStart = vi.fn();
    await openBreakdown({}, { coverageStart });
    const dialog = await openCheck('Chapter 7');
    expect(await within(dialog).findByText(/Not checked yet/)).toBeTruthy();
    expect(within(dialog).getByText(/Based on the saved REAPER project, file modified/)).toBeTruthy();
    expect(coverageStart).not.toHaveBeenCalled();
  });

  it('states an unfinished chapter as "recorded to", not as a pickup (recording-check-summary.prd.md RS2)', async () => {
    await openBreakdown();
    const dialog = await openCheck('Chapter 4');
    expect(await within(dialog).findByText(/words not recorded$/)).toBeTruthy();
    expect(within(dialog).getByText(/^Recorded to paragraph \d+ of \d+ \(.*words? left\)\.$/)).toBeTruthy();
    expect(within(dialog).getByText('Pickups (0)')).toBeTruthy();
    expect(within(dialog).queryByText('End not read')).toBeNull();
    // The paragraph table stays folded even with text missing (RS6 A): every pickup already names its own paragraphs.
    expect(within(dialog).queryByRole('table', { name: 'Paragraphs' })).toBeNull();
  });

  it("lists the check's own interior gaps as pickups, one per line, and links to the paragraph (?mockCoverage=pickups)", async () => {
    const { goToManuscript } = await openBreakdown({ coverage: { pickups: [WIRE_CHAPTERS[3].id] } });
    const dialog = await openCheck('Chapter 4');
    expect(await within(dialog).findByText('Pickups (2)')).toBeTruthy();
    expect(within(dialog).getByText('Skipped')).toBeTruthy();
    expect(within(dialog).getByText('Read short')).toBeTruthy();
    // The small remaining tail still reads as "recorded to", not as a third pickup.
    expect(within(dialog).getByText(/^Recorded to paragraph \d+ of \d+/)).toBeTruthy();
    const go = within(dialog).getAllByRole('button', { name: /^Go to paragraph \d+$/ })[0];
    fireEvent.click(go);
    const number = Number(go.textContent?.match(/\d+/)?.[0]);
    const chapter = WIRE_CHAPTERS[3];
    expect(goToManuscript).toHaveBeenCalledWith(chapter.id, chapter.paragraphIds![number - 1].index);
  });

  it('reads a complete chapter as all recorded, with no pickups and its paragraph detail folded', async () => {
    await openBreakdown();
    const dialog = await openCheck('Chapter 1');
    expect(await within(dialog).findByText('All the text is recorded')).toBeTruthy();
    expect(within(dialog).getByText('Pickups (0)')).toBeTruthy();
    expect(within(dialog).queryByRole('table', { name: 'Paragraphs' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Paragraph detail/ })).toBeTruthy();
  });

  it('runs a check with real progress and shows its result, leaving the recorded length column untouched', async () => {
    await openBreakdown();
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const progress = await screen.findByRole('dialog', { name: 'Checking Chapter 7' });
    expect(within(progress).getByRole('progressbar')).toBeTruthy();
    expect(within(progress).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    const result = await screen.findByRole('dialog', { name: 'Recording check: Chapter 7' }, { timeout: 3000 });
    expect(await within(result).findByText('All the text is recorded')).toBeTruthy();
    fireEvent.click(within(result).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(row('Chapter 7')).getByText('—', { selector: 'td:nth-child(4) *' })).toBeTruthy());
  });

  it('cancels a running check and keeps the dialog until it is closed', async () => {
    await openBreakdown({ coverage: { hold: true } });
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const progress = await screen.findByRole('dialog', { name: 'Checking Chapter 7' });
    fireEvent.click(within(progress).getByRole('button', { name: 'Cancel' }));
    expect((await within(progress).findByRole('status')).textContent).toMatch(/^Cancelled\./);
    fireEvent.click(within(progress).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('dialog', { name: 'Recording check: Chapter 7' })).toBeTruthy();
  });

  it('keeps the row’s percent when the check is sent to the background, and reopens its progress', async () => {
    await openBreakdown({ coverage: { hold: true } });
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const progress = await screen.findByRole('dialog', { name: 'Checking Chapter 7' });
    fireEvent.click(within(progress).getByRole('button', { name: 'Continue in background' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const button = await within(row('Chapter 7')).findByRole('button', { name: 'Checking 70%, recording of Chapter 7' }, { timeout: 2000 });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Checking Chapter 7' })).toBeTruthy();
  });

  it('says in plain words why a check was refused and offers the chapter-track link in place', async () => {
    await openBreakdown({ coverage: { refusal: 'unmapped' } });
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('The recording could not be checked')).toBeTruthy();
    expect(within(alert).getByText('Link this chapter to the REAPER track it is recorded on first.')).toBeTruthy();
    expect(await within(alert).findByRole('combobox', { name: 'Track for Chapter 7' })).toBeTruthy();
  });

  it('points a refusal it cannot answer in place to the page that can', async () => {
    await openBreakdown({ coverage: { refusal: 'sidecar_missing' } });
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('Set up the Transcript Compare tool in Settings first.')).toBeTruthy();
    expect(within(alert).getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('asks before downloading the Whisper model, never downloading it silently', async () => {
    const { api } = await openBreakdown({ assets: 'missing' });
    const whisperInstall = vi.spyOn(api, 'whisperInstall');
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' });
    expect(within(ask).getByRole('button', { name: 'Download model' })).toBeTruthy();
    expect(whisperInstall).not.toHaveBeenCalled();
  });
});
