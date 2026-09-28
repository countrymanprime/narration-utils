// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { BoothSession, type BoothSource } from './BoothSession';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { DawMockSeed } from '../../api/dawMock';
import { CommandRouter } from '../../input/router';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { CreditsRenderResult, GuideEntity, ManuscriptNote, ManuscriptParagraph, NarrationApi, TeleprompterEvent, TeleprompterState } from '../../types';
import { RAIL_STORAGE_KEY } from './readerPreferences';

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const CHAPTER = { id: 'chapter-1', title: 'Chapter 1', subtitle: 'Down the Rabbit-Hole' };
const CREDITS_PREVIEW: CreditsRenderResult = {
  text: '[Title], written by [Author], narrated by [Narrator].',
  words: 6,
  unresolved: ['Title', 'Author', 'Narrator'],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderDialog(
  overrides: Partial<NarrationApi> = {},
  onClose = vi.fn(),
  content: {
    entities?: GuideEntity[];
    notes?: ManuscriptNote[];
    source?: BoothSource;
    onFixCredits?: () => void;
    setup?: ReactNode;
  } = {},
  daw?: DawMockSeed,
) {
  const eventListeners = new Set<(event: TeleprompterEvent) => void>();
  const stateListeners = new Set<(state: TeleprompterState) => void>();
  const api = createMockApi(
    {
      subscribeTeleprompterEvent: (listener) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      subscribeTeleprompterState: (listener) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
      ...overrides,
    },
    { daw },
  );
  const { unmount } = render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <CommandRouter>
          <BoothSession
            source={content.source ?? { kind: 'chapter', chapter: CHAPTER }}
            entities={content.entities}
            notes={content.notes}
            onExit={onClose}
            onFixCredits={content.onFixCredits}
            setup={content.setup}
          />
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
  return {
    api,
    unmount,
    onClose,
    emit: (event: TeleprompterEvent) => act(() => eventListeners.forEach((listener) => listener(event))),
    setState: (state: Partial<TeleprompterState>) =>
      act(() =>
        stateListeners.forEach((listener) => listener({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null, ...state })),
      ),
  };
}

function renderCredits(overrides: Partial<NarrationApi> = {}, onClose = vi.fn(), preview: CreditsRenderResult = CREDITS_PREVIEW, onFixCredits?: () => void) {
  return renderDialog(overrides, onClose, { source: { kind: 'credits', credits: 'opening', preview }, onFixCredits });
}

async function openMicPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Microphone:/ }));
}

describe('BoothSession', () => {
  it('shows the chapter in its status line, with no dialog and no chapter picker of its own (the page passes one as setup)', async () => {
    const user = userEvent.setup();
    renderDialog();

    const status = await screen.findByRole('region', { name: 'Status' });
    expect(within(status).getByText('Chapter 1 — Down the Rabbit-Hole')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Chapter')).toBeNull();
    await openMicPopover(user);
    // { selector: 'select' } disambiguates from the popover popup itself, which shares the same accessible name "Microphone".
    expect(await screen.findByLabelText('Microphone', { selector: 'select' })).toBeTruthy();
  });

  it('starts a session for the fixed chapter once a microphone is chosen', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderDialog({ teleprompterStart });

    await openMicPopover(user);
    const field = await screen.findByRole('combobox', { name: 'Microphone' });
    await user.selectOptions(field, DEVICE_NAME);
    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it('exits without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('button', { name: /^Microphone:/ });
    await user.click(screen.getByRole('button', { name: /Exit booth/ }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for confirmation before leaving a live session, and stops it on confirm', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Exit booth/ }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and leave' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // Escape is Exit booth (mock 03) and must not silently stop a live session: it takes the same `requestExit` path as
  // the header's Exit booth button, which confirms first while a session is active.
  it('Escape asks for confirmation before leaving a live session too, the same as Exit booth', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    // Focus in the Booth (Escape is its own root's key, like the dialog's was the dialog's).
    screen.getByRole('button', { name: 'Stop reading' }).focus();
    await user.keyboard('{Escape}');

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and leave' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape exits without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('button', { name: /^Microphone:/ });
    document.querySelector<HTMLElement>('div[tabindex="0"]')!.focus();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('cancelling the exit confirm leaves the session running and the Booth open', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Exit booth/ }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(teleprompterStop).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy();
  });
});

const HALE: GuideEntity = {
  id: 'e1',
  canonical_name: 'Mr. Hale',
  aliases: [],
  category: 'Character',
  occurrences: [{ chapter: 'Chapter 1', paragraph: 0, excerpt: 'Then Mr. Hale left the room.' }],
  occurrence_count: 1,
  pronunciation: { ipa: 'heɪl', source: 'manual', confidence: 'high' },
  description: { text: 'The rector.', evidence: {} },
  personality_notes: [],
  relationships: [],
  properties: [],
  locked: false,
  review_state: 'approved',
};
const PARAGRAPHS: ManuscriptParagraph[] = [
  { id: 'p1', chapterId: 'chapter-1', chapter: 'Chapter 1', index: 0, text: 'Then Mr. Hale left the room.', entityIds: ['e1'] },
  { id: 'p2', chapterId: 'chapter-1', chapter: 'Chapter 1', index: 1, text: 'The door stayed open.', entityIds: [] },
];
const NOTE: ManuscriptNote = {
  id: 'n1',
  chapter: 'Chapter 1',
  chapterId: 'chapter-1',
  paragraph: 1,
  text: 'Let this land softly.',
  createdAt: '2026-01-01T00:00:00.000Z',
  anchorStart: 9,
  anchorEnd: 15,
  anchorText: 'stayed',
};
const SCRIPT: TeleprompterEvent = {
  type: 'script',
  chapter: { id: 'chapter-1', title: 'Chapter 1' },
  tokens: 11,
  spans: [
    { kind: 'title', id: 'chapter-1', index: null, start: 0, count: 2 },
    { kind: 'paragraph', id: 'p1', index: 0, start: 2, count: 5 },
    { kind: 'paragraph', id: 'p2', index: 1, start: 7, count: 4 },
  ],
};

function renderMarked(overrides: Partial<NarrationApi> = {}) {
  return renderDialog({ manuscriptParagraphs: async () => PARAGRAPHS, ...overrides }, vi.fn(), { entities: [HALE], notes: [NOTE] });
}
const findMark = async (kind: string) => {
  await waitFor(() => expect(document.querySelector(`[data-highlight="${kind}"][role="button"]`)).toBeTruthy());
  return document.querySelector<HTMLElement>(`[data-highlight="${kind}"][role="button"]`)!;
};

describe('BoothSession story bible and note marks (teleprompter-manuscript-integration.prd.md Phase 5)', () => {
  it('marks story bible mentions and note anchors in the text before a session starts, with the key open in the rail', async () => {
    renderMarked();

    expect((await findMark('Character')).textContent?.replace(/\s+/g, ' ')).toBe('Mr. Hale');
    expect((await findMark('Note')).textContent).toBe('stayed');
    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    expect(within(rail).getByRole('tab', { name: 'Key', selected: true })).toBeTruthy();
    expect(within(rail).getByText('story bible entry')).toBeTruthy();
  });

  it('opens an entity mark in the Story bible tab, read-only and without leaving for another line', async () => {
    const user = userEvent.setup();
    renderMarked();

    await user.click(await findMark('Character'));

    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    expect(within(rail).getByRole('tab', { name: 'Story bible', selected: true })).toBeTruthy();
    expect(within(rail).getByRole('heading', { name: 'Mr. Hale' })).toBeTruthy();
    expect(within(rail).getByText('The rector.')).toBeTruthy();
    expect(within(rail).queryByRole('button', { name: 'Go to line in Script' })).toBeNull();
  });

  it('opens a note mark in the Notes tab with that note current', async () => {
    const user = userEvent.setup();
    renderMarked();

    await user.click(await findMark('Note'));

    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    expect(within(rail).getByRole('tab', { name: 'Notes', selected: true })).toBeTruthy();
    expect(within(rail).getByText('Let this land softly.').closest('li')?.getAttribute('aria-current')).toBe('true');
  });

  it('leaves the cursor, the tracker and the scroll position alone when a mark is opened mid-session', async () => {
    const user = userEvent.setup();
    const teleprompterSeek = vi.fn().mockResolvedValue(undefined);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { setState, emit } = renderMarked({ teleprompterSeek });
    await findMark('Character');
    setState({ phase: 'running', chapter: 'chapter-1' });
    emit(SCRIPT);
    emit({ type: 'position', read: 8, committed: 8, status: 'listening', jump: null, skipped: null });
    await waitFor(() => expect(document.querySelector('[data-word="8"] [data-highlight="Cursor"]')).toBeTruthy());
    // The follow scroll for word 8 runs in an effect after the highlight renders; wait for it, or on a slow runner it lands
    // after mockClear below and is counted against the mark clicks.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    const body = document.querySelector<HTMLElement>('div[tabindex="0"]')!;
    body.scrollTop = 120;
    scrollIntoView.mockClear();

    await user.click(await findMark('Character'));
    await user.click(await findMark('Note'));

    expect(teleprompterSeek).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(body.scrollTop).toBe(120);
    expect(document.querySelector('[data-word="8"] [data-highlight="Cursor"]')).toBeTruthy();
  });

  // teleprompter-engines-and-input-devices.prd.md Phase 10: 0 pull-backs after a user scroll until following resumes.
  it('never pulls the text back after the narrator scrolls, until Follow is pressed', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { setState, emit } = renderMarked();
    await findMark('Character');
    setState({ phase: 'running', chapter: 'chapter-1' });
    emit(SCRIPT);
    emit({ type: 'position', read: 7, committed: 7, status: 'listening', jump: null, skipped: null });
    await waitFor(() => expect(document.querySelector('[data-word="7"] [data-highlight="Cursor"]')).toBeTruthy());
    const follow = screen.getByRole('button', { name: 'Follow' });
    expect(follow).toHaveProperty('disabled', true);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    const text = screen.getByRole('region', { name: 'Chapter text' });
    const inputs: [() => void, number][] = [
      [() => fireEvent.wheel(text, { deltaY: 300 }), 8],
      [() => fireEvent.touchMove(text), 9],
      [() => fireEvent.keyDown(text, { key: 'PageDown' }), 10],
    ];
    for (const [scroll, read] of inputs) {
      scroll();
      expect(await screen.findByText(/Following paused/)).toBeTruthy();
      scrollIntoView.mockClear();
      emit({ type: 'position', read, committed: read, status: 'listening', jump: null, skipped: null });
      await waitFor(() => expect(document.querySelector(`[data-word="${read}"] [data-highlight="Cursor"]`)).toBeTruthy());
      expect(scrollIntoView).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Follow' }));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Following paused/)).toBeNull();
    }
  });

  it('remembers the rail being hidden and its tab for the next dialog, in browser storage', async () => {
    const user = userEvent.setup();
    renderMarked();
    const rail = await screen.findByRole('complementary', { name: 'Reading panel' });
    await user.click(within(rail).getByRole('tab', { name: 'Notes' }));
    await user.click(within(rail).getByRole('button', { name: 'Hide reading panel' }));

    expect(screen.queryByRole('complementary', { name: 'Reading panel' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(RAIL_STORAGE_KEY) ?? '{}')).toEqual({ open: false, tab: 'notes' });

    cleanup();
    renderMarked();
    await user.click(await screen.findByRole('button', { name: 'Show reading panel' }));
    expect(screen.getByRole('tab', { name: 'Notes', selected: true })).toBeTruthy();
  });

  it('opens with the default rail when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderMarked();

    const rail = await screen.findByRole('complementary', { name: 'Reading panel' });
    expect(within(rail).getByRole('tab', { name: 'Key', selected: true })).toBeTruthy();
  });
});

// p2 "The door stayed open." is words 7-10 of SCRIPT.
const SKIP: TeleprompterEvent = { type: 'flag', id: 1, kind: 'skipped', start: 8, end: 9, heard: '' };
const MISREAD: TeleprompterEvent = { type: 'flag', id: 2, kind: 'misread', start: 10, end: 11, heard: 'opened' };

async function renderListening(overrides: Partial<NarrationApi> = {}) {
  const view = renderMarked(overrides);
  await findMark('Character');
  view.setState({ phase: 'running', chapter: 'chapter-1' });
  view.emit(SCRIPT);
  view.emit({ type: 'position', read: 10, committed: 10, status: 'listening', jump: null, skipped: null });
  view.emit(SKIP);
  view.emit(MISREAD);
  return view;
}

describe('BoothSession flags (teleprompter-manuscript-integration.prd.md Phase 7)', () => {
  it('shows skipped and restart flags by default, and misreads once the narrator turns them on', async () => {
    const user = userEvent.setup();
    await renderListening();

    expect((await findMark('Skipped')).textContent).toBe('door');
    expect(document.querySelector('[data-highlight="Misread"][role="button"]')).toBeNull();

    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    await user.click(within(rail).getByRole('tab', { name: 'Flags' }));
    expect(within(rail).getByText('1 more flag is of a kind not shown.')).toBeTruthy();
    await user.click(within(rail).getByRole('checkbox', { name: 'Misreads' }));

    expect((await findMark('Misread')).textContent).toBe('open.');
  });

  it('opens a flag in the Flags tab with what was heard, dismisses it, and offers "Punch from here" only as a placeholder', async () => {
    const user = userEvent.setup();
    const teleprompterSeek = vi.fn().mockResolvedValue(undefined);
    await renderListening({ teleprompterSeek });

    await user.click(await findMark('Skipped'));

    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    expect(within(rail).getByRole('tab', { name: 'Flags', selected: true })).toBeTruthy();
    const detail = within(rail).getByRole('region', { name: 'Suspected skipped words' });
    expect(within(detail).getByText('“door”')).toBeTruthy();
    // Gated by the DAW port's `punch` capability (DAW port PRD Phase 7): experimental and off by default, so it stays
    // aria-disabled - never the native `disabled`, since the gate itself, not the browser, has to stop the press.
    const punch = within(detail).getByRole('button', { name: 'Punch from here' });
    await waitFor(() => expect(punch.getAttribute('aria-disabled')).toBe('true'));
    expect(punch.hasAttribute('disabled')).toBe(false);
    await user.click(punch);
    expect(teleprompterSeek).not.toHaveBeenCalled();

    await user.click(within(detail).getByRole('button', { name: 'Dismiss' }));

    expect(document.querySelector('[data-highlight="Skipped"][role="button"]')).toBeNull();
    expect(within(detail).getByText('Dismissed')).toBeTruthy();
  });

  it('keeps every flag as a finding when the session ends, with the dismissal, and says so', async () => {
    const user = userEvent.setup();
    const teleprompterSaveFlags = vi.fn().mockResolvedValue([]);
    const { setState } = await renderListening({ teleprompterSaveFlags });
    await user.click(await findMark('Skipped'));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(teleprompterSaveFlags).not.toHaveBeenCalled();

    setState({ phase: 'stopped', chapter: 'chapter-1' });

    await waitFor(() => expect(teleprompterSaveFlags).toHaveBeenCalledOnce());
    expect(teleprompterSaveFlags).toHaveBeenCalledWith('chapter-1', [
      { kind: 'skipped', paragraphId: 'p2', wordStart: 1, wordEnd: 2, scriptStart: 8, scriptEnd: 9, heard: '', dismissed: true },
      { kind: 'misread', paragraphId: 'p2', wordStart: 3, wordEnd: 4, scriptStart: 10, scriptEnd: 11, heard: 'opened', dismissed: false },
    ]);
    expect(await screen.findByText('2 flags are kept for review as suspected, unreviewed findings.')).toBeTruthy();
  });

  it('keeps the flags when the Booth is left and when a flag is dismissed after the session', async () => {
    const user = userEvent.setup();
    const teleprompterSaveFlags = vi.fn().mockResolvedValue([]);
    const { setState, onClose, unmount } = await renderListening({ teleprompterSaveFlags });
    setState({ phase: 'stopped', chapter: 'chapter-1' });
    await waitFor(() => expect(teleprompterSaveFlags).toHaveBeenCalledTimes(1));

    await user.click(await findMark('Skipped'));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(teleprompterSaveFlags).toHaveBeenCalledTimes(2));
    expect(teleprompterSaveFlags.mock.calls[1][1][0]).toMatchObject({ kind: 'skipped', dismissed: true });

    await user.click(screen.getByRole('button', { name: /Exit booth/ }));
    expect(onClose).toHaveBeenCalled();
    // Leaving unmounts the Booth (App navigates away), which keeps what this session flagged.
    unmount();
    expect(teleprompterSaveFlags).toHaveBeenCalledTimes(3);
  });

  it('hides a flag an earlier session already dismissed once the host says so', async () => {
    const teleprompterSaveFlags = vi.fn().mockResolvedValue([{ review: { status: 'dismissed' } }, { review: { status: 'unreviewed' } }]);
    const { setState } = await renderListening({ teleprompterSaveFlags });
    await findMark('Skipped');

    setState({ phase: 'stopped', chapter: 'chapter-1' });

    await waitFor(() => expect(document.querySelector('[data-highlight="Skipped"][role="button"]')).toBeNull());
  });

  it('says so in the Flags tab when the flags could not be kept', async () => {
    const user = userEvent.setup();
    const { setState } = await renderListening({ teleprompterSaveFlags: vi.fn().mockRejectedValue(new Error('the disk is full')) });
    await user.click(within(screen.getByRole('complementary', { name: 'Reading panel' })).getByRole('tab', { name: 'Flags' }));

    setState({ phase: 'stopped', chapter: 'chapter-1' });

    expect(await screen.findByText('The flags could not be kept for review: the disk is full')).toBeTruthy();
  });
});

describe('BoothSession credits mode (manuscript-credits-card-parity.prd.md, Phase 2)', () => {
  it('names the credits kind in its status line, with no resume prompt (MC9)', async () => {
    renderCredits();
    expect(within(await screen.findByRole('region', { name: 'Status' })).getByText('Opening credits')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
  });

  it("shows the C6 unresolved-token warning with a working Fill them in Settings, in the resume prompt's slot", async () => {
    const user = userEvent.setup();
    const onFixCredits = vi.fn();
    renderCredits({}, vi.fn(), CREDITS_PREVIEW, onFixCredits);

    const warning = await screen.findByRole('status', { name: 'Some opening credits tokens have no value' });
    expect(within(warning).getByText(/Title, Author, Narrator will show as written/)).toBeTruthy();

    await user.click(within(warning).getByRole('button', { name: 'Fill them in Settings' }));
    expect(onFixCredits).toHaveBeenCalledTimes(1);
  });

  it('shows no warning and no Fill them in Settings button when every token is resolved', async () => {
    renderCredits({}, vi.fn(), { text: 'Alice, written by Lewis Carroll, narrated by Ada Finch.', words: 7, unresolved: [] });
    await screen.findByRole('button', { name: /^Microphone:/ });
    expect(screen.queryByRole('status', { name: /tokens have no value/ })).toBeNull();
  });

  it('shows no Fill them in Settings button when onFixCredits is not given, even with unresolved tokens', async () => {
    renderCredits();
    const warning = await screen.findByRole('status', { name: 'Some opening credits tokens have no value' });
    expect(within(warning).queryByRole('button', { name: 'Fill them in Settings' })).toBeNull();
  });

  it('starts a session for the credits, not a chapter', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderCredits({ teleprompterStart });

    await openMicPopover(user);
    const field = await screen.findByRole('combobox', { name: 'Microphone' });
    await user.selectOptions(field, DEVICE_NAME);
    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(teleprompterStart).toHaveBeenCalledWith({ credits: 'opening', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it('shows flags during the session but never keeps them (MC8 a), saying so in the Flags tab', async () => {
    const user = userEvent.setup();
    const teleprompterSaveFlags = vi.fn();
    const { setState, emit } = renderCredits({ teleprompterSaveFlags });
    await screen.findByRole('button', { name: /^Microphone:/ });
    setState({ phase: 'running', chapter: 'credits-opening' });
    emit({
      type: 'script',
      chapter: { id: 'credits-opening', title: 'Opening credits' },
      tokens: 7,
      spans: [{ kind: 'paragraph', id: 'credits-opening-1', index: 0, start: 0, count: 7 }],
    });
    emit({ type: 'position', read: 0, committed: 0, status: 'listening', jump: null, skipped: null });
    emit({ type: 'flag', id: 1, kind: 'skipped', start: 0, end: 1, heard: '' });
    await waitFor(() => expect(document.querySelector('[data-highlight="Skipped"][role="button"]')).toBeTruthy());

    const rail = screen.getByRole('complementary', { name: 'Reading panel' });
    await user.click(within(rail).getByRole('tab', { name: 'Flags' }));
    expect(within(rail).getByText('Flags on the credits are not kept.')).toBeTruthy();

    setState({ phase: 'stopped', chapter: 'credits-opening' });
    expect(teleprompterSaveFlags).not.toHaveBeenCalled();
  });

  it('exits without keeping any flag, even after dismissing one', async () => {
    const user = userEvent.setup();
    const teleprompterSaveFlags = vi.fn();
    const { onClose, emit, setState, unmount } = renderCredits({ teleprompterSaveFlags });
    await screen.findByRole('button', { name: /^Microphone:/ });
    setState({ phase: 'running', chapter: 'credits-opening' });
    emit({
      type: 'script',
      chapter: { id: 'credits-opening', title: 'Opening credits' },
      tokens: 7,
      spans: [{ kind: 'paragraph', id: 'credits-opening-1', index: 0, start: 0, count: 7 }],
    });
    emit({ type: 'position', read: 0, committed: 0, status: 'listening', jump: null, skipped: null });
    emit({ type: 'flag', id: 1, kind: 'skipped', start: 0, end: 1, heard: '' });
    await waitFor(() => expect(document.querySelector('[data-highlight="Skipped"][role="button"]')).toBeTruthy());
    setState({ phase: 'stopped', chapter: 'credits-opening' });

    await user.click(screen.getByRole('button', { name: /Exit booth/ }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(teleprompterSaveFlags).not.toHaveBeenCalled();
  });

  it('asks "Stop reading?" before leaving for Settings while a session is listening, then leaves once confirmed', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const onFixCredits = vi.fn();
    const { onClose, setState } = renderCredits({ teleprompterStop }, vi.fn(), CREDITS_PREVIEW, onFixCredits);
    setState({ phase: 'running', chapter: 'credits-opening' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    const warning = screen.getByRole('status', { name: 'Some opening credits tokens have no value' });
    await user.click(within(warning).getByRole('button', { name: 'Fill them in Settings' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onFixCredits).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Stop and leave' }));

    expect(teleprompterStop).toHaveBeenCalled();
    // Settings is where it goes instead of Exit booth's destination.
    expect(onClose).not.toHaveBeenCalled();
    expect(onFixCredits).toHaveBeenCalledTimes(1);
  });

  it('leaves for Settings at once, with no confirm, when no session is running', async () => {
    const user = userEvent.setup();
    const onFixCredits = vi.fn();
    const { onClose } = renderCredits({}, vi.fn(), CREDITS_PREVIEW, onFixCredits);

    const warning = await screen.findByRole('status', { name: 'Some opening credits tokens have no value' });
    await user.click(within(warning).getByRole('button', { name: 'Fill them in Settings' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onFixCredits).toHaveBeenCalledTimes(1);
  });
});

describe('Record in REAPER (Phase 7)', () => {
  const daw: DawMockSeed = { toggles: { record: 'on' } };

  it('turning the toggle on for the first time in this project opens a confirm naming the chapter', async () => {
    const user = userEvent.setup();
    renderDialog({}, vi.fn(), {}, daw);

    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);

    const confirm = await screen.findByRole('alertdialog', { name: 'Record in REAPER?' });
    expect(within(confirm).getByText(/Chapter 1.*Down the Rabbit-Hole/)).toBeTruthy();
  });

  it('confirming saves the project setting and turns the toggle on; a later toggle-on in the same project does not ask again', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => ({}) as never);
    renderDialog({ saveSettings }, vi.fn(), {}, daw);
    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));

    expect(saveSettings).toHaveBeenCalledWith('ReadAloud', 'project', { record_in_reaper: 'true', record_confirmed: 'true' });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('alertdialog', { name: 'Record in REAPER?' })).toBeNull();
  });

  it('cancelling the confirm leaves the toggle off', async () => {
    const user = userEvent.setup();
    renderDialog({}, vi.fn(), {}, daw);
    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog', { name: 'Record in REAPER?' })).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('Play arms REAPER before listening starts, once the toggle is confirmed on', async () => {
    const user = userEvent.setup();
    const readAloudRecordStart = vi.fn(async () => ({ outcome: 'started' as const, trackGuid: '{1}', position: 0 }));
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderDialog({ readAloudRecordStart, teleprompterStart }, vi.fn(), {}, daw);
    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await openMicPopover(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);

    await user.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(readAloudRecordStart).toHaveBeenCalledWith('chapter-1'));
    expect(teleprompterStart).toHaveBeenCalled();
  });

  it('Play never starts listening when REAPER refuses to start recording, and shows why', async () => {
    const user = userEvent.setup();
    const readAloudRecordStart = vi.fn(async () => ({ outcome: 'refused' as const, reason: 'not_armed' as const, message: 'No track is armed in REAPER.' }));
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderDialog({ readAloudRecordStart, teleprompterStart }, vi.fn(), {}, daw);
    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await openMicPopover(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);

    await user.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(readAloudRecordStart).toHaveBeenCalled());
    expect(teleprompterStart).not.toHaveBeenCalled();
    expect(await screen.findByText('No track is armed in REAPER.')).toBeTruthy();
  });

  it('the "Stop reading?" confirm says REAPER also stops once this app started recording', async () => {
    const user = userEvent.setup();
    const readAloudRecordStart = vi.fn(async () => ({ outcome: 'started' as const, trackGuid: '{1}', position: 0 }));
    const readAloudRecordStop = vi.fn(async () => ({ outcome: 'stopped' as const, restored: 1, kept: 0 }));
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { setState } = renderDialog({ readAloudRecordStart, readAloudRecordStop, teleprompterStart, teleprompterStop }, vi.fn(), {}, daw);
    const toggle = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
    await user.click(toggle);
    await user.click(await screen.findByRole('button', { name: 'Turn on' }));
    await openMicPopover(user);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(readAloudRecordStart).toHaveBeenCalled());
    setState({ phase: 'running', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /Exit booth/ }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(within(confirm).getByText(/stops REAPER's recording/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Stop and leave' }));
    expect(teleprompterStop).toHaveBeenCalled();
    await waitFor(() => expect(readAloudRecordStop).toHaveBeenCalled());
  });
});

describe('BoothSession layout (stage-navigation-and-page-replacement.prd.md Phase 4, mock 03)', () => {
  it("lays the session out on FocusShell, with the reading controls as the Booth's command bar and the rail in its own landmark", async () => {
    renderDialog();
    const commands = await screen.findByRole('region', { name: 'Booth commands' });
    expect(within(commands).getByRole('toolbar', { name: 'Reading controls' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Rail' })).toBeTruthy();
  });

  it('shows the setup the page passes only until a session starts', async () => {
    const { setState } = renderDialog({}, vi.fn(), { setup: <p>Pick a chapter</p> });
    expect(await screen.findByText('Pick a chapter')).toBeTruthy();
    setState({ phase: 'running', chapter: CHAPTER.id });
    await waitFor(() => expect(screen.queryByText('Pick a chapter')).toBeNull());
  });

  it('leaves Escape to an open popover rather than exiting the Booth', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await openMicPopover(user);
    await screen.findByRole('combobox', { name: 'Microphone' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BoothSession companion mode (booth-mode-and-companion-panel.prd.md Phase 7; entered from the Booth header)', () => {
  it('Companion shows CompanionShell and narrows the window; Full app keeps the running session and brings the Booth back', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const companionModeEnter = vi.fn(async () => {});
    const companionModeExit = vi.fn(async () => {});
    const { setState } = renderDialog({ teleprompterStop, companionModeEnter, companionModeExit });
    setState({ phase: 'running', chapter: CHAPTER.id });
    await user.click(await screen.findByRole('button', { name: 'Companion' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Companion' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Booth commands' })).toBeNull();
    await waitFor(() => expect(companionModeEnter).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Full app' }));

    expect(await screen.findByRole('region', { name: 'Booth commands' })).toBeTruthy();
    expect(companionModeExit).toHaveBeenCalledTimes(1);
    expect(teleprompterStop).not.toHaveBeenCalled();
  });
});

describe('BoothSession speaker rail (booth-mode-and-companion-panel.prd.md Phase 3)', () => {
  it("lists the chapter's characters in the booth rail and opens one in the Story bible tab", async () => {
    const user = userEvent.setup();
    renderDialog({ manuscriptParagraphs: async () => PARAGRAPHS }, vi.fn(), { entities: [HALE], notes: [NOTE] });
    const voices = await screen.findByRole('region', { name: 'Voices in scene' });
    await user.click(await within(voices).findByRole('button', { name: 'Mr. Hale: open in the Story bible' }));
    const panel = screen.getByRole('complementary', { name: 'Reading panel' });
    expect(within(panel).getByRole('tab', { name: 'Story bible', selected: true })).toBeTruthy();
    expect(within(panel).getByRole('heading', { name: 'Mr. Hale' })).toBeTruthy();
  });

  it("lets the reading panel fill the booth rail's own column instead of its normal fixed width, which overflowed it", async () => {
    renderDialog();
    const panel = await screen.findByRole('complementary', { name: 'Reading panel' });
    expect(panel.className).not.toContain('md:w-[19rem]');
  });
});
