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

// The recording check on Home (recording-coverage-analysis.prd.md Phase 6), driven through the panel against the coverage mock, which
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
  it('labels a recorded length as measured only when a current check measured it', async () => {
    await openBreakdown();
    expect(within(row('Chapter 1')).getByText('measured')).toBeTruthy();
    expect(within(row('Chapter 4')).getByText('measured')).toBeTruthy();
    expect(within(row('Chapter 7')).getByText('estimated from status')).toBeTruthy();
  });

  it('says a stale check no longer measures the chapter', async () => {
    await openBreakdown({ coverage: { stale: [WIRE_CHAPTERS[3].id] } });
    expect(within(row('Chapter 4')).getByText('estimated from status')).toBeTruthy();
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

  it('lists what is missing with its paragraphs, words and audio position, and links to the paragraph', async () => {
    const { goToManuscript } = await openBreakdown();
    const dialog = await openCheck('Chapter 4');
    expect(await within(dialog).findByText(/words not recorded$/)).toBeTruthy();
    expect(within(dialog).getByText('End not read')).toBeTruthy();
    expect(within(dialog).getByText(/Item 1 of the track, at \d+:\d\d in its audio file/)).toBeTruthy();
    // Only the paragraphs with missing words are listed, so they are read without scrolling past the rest.
    const table = within(dialog).getByRole('table', { name: 'Paragraphs' });
    expect(within(dialog).getByText(/^The paragraphs with missing words\. The other \d+ are fully recorded\.$/)).toBeTruthy();
    expect(within(table).queryByText('—', { selector: 'td:nth-child(3)' })).toBeNull();
    const go = within(dialog).getByRole('button', { name: /^Go to paragraph \d+$/ });
    fireEvent.click(go);
    const number = Number(go.textContent?.match(/\d+/)?.[0]);
    const chapter = WIRE_CHAPTERS[3];
    expect(goToManuscript).toHaveBeenCalledWith(chapter.id, chapter.paragraphIds![number - 1].index);
  });

  it('reads a complete chapter as all recorded, with its paragraphs folded', async () => {
    await openBreakdown();
    const dialog = await openCheck('Chapter 1');
    expect(await within(dialog).findByText('All the text is recorded')).toBeTruthy();
    expect(within(dialog).queryByRole('table', { name: 'Paragraphs' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Paragraphs/ })).toBeTruthy();
  });

  it('runs a check with real progress, then shows its result and measures the chapter', async () => {
    await openBreakdown();
    const dialog = await openCheck('Chapter 7');
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Check recording' }));
    const progress = await screen.findByRole('dialog', { name: 'Checking Chapter 7' });
    expect(within(progress).getByRole('progressbar')).toBeTruthy();
    expect(within(progress).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    const result = await screen.findByRole('dialog', { name: 'Recording check: Chapter 7' }, { timeout: 3000 });
    expect(await within(result).findByText('All the text is recorded')).toBeTruthy();
    fireEvent.click(within(result).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(row('Chapter 7')).getByText('measured')).toBeTruthy());
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
