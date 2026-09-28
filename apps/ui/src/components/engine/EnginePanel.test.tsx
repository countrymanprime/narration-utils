// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnginePanel, type EngineLinkState } from './EnginePanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';

afterEach(cleanup);

const LINKED: EngineLinkState = { dawFileLinked: true, dawReachable: false, dawProjectMatches: false, onLinkDawFile: () => {}, linkingDawFile: false };

function renderPanel(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, link: Partial<EngineLinkState> = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <EnginePanel open onClose={() => {}} notify={() => {}} link={{ ...LINKED, ...link }} />
      </ApiProvider>
    </MemoryRouter>,
  );
  return api;
}

const trackTable = () => screen.findByRole('table', { name: 'Tracks' });

// stage-navigation-and-page-replacement.prd.md Phase 6 (Q3 A): what the Tracks page held that is about REAPER, in a slide-over.
describe('EnginePanel', () => {
  it('is a named slide-over holding the linked project, the REAPER tools, the tracks and the chapter links', async () => {
    renderPanel();
    const panel = await screen.findByRole('dialog', { name: 'Audio engine' });
    expect(await within(panel).findByText('Alice.rpp')).toBeTruthy();
    expect(within(panel).getByRole('region', { name: 'REAPER project' })).toBeTruthy();
    const tools = await within(panel).findByRole('toolbar', { name: 'REAPER tools' });
    expect(
      within(tools)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Link chapters…', 'Prepare chapter render…', 'Create chapter regions…', 'Embed chapter tags…', 'Cleanup tools…', 'Retakes on lanes…']);
    expect(await within(panel).findByRole('table', { name: 'Chapter links' })).toBeTruthy();
    // No player: a chapter is heard in its Proof chapter view now.
    expect(within(panel).queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('lists every track with the chapter it is linked to', async () => {
    renderPanel({}, { chapterSync: 'activity' });
    const table = await trackTable();
    const rows = within(table).getAllByRole('row').slice(1);
    WIRE_TRACKS_PROJECT.tracks.forEach((track, index) => expect(within(rows[index]).getAllByRole('cell')[0].textContent).toContain(track.name));
    const chapterCell = (index: number) => within(rows[index]).getAllByRole('cell')[1].textContent;
    await waitFor(() => expect(chapterCell(0)).toBe(WIRE_CHAPTERS[0].title));
    expect(chapterCell(1)).toBe(WIRE_CHAPTERS[1].title);
    expect(chapterCell(2)).toBe('Not linked');
  });

  it('flags every track that has a missing or unsupported item', async () => {
    renderPanel();
    await trackTable();
    // Chapter 2's source is missing on disk, and Click Track's item is MIDI (unsupported).
    expect(screen.getAllByTitle("This track has an item that can't be played")).toHaveLength(2);
  });

  it('opens a REAPER tool’s dialog from the toolbar', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Cleanup tools…' }));
    expect(await screen.findByRole('dialog', { name: 'Cleanup tools' })).toBeTruthy();
  });

  it('hints when a chapter’s stage suggestion is waiting on its track link, and pluralizes it', async () => {
    const blocked = (chapterId: string, cause: 'unmapped_track' | 'unconfirmed_mapping') => ({
      chapterId,
      title: chapterId,
      from: 'recording' as const,
      target: 'editing' as const,
      verdict: 'unknown' as const,
      signals: [],
      causes: [cause],
    });
    renderPanel({ stageRecommendations: async () => ({ chapters: [blocked('c1', 'unmapped_track')] }) });
    expect(await screen.findByText('One chapter can’t get a stage suggestion until its track link is confirmed below.')).toBeTruthy();
    cleanup();
    renderPanel({ stageRecommendations: async () => ({ chapters: [blocked('c1', 'unmapped_track'), blocked('c2', 'unconfirmed_mapping')] }) });
    expect(await screen.findByText('2 chapters can’t get a stage suggestion until their track links are confirmed below.')).toBeTruthy();
    cleanup();
    renderPanel({ stageRecommendations: async () => ({ chapters: [] }) });
    await trackTable();
    expect(screen.queryByText(/can.t get a stage suggestion/)).toBeNull();
  });

  it('asks which .rpp to read when there are several, then lists that one’s tracks', async () => {
    const user = userEvent.setup();
    const api = renderPanel({}, { tracksCandidates: ['C:/Book/Draft.rpp', 'C:/Book/Final.rpp'] });
    expect(await screen.findByRole('heading', { name: 'Choose a REAPER project file' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Tracks' })).toBeNull();
    await user.click(screen.getByText('C:/Book/Final.rpp'));
    await trackTable();
    await expect(api.tracksDiscover()).resolves.toEqual({ candidates: ['C:/Book/Draft.rpp', 'C:/Book/Final.rpp'], selected: 'C:/Book/Final.rpp' });
  });

  it('explains when the project folder has no .rpp file, and when the project has no tracks', async () => {
    renderPanel({}, { tracksCandidates: [] });
    expect(await screen.findByText('No REAPER project file found.')).toBeTruthy();
    expect(screen.queryByRole('toolbar', { name: 'REAPER tools' })).toBeNull();
    cleanup();
    renderPanel({ tracksList: async () => ({ path: 'C:/Book/Empty.rpp', tracks: [] }) });
    expect(await screen.findByText('This REAPER project has no tracks yet.')).toBeTruthy();
  });

  it('shows a readable error when discovery fails', async () => {
    renderPanel({ tracksDiscover: async () => Promise.reject(new Error('open a project before viewing tracks')) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('open a project before viewing tracks');
  });

  it('offers the shared DAW-link binding, worded for whether a file is already linked', async () => {
    const onLinkDawFile = vi.fn();
    renderPanel({}, {}, { dawFileLinked: false, onLinkDawFile });
    (await screen.findByRole('button', { name: 'Link a REAPER project file' })).click();
    expect(onLinkDawFile).toHaveBeenCalledTimes(1);
    cleanup();
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Link a different REAPER project file' })).toBeTruthy();
  });

  it('says when REAPER has a different project open than the linked one', async () => {
    renderPanel({}, {}, { dawReachable: true, dawProjectMatches: false });
    expect(await screen.findByText(/REAPER has a different project open than the one linked here/)).toBeTruthy();
  });

  it('is not in the page while closed', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <EnginePanel open={false} onClose={() => {}} notify={() => {}} link={LINKED} />
      </ApiProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
