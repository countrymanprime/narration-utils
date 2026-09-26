// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import { chapterName } from '../../chapterName';
import { CommandRouter } from '../../input/router';
import type { NarrationApi } from '../../types';
import { WorkspacePage } from './WorkspacePage';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

const chapter = WIRE_CHAPTERS[0];
const linkedTrackGuid = WIRE_TRACKS_PROJECT.tracks[0].guid;

function renderWorkspace(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, {
    chapterTrackMappings: [{ trackGuid: linkedTrackGuid, chapterId: chapter.id, chapterTitle: chapter.title, confirmedAt: '2026-01-01T00:00:00Z' }],
    ...initial,
  });
  render(
    <ApiProvider api={api}>
      <CommandRouter>
        <MemoryRouter initialEntries={[`/tracks/chapter/${chapter.id}`]}>
          <Routes>
            <Route path="/tracks/chapter/:chapterId" element={<WorkspacePage notify={() => {}} />} />
          </Routes>
        </MemoryRouter>
      </CommandRouter>
    </ApiProvider>,
  );
  return api;
}

describe('WorkspacePage', () => {
  it('shows the chapter’s name and a current check state', async () => {
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: chapterName(chapter) })).toBeTruthy();
    expect(await screen.findByText('Check current')).toBeTruthy();
  });

  it('renders the script’s words and a flag from the alignment', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    expect(await screen.findByText(/Flags/)).toBeTruthy();
    // The mock places one deterministic misread flag on a current, fully-recorded chapter.
    expect(await screen.findByText('Misread')).toBeTruthy();
  });

  it('plays from a clicked word', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    const words = await screen.findAllByRole('button', { name: /./ });
    const wordButton = words.find((button) => button.hasAttribute('data-token-index'));
    expect(wordButton).toBeTruthy();
    await user.click(wordButton!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy());
  });

  it('toggles play/pause from the transport', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await user.click(await screen.findByRole('button', { name: 'Play' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('shows the "not checked yet" state, with no player, for a chapter never checked', async () => {
    const neverChecked = WIRE_CHAPTERS[9]; // status 'proofing'/'not_started' tier, no recordedFraction seeded
    render(
      <ApiProvider
        api={createMockApi(
          {},
          {
            chapterTrackMappings: [
              {
                trackGuid: WIRE_TRACKS_PROJECT.tracks[0].guid,
                chapterId: neverChecked.id,
                chapterTitle: neverChecked.title,
                confirmedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        )}
      >
        <CommandRouter>
          <MemoryRouter initialEntries={[`/tracks/chapter/${neverChecked.id}`]}>
            <Routes>
              <Route path="/tracks/chapter/:chapterId" element={<WorkspacePage notify={() => {}} />} />
            </Routes>
          </MemoryRouter>
        </CommandRouter>
      </ApiProvider>,
    );
    expect(await screen.findAllByText(/hasn’t been checked yet/)).not.toHaveLength(0);
  });

  it('shows a message when the chapter has no linked track', async () => {
    renderWorkspace({}, { chapterTrackMappings: [] });
    expect(await screen.findByText(/isn’t linked to a REAPER track yet/)).toBeTruthy();
  });
});

// Phase 3 (input-commands-and-pedals.prd.md): the workspace's shortcuts moved off a hand-written `window` `keydown`
// listener onto `workspace.*` page-scope commands, registered through `useCommand`. This page had zero keyboard
// coverage before this phase (the PRD's Evidence), so every one of the old listener's keys gets a test here for the
// first time. `renderWorkspace` now wraps in a real `<CommandRouter>` with the real catalog and default keymap, and
// dispatches through the real `KeyboardSource` (`userEvent.keyboard`, which bubbles to `document`), so these tests
// exercise the actual router, not a mock of it.
describe('WorkspacePage keyboard commands (input-commands-and-pedals.prd.md Phase 3)', () => {
  it('toggles play/pause on Space (workspace.play)', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await screen.findByRole('button', { name: 'Play' });

    await userEvent.keyboard(' ');
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();

    await userEvent.keyboard(' ');
    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
  });

  // stepWord/stepParagraph seek with a 1-second pre-roll (EP5) ahead of the actual word/paragraph target, which - at
  // 155 words/minute - is worth more than two words: the DOM's karaoke highlight (`isCurrent`) lags the raw target by
  // that same amount and can stay pinned near a chapter's start across repeated presses. That pre-roll/highlight
  // interaction is stepWord/stepParagraph's own pre-existing behaviour (unit-untested before this phase, and out of
  // this migration's scope), so these tests prove the command fires - a seek that starts playback, the same signal
  // `workspace.play` uses - rather than asserting on the highlighted token index, which pre-roll makes unreliable.
  it.each([
    ['ArrowRight', 'workspace.word.next'],
    ['ArrowLeft', 'workspace.word.prev'],
    ['ArrowDown', 'workspace.paragraph.next'],
    ['ArrowUp', 'workspace.paragraph.prev'],
  ] as const)('seeks and starts playback on %s (%s)', async (key, _commandId) => {
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await screen.findByRole('button', { name: 'Play' });

    await userEvent.keyboard(`{${key}}`);

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('selects flags forward and back on ]/[ (workspace.flag.next/prev)', async () => {
    // Pickups seed a skip, a short read and a tail on top of the deterministic misread (see workspaceMock.ts /
    // coverageMock.ts's pickupsReportFor), so the chapter has several flags to move between instead of just one.
    renderWorkspace({}, { coverage: { pickups: [chapter.id] } });
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await screen.findByText(/Flags/);

    await userEvent.keyboard(']');
    expect(await screen.findByText(/Flag 1 of \d+/)).toBeTruthy();

    await userEvent.keyboard(']');
    expect(await screen.findByText(/Flag 2 of \d+/)).toBeTruthy();

    // user-event's keyboard() syntax treats `[` as the start of a key descriptor, so a literal `[` is `[[` (doubled).
    await userEvent.keyboard('[[');
    expect(await screen.findByText(/Flag 1 of \d+/)).toBeTruthy();
  });

  it('does not fire a workspace command while a field is focused', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await screen.findByRole('button', { name: 'Play' });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    await userEvent.keyboard(' ');

    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    input.remove();
  });

  it('does not fire workspace.play when a modifier is held (exact-modifier match)', async () => {
    // Behaviour change from the old listener (which ignored modifiers): the registry's default gesture for
    // workspace.play is a bare Space, so Alt+Space no longer toggles play here (App.tsx's Alt+ArrowLeft nav.back
    // stops double-firing workspace.word.prev the same way, once that migration lands).
    renderWorkspace();
    await screen.findByRole('heading', { name: chapterName(chapter) });
    await screen.findByRole('button', { name: 'Play' });

    await userEvent.keyboard('{Alt>}{ }{/Alt}');

    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });
});
