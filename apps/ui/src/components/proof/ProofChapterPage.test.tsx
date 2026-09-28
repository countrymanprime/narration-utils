// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_DISCREPANCIES, WIRE_TRACKS_PROJECT, WIRE_TRANSCRIPT } from '../../api/mockFixtures';
import { chapterName } from '../../chapterName';
import { CommandRouter } from '../../input/router';
import type { NarrationApi } from '../../types';
import { ProofChapterPage } from './ProofChapterPage';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

const chapter = WIRE_CHAPTERS[0];
const linkedTrackGuid = WIRE_TRACKS_PROJECT.tracks[0].guid;

type PageProps = Parameters<typeof ProofChapterPage>[0];

function renderWorkspace(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, page: Partial<PageProps> = {}) {
  const props: PageProps = {
    notify: () => {},
    transcript: WIRE_TRANSCRIPT,
    dawFileLinked: true,
    goToManuscript: () => {},
    goToStoryBible: () => {},
    refreshKey: 'test',
    ...page,
  };
  const api = createMockApi(overrides, {
    chapterTrackMappings: [{ trackGuid: linkedTrackGuid, chapterId: chapter.id, chapterTitle: chapter.title, confirmedAt: '2026-01-01T00:00:00Z' }],
    ...initial,
  });
  render(
    <ApiProvider api={api}>
      <CommandRouter>
        <MemoryRouter initialEntries={[`/proof/${chapter.id}`]}>
          <Routes>
            <Route path="/proof/:chapterId" element={<ProofChapterPage {...props} />} />
          </Routes>
        </MemoryRouter>
      </CommandRouter>
    </ApiProvider>,
  );
  return api;
}

describe('ProofChapterPage', () => {
  it('shows the chapter’s name and a current check state', async () => {
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` })).toBeTruthy();
    expect(await screen.findByText('Check current')).toBeTruthy();
  });

  it('renders the script’s words and a flag from the alignment', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    expect(await screen.findByText(/Flags/)).toBeTruthy();
    // The mock places one deterministic misread flag on a current, fully-recorded chapter.
    expect((await screen.findAllByText('Misread')).length > 0).toBeTruthy();
  });

  it('plays from a clicked word', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    const words = await screen.findAllByRole('button', { name: /./ });
    const wordButton = words.find((button) => button.hasAttribute('data-token-index'));
    expect(wordButton).toBeTruthy();
    await user.click(wordButton!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy());
  });

  it('toggles play/pause from the transport', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await user.click(await screen.findByRole('button', { name: 'Play' }));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('goes to and loops the word at the playhead in REAPER, then stops the loop (Phase 3)', async () => {
    const user = userEvent.setup();
    // The default mock REAPER (connected) and Chapter 1's alignment (every token 'read', per the alignment test
    // above): both Go to and Loop of the word at the playhead (token 0) succeed for real, through
    // workspaceGoTo/workspaceLoop, and Stop loop reads it back from findingsReaperStatus's loopingFindingId, exactly
    // as a real REAPER session would (useWorkspaceReaper.ts).
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });

    await user.click(await screen.findByRole('button', { name: 'Go to in REAPER' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(await screen.findByRole('button', { name: 'Loop in REAPER' }));
    const stop = await screen.findByRole('button', { name: 'Stop loop' });

    await user.click(stop);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop loop' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Loop in REAPER' })).toBeTruthy();
  });

  it('disables Go to and Loop in REAPER, with the reason, when REAPER is not connected', async () => {
    renderWorkspace({}, { reaper: 'standalone' });
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });

    const goTo = await screen.findByRole('button', { name: 'Go to in REAPER' });
    const loop = await screen.findByRole('button', { name: 'Loop in REAPER' });
    await waitFor(() => expect(goTo.hasAttribute('disabled')).toBe(true));
    expect(loop.hasAttribute('disabled')).toBe(true);
  });

  it('shows REAPER’s refusal as an alert and changes nothing', async () => {
    const user = userEvent.setup();
    renderWorkspace({}, { reaper: 'recording' });
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });

    await user.click(await screen.findByRole('button', { name: 'Go to in REAPER' }));
    expect((await screen.findByRole('alert')).textContent).toContain('REAPER is recording');
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
          <MemoryRouter initialEntries={[`/proof/${neverChecked.id}`]}>
            <Routes>
              <Route
                path="/proof/:chapterId"
                element={
                  <ProofChapterPage
                    notify={() => {}}
                    transcript={WIRE_TRANSCRIPT}
                    dawFileLinked
                    goToManuscript={() => {}}
                    goToStoryBible={() => {}}
                    refreshKey="test"
                  />
                }
              />
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

// Findings in the text (edit-and-proof-workspace.prd.md Phase 4): the mock seeds one transcript_discrepancy finding
// at chapter-1's own deterministic misread token (mockApi.ts's workspaceOverlayFinding, built from the same position
// workspaceMock.ts times it at), so it merges into that check-derived "Misread" flag rather than adding a second one.
describe('ProofChapterPage findings in the text (Phase 4)', () => {
  it('merges the chapter’s finding into the misread flag rather than duplicating it, with where it came from', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await screen.findAllByText('Misread');

    // The mock's only flag on this chapter is the misread; "Next flag" selects it (same as the ]/[ keyboard tests).
    await user.click(await screen.findByRole('button', { name: 'Next flag' }));
    expect(await within(screen.getByRole('region', { name: /^Flags/ })).findByText('From')).toBeTruthy();
    expect(await within(screen.getByRole('region', { name: /^Flags/ })).findByText(/Local AI compare/)).toBeTruthy();
    // The flags legend row and the selected flag's own heading - never a second flag row (the third is the notes table's Type chip).
    const flagsPanel = screen.getByRole('region', { name: /^Flags/ });
    expect(within(flagsPanel).getAllByText('Misread')).toHaveLength(2);
  });

  it('accepts a finding-backed flag in place, and the decision shows without leaving the page', async () => {
    const user = userEvent.setup();
    const api = renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await user.click(await screen.findByRole('button', { name: 'Next flag' }));

    await user.click(await screen.findByRole('button', { name: 'Pickup' }));
    expect(await screen.findByText('Saved: needs a pickup.')).toBeTruthy();

    const decided = await api.findingsGet('workspace-overlay-chapter-1');
    expect(decided.review.status).toBe('accepted');
  });

  it('shows a note field and rejects one over the limit', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await user.click(await screen.findByRole('button', { name: 'Next flag' }));

    const note = await screen.findByLabelText('Note (optional)');
    await user.type(note, 'a'.repeat(2001));
    expect(await screen.findByText(/at most 2000 characters/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pickup' }).hasAttribute('disabled')).toBe(true);
  });

  it('does not offer a decision on a flag with no backing finding', async () => {
    const user = userEvent.setup();
    // No findings at all here (overriding the mock's default overlay finding away): every flag comes straight from
    // the check's own alignment, so whichever one "Next flag" lands on first must show no decision controls.
    renderWorkspace({}, { coverage: { pickups: [chapter.id] }, findings: [] });
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await user.click(await screen.findByRole('button', { name: 'Next flag' }));

    expect(screen.queryByText('Decision')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pickup' })).toBeNull();
  });

  it('selects the flag a ?finding= deep link names ("Open chapter view" from Proof’s notes, Home or the Manuscript)', async () => {
    render(
      <ApiProvider
        api={createMockApi(
          {},
          { chapterTrackMappings: [{ trackGuid: linkedTrackGuid, chapterId: chapter.id, chapterTitle: chapter.title, confirmedAt: '2026-01-01T00:00:00Z' }] },
        )}
      >
        <CommandRouter>
          <MemoryRouter initialEntries={[`/proof/${chapter.id}?finding=workspace-overlay-chapter-1`]}>
            <Routes>
              <Route
                path="/proof/:chapterId"
                element={
                  <ProofChapterPage
                    notify={() => {}}
                    transcript={WIRE_TRANSCRIPT}
                    dawFileLinked
                    goToManuscript={() => {}}
                    goToStoryBible={() => {}}
                    refreshKey="test"
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </CommandRouter>
      </ApiProvider>,
    );
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    expect(await within(screen.getByRole('region', { name: /^Flags/ })).findByText('From')).toBeTruthy();
    expect(await within(await screen.findByRole('region', { name: /^Flags/ })).findByText(/Local AI compare/)).toBeTruthy();
  });
});

// Phase 3 (input-commands-and-pedals.prd.md): the workspace's shortcuts moved off a hand-written `window` `keydown`
// listener onto `workspace.*` page-scope commands, registered through `useCommand`. This page had zero keyboard
// coverage before this phase (the PRD's Evidence), so every one of the old listener's keys gets a test here for the
// first time. `renderWorkspace` now wraps in a real `<CommandRouter>` with the real catalog and default keymap, and
// dispatches through the real `KeyboardSource` (`userEvent.keyboard`, which bubbles to `document`), so these tests
// exercise the actual router, not a mock of it.
describe('ProofChapterPage keyboard commands (input-commands-and-pedals.prd.md Phase 3)', () => {
  it('toggles play/pause on Space (workspace.play)', async () => {
    renderWorkspace();
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
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
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await screen.findByRole('button', { name: 'Play' });

    await userEvent.keyboard(`{${key}}`);

    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('selects flags forward and back on ]/[ (workspace.flag.next/prev)', async () => {
    // Pickups seed a skip, a short read and a tail on top of the deterministic misread (see workspaceMock.ts /
    // coverageMock.ts's pickupsReportFor), so the chapter has several flags to move between instead of just one.
    renderWorkspace({}, { coverage: { pickups: [chapter.id] } });
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
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
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
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
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    await screen.findByRole('button', { name: 'Play' });

    await userEvent.keyboard('{Alt>}{ }{/Alt}');

    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });
});

// stage-navigation-and-page-replacement.prd.md Phase 5: the Proofing page's run and results fold into the chapter view. A finished
// run's discrepancies for this chapter are flags, with the inline diff and the old results row's actions in the flag detail.
describe('ProofChapterPage compare results (stage navigation Phase 5)', () => {
  const success = { ...WIRE_TRANSCRIPT, phase: 'success' as const, rows: WIRE_DISCREPANCIES };
  const flagsPanel = async () => {
    await screen.findByRole('heading', { name: `Proof · ${chapterName(chapter)}` });
    return (await screen.findByRole('heading', { name: /^Flags · / })).closest('section')!;
  };
  // Steps through the flags until the selected one carries a discrepancy (its detail offers Play recorded audio).
  const selectCompareFlag = async (user: ReturnType<typeof userEvent.setup>, panel: HTMLElement) => {
    for (let step = 0; step < 10 && !within(panel).queryByRole('button', { name: 'Play recorded audio' }); step += 1) {
      await user.click(within(panel).getByRole('button', { name: 'Next flag' }));
    }
    return within(panel).getByRole('button', { name: 'Play recorded audio' });
  };

  it('adds this chapter’s discrepancies to the flags, leaving other chapters’ out', async () => {
    renderWorkspace({}, {}, { transcript: success });
    const panel = await flagsPanel();
    // Chapter 1's extra words become a flag; Chapter 8's skipped words are not this chapter's, so no Skipped row.
    await within(panel).findByText('Extra words');
    expect(within(panel).queryByText('Skipped')).toBeNull();
    expect(screen.getByText(/2 discrepancies in Chapter 1/)).toBeTruthy();
  });

  it('shows a discrepancy’s inline diff, marker state and actions in the flag detail, and reports a failed jump', async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    renderWorkspace({ transcriptJump: () => Promise.reject(new Error('REAPER is not running')) }, {}, { transcript: success, notify });
    const panel = await flagsPanel();
    await within(panel).findByText('Extra words');
    const play = await selectCompareFlag(user, panel);
    expect(within(panel).getAllByText('Heard').length).toBeGreaterThan(0);
    expect(within(panel).getByText(/Ready to export|Exported|Already marked/)).toBeTruthy();
    await user.click(play);
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('REAPER is not running'), 'error'));
  });

  it('reviews the last comparison with no linked DAW file, with Play recorded audio off (PRD W16)', async () => {
    const user = userEvent.setup();
    renderWorkspace({}, {}, { dawFileLinked: false });
    await user.click(await screen.findByRole('button', { name: /Last narrated take/ }));
    const panel = await flagsPanel();
    await within(panel).findByText('Extra words');
    expect(((await selectCompareFlag(user, panel)) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Export \d+ marker/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// D85 #2 and #11 on #509 (ADR 0470): the chapter view leads with mock 04 - the notes strip, the chapter's notes table and a
// note's detail - and edit-and-proof mock 01's recording-check card.
describe('ProofChapterPage, mock 04 on the chapter view', () => {
  it('lists the chapter’s notes with no Chapter column, under the notes header', async () => {
    renderWorkspace();
    const table = await screen.findByRole('table', { name: 'Notes' });
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Time', 'Type', 'Script vs. heard', 'From', 'Resolution']);
    expect(screen.getByRole('heading', { name: /^Notes · \d+$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import proofer sheet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export for proofer' })).toBeTruthy();
  });

  it('pins each timed note on the strip, and a pin opens the note with Play ±3 s', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const strip = await screen.findByRole('region', { name: 'Notes in the recording' });
    const pins = within(strip).getAllByRole('button');
    expect(pins.length).toBeGreaterThan(0);
    await user.click(pins[0]);
    const play = await screen.findByRole('button', { name: 'Play ±3 s' });
    expect((play as HTMLButtonElement).disabled).toBe(false);
    await user.click(play);
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('shows the recording-check card with the chapter’s own figures', async () => {
    renderWorkspace();
    const card = await screen.findByRole('region', { name: 'Recording check' });
    expect(await within(card).findByText('Recorded')).toBeTruthy();
    expect(within(card).getByText('100%')).toBeTruthy();
    expect(within(card).getByText(/Current for the project saved/)).toBeTruthy();
  });
});
