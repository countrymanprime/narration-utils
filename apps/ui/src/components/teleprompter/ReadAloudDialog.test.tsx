// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudDialog } from './ReadAloudDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, NarrationApi, TeleprompterEvent, TeleprompterState } from '../../types';
import { RAIL_STORAGE_KEY } from './readerPreferences';

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const CHAPTER = { id: 'chapter-1', title: 'Chapter 1', subtitle: 'Down the Rabbit-Hole' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderDialog(overrides: Partial<NarrationApi> = {}, onClose = vi.fn(), content: { entities?: GuideEntity[]; notes?: ManuscriptNote[] } = {}) {
  const eventListeners = new Set<(event: TeleprompterEvent) => void>();
  const stateListeners = new Set<(state: TeleprompterState) => void>();
  const api = createMockApi({
    subscribeTeleprompterEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    subscribeTeleprompterState: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    ...overrides,
  });
  render(
    <ApiProvider api={api}>
      <ReadAloudDialog chapter={CHAPTER} entities={content.entities} notes={content.notes} onClose={onClose} />
    </ApiProvider>,
  );
  return {
    api,
    onClose,
    emit: (event: TeleprompterEvent) => act(() => eventListeners.forEach((listener) => listener(event))),
    setState: (state: Partial<TeleprompterState>) =>
      act(() =>
        stateListeners.forEach((listener) => listener({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null, ...state })),
      ),
  };
}

async function openMicPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Microphone:/ }));
}

describe('ReadAloudDialog', () => {
  it('opens as a full-size dialog titled with the chapter, with no chapter picker (the chapter is fixed)', async () => {
    const user = userEvent.setup();
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: /Read aloud.*Chapter 1/ });
    expect(dialog).toBeTruthy();
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

  it('closes without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('button', { name: /^Microphone:/ });
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for confirmation before closing a live session, and stops it on confirm', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Close' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and close' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // The PRD's Open Questions, "Closing the modal during a live session": Escape must not silently stop a live
  // session. `Dialog` routes Escape through the same `onClose` the header Close button uses (`dismiss = escapeCloses ?
  // (onClose ?? onEscape) : undefined`, primitives/Dialog.tsx), and `ReadAloudDialog` passes `requestClose` (which
  // confirms first when active) as that `onClose` - so Escape and the Close button are one code path, not two.
  it('Escape asks for confirmation before closing a live session too, the same as the Close button', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.keyboard('{Escape}');

    const confirm = await screen.findByRole('alertdialog', { name: 'Stop reading?' });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Stop and close' }));

    expect(teleprompterStop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes without a confirm when no session is running', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('button', { name: /^Microphone:/ });
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('cancelling the close confirm leaves the session running and the dialog open', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { onClose, setState } = renderDialog({ teleprompterStop });
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Close' }));
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

describe('ReadAloudDialog story bible and note marks (teleprompter-manuscript-integration.prd.md Phase 5)', () => {
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
    expect(within(rail).queryByRole('button', { name: 'Go to line in Manuscript' })).toBeNull();
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
    const body = screen.getByRole('dialog').querySelector<HTMLElement>('[tabindex="0"]')!;
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

describe('ReadAloudDialog flags (teleprompter-manuscript-integration.prd.md Phase 7)', () => {
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
    expect(within(detail).getByRole('button', { name: 'Punch from here' }).hasAttribute('disabled')).toBe(true);
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

  it('keeps the flags when the dialog is closed and when a flag is dismissed after the session', async () => {
    const user = userEvent.setup();
    const teleprompterSaveFlags = vi.fn().mockResolvedValue([]);
    const { setState, onClose } = await renderListening({ teleprompterSaveFlags });
    setState({ phase: 'stopped', chapter: 'chapter-1' });
    await waitFor(() => expect(teleprompterSaveFlags).toHaveBeenCalledTimes(1));

    await user.click(await findMark('Skipped'));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(teleprompterSaveFlags).toHaveBeenCalledTimes(2));
    expect(teleprompterSaveFlags.mock.calls[1][1][0]).toMatchObject({ kind: 'skipped', dismissed: true });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(teleprompterSaveFlags).toHaveBeenCalledTimes(3);
    expect(onClose).toHaveBeenCalled();
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
