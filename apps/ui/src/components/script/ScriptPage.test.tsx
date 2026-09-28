// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptPage } from './ScriptPage';
import { saveCreditsExpanded } from '../manuscript/creditsExpandedStorage';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WireError } from '../../api/wire/WireError';
import { SEARCH_DEBOUNCE_MS } from '../../hooks/useDebouncedValue';
import { CommandRouter } from '../../input/router';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
});

function renderScript(
  overrides: Parameters<typeof createMockApi>[0] = {},
  focusStoryBibleEntity = vi.fn(),
  initialEntries = ['/script'],
  initial: Parameters<typeof createMockApi>[1] = {},
  goToWorkspace?: (chapterId: string) => void,
  goToBooth = vi.fn(),
) {
  const api = createMockApi(overrides, initial);
  const notify = vi.fn();
  render(
    <div className="shell-content">
      <MemoryRouter initialEntries={initialEntries}>
        <ApiProvider api={api}>
          <CommandRouter>
            <ScriptPage
              notify={notify}
              focusStoryBibleEntity={focusStoryBibleEntity}
              goToWorkspace={goToWorkspace}
              projectFolder="/projects/alice"
              goToBooth={goToBooth}
            />
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>
    </div>,
  );
  return { api, focusStoryBibleEntity, notify, goToBooth };
}

// A reference chapter (Contents) placed before the narration chapters, the shape Phase 5 hides
// from the continuous reader (R13) - mirrors ChapterNav.test.tsx's fixture, plus paragraphIds so a
// "#p" deep link can resolve into it.
const referenceChapter = {
  id: 'contents',
  title: 'Contents',
  index: 0,
  wordCount: 40,
  status: 'not_started' as const,
  contentKind: 'reference' as const,
  paragraphIds: [{ id: 'p-contents-0', index: 900 }],
};

// Finds the text node containing `phrase` and selects exactly that
// substring, then fires the mouseup the app listens for - simulating a real
// browser text selection rather than clicking an invented "+" button, since
// that's the actual interaction the Manuscript page exposes.
// The reader's own text: the chapter list and the rail beside it name chapters and characters too ("Alice's Evidence").
const readerText = () => document.querySelector<HTMLElement>('.reader-chapters') ?? document.body;

function selectPhrase(phrase: string) {
  const walker = document.createTreeWalker(readerText(), NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const index = node.textContent?.indexOf(phrase) ?? -1;
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + phrase.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      fireEvent.mouseUp(node.parentElement!);
      return;
    }
  }
  throw new Error(`Could not find text node containing "${phrase}"`);
}

function paragraph(index: number) {
  const value = document.querySelector<HTMLElement>(`[data-paragraph="${index}"] p`);
  if (!value) throw new Error(`Paragraph ${index} was not rendered`);
  return value;
}

describe('Script page (integration, driven through the mock NarrationApi)', () => {
  it('loads the first chapter and highlights Story Bible entities inline', async () => {
    renderScript();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());
    await waitFor(() => expect(paragraph(0)).toBeTruthy());
    const highlighted = await waitFor(() => {
      const match = screen.getAllByText('Alice').find((el) => el.tagName === 'MARK');
      if (!match) throw new Error('highlighted "Alice" mark not rendered yet');
      return match;
    });
    expect(highlighted.getAttribute('data-highlight')).toBe('Character');
    expect(document.querySelector('[data-highlight="Note"]')).toBeTruthy();
    expect(document.querySelector('[data-paragraph="0"] .source-line-number')?.textContent).toBe('1');
    expect(document.querySelector('[data-paragraph="0"]')?.getAttribute('data-source-line')).toBeTruthy();
  });

  it('selecting text within one line offers + Note and + Story Bible, and adding a note attaches it to that line', async () => {
    const { api } = renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(paragraph(0)).toBeTruthy());

    selectPhrase('very tired');
    expect(await screen.findByRole('button', { name: '+ Note' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Story Bible' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    expect(await screen.findByText('Note for: "very tired"')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Underplay the bravado here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(async () =>
      expect((await api.noteList()).some((note) => note.text === 'Underplay the bravado here.' && note.anchorText === 'very tired')).toBe(true),
    );
  });

  describe('script markup (prep-depth PRD Phase 5)', () => {
    it('marks up a selection: the mark is saved on that line and drawn on it', async () => {
      const { api, notify } = renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(paragraph(0)).toBeTruthy());

      selectPhrase('very tired');
      fireEvent.click(await screen.findByRole('button', { name: 'Mark up' }));
      expect(await screen.findByText('Mark up: “very tired”')).toBeTruthy();
      fireEvent.click(screen.getByRole('radio', { name: /Pause/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Add mark' }));

      const chapterId = (await api.manuscriptChapters())[0].id;
      await waitFor(async () =>
        expect((await api.prepMarkupList(chapterId)).spans).toMatchObject([{ anchorText: 'very tired', kind: 'pause', value: 'long' }]),
      );
      await waitFor(() => expect(document.querySelector('[data-markup="pause"]')?.textContent).toBe('very tired'));
      expect(notify).toHaveBeenCalledWith('Mark added.');
    });

    it('shows the marks already placed, says where the text changed, and removes a stale one', async () => {
      const { api, notify } = renderScript({}, vi.fn(), ['/script'], {
        prepMarkup: [
          { chapter: 0, line: 0, words: 'Alice', kind: 'stress' },
          { chapter: 0, line: 0, words: 'tired', kind: 'stress', stale: { reason: 'text_changed', was: 'weary' } },
        ],
      });
      await waitFor(() => expect(document.querySelector('[data-markup="stress"]')?.textContent).toBe('Alice'));
      const notice = await screen.findByRole('note');
      expect(notice.textContent).toContain('“weary”');

      fireEvent.click(within(notice).getByRole('button', { name: 'Remove the stress mark on “weary”' }));
      const chapterId = (await api.manuscriptChapters())[0].id;
      await waitFor(async () => expect((await api.prepMarkupList(chapterId)).spans).toHaveLength(1));
      await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
      expect(notify).toHaveBeenCalledWith('Mark removed.');
    });

    it('a reader with no markup file still reads (the list failing is said once, not a load error)', async () => {
      const { notify } = renderScript({ prepMarkupList: async () => Promise.reject(new Error('your script markup file could not be read')) });
      await waitFor(() => expect(paragraph(0)).toBeTruthy());
      await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('script markup'), 'error'));
    });
  });

  it('sending a selection to the Story Bible creates a draft entity and hands off to the Story Bible page', async () => {
    const { focusStoryBibleEntity } = renderScript({ guideCreate: async () => 'new-halcyon' });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(paragraph(0)).toBeTruthy());

    selectPhrase('Alice');
    fireEvent.click(await screen.findByRole('button', { name: '+ Story Bible' }));

    await waitFor(() => expect(focusStoryBibleEntity).toHaveBeenCalledWith('new-halcyon'));
  });

  describe('Look up', () => {
    const openReader = async (initial: Parameters<typeof createMockApi>[1] = {}, overrides: Parameters<typeof createMockApi>[0] = {}) => {
      const rendered = renderScript(overrides, vi.fn(), ['/script'], initial);
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(paragraph(0)).toBeTruthy());
      return rendered;
    };

    it('is offered for one selected word only', async () => {
      await openReader();
      selectPhrase('very tired');
      await screen.findByRole('button', { name: '+ Note' });
      expect(screen.queryByRole('button', { name: 'Look up' })).toBeNull();
      selectPhrase('bank');
      expect(await screen.findByRole('button', { name: 'Look up' })).toBeTruthy();
    });

    it('opens a panel with the definitions from the offline dictionary and its credit, and clears the selection', async () => {
      await openReader();
      selectPhrase('bank');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      const panel = await screen.findByRole('dialog', { name: 'Look up: bank' });
      expect(within(panel).getByText('sloping land (especially the slope beside a body of water)')).toBeTruthy();
      expect(within(panel).getByText(/Open English WordNet 2025 Edition/)).toBeTruthy();
      expect(screen.queryByRole('toolbar', { name: 'Selected manuscript text actions' })).toBeNull();
    });

    it('says plainly when the dictionary does not have the word', async () => {
      await openReader();
      selectPhrase('Alice');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      const panel = await screen.findByRole('dialog', { name: 'Look up: alice' });
      expect(within(panel).getByText('“alice” is not in the dictionary.')).toBeTruthy();
    });

    it('asks before downloading a dictionary that is not installed, and answers the lookup once it is', async () => {
      const { api } = await openReader({ dictionary: 'missing' });
      const assetsInstall = vi.spyOn(api, 'assetsInstall');
      selectPhrase('bank');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      const question = await screen.findByRole('alertdialog', { name: 'Download the dictionary?' });
      expect(within(question).getByText(/Open English WordNet 2025/)).toBeTruthy();
      expect(within(question).getByText('10 MB · The Open English WordNet Team')).toBeTruthy();
      expect(assetsInstall).not.toHaveBeenCalled();
      fireEvent.click(within(question).getByRole('button', { name: 'Download dictionary' }));
      expect(assetsInstall).toHaveBeenCalledWith('dictionary', 'oewn-2025');
      const panel = await screen.findByRole('dialog', { name: 'Look up: bank' }, { timeout: 5000 });
      expect(within(panel).getByText('sloping land (especially the slope beside a body of water)')).toBeTruthy();
    });

    it('downloads nothing when the narrator says no', async () => {
      const { api } = await openReader({ dictionary: 'missing' });
      const assetsInstall = vi.spyOn(api, 'assetsInstall');
      selectPhrase('bank');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      const question = await screen.findByRole('alertdialog', { name: 'Download the dictionary?' });
      fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(assetsInstall).not.toHaveBeenCalled();
    });

    it('says a damaged dictionary is damaged and offers to download it again', async () => {
      await openReader({ dictionary: 'damaged' });
      selectPhrase('bank');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      const question = await screen.findByRole('alertdialog', { name: 'Repair the dictionary?' });
      expect(within(question).getByText(/damaged/)).toBeTruthy();
      expect(within(question).getByRole('button', { name: 'Download again' })).toBeTruthy();
    });

    it('shows a failed lookup and keeps the selection', async () => {
      const { notify } = await openReader({}, { systemLookup: () => Promise.reject(new Error('select a single word to look it up')) });
      selectPhrase('bank');
      fireEvent.click(await screen.findByRole('button', { name: 'Look up' }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('select a single word to look it up'), 'error'));
      expect(screen.getByRole('toolbar', { name: 'Selected manuscript text actions' })).toBeTruthy();
    });
  });

  it('allows a selection spanning two adjacent lines', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(paragraph(1)).toBeTruthy());

    const textLeaf = (element: Element, atEnd = false) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const leaves: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) leaves.push(node as Text);
      return atEnd ? leaves.at(-1)! : leaves[0];
    };
    const first = textLeaf(paragraph(0), true);
    const second = textLeaf(paragraph(1));
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, Math.min(10, second.textContent!.length));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(first.parentElement!);

    expect(await screen.findByRole('button', { name: '+ Note' })).toBeTruthy();
  });

  it('keeps the selection menu open for a multi-line selection, but validates when adding a note', async () => {
    const { notify } = renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(paragraph(0)).toBeTruthy());

    const first = paragraph(0).querySelector('mark')!.nextSibling as Text;
    const last = paragraph(1).firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(first.parentElement!);

    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    expect(notify).toHaveBeenCalledWith('Select text within a single line to add a note.');
  });

  it('opens an existing note with the note headers and a delete button (not a bookmark toggle)', async () => {
    const { api } = renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(document.querySelector('[data-highlight="Note"]')).toBeTruthy());
    const [existingNote] = await api.noteList();

    fireEvent.click(document.querySelector('[data-highlight="Note"]')!);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Note' })).toBeTruthy());
    expect(screen.getByText('Anchored text')).toBeTruthy();
    expect(screen.getByText('Note', { selector: '.section-label' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Toggle bookmark/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await waitFor(async () => expect(await api.noteList()).not.toContainEqual(expect.objectContaining({ id: existingNote.id })));
  });

  describe('the chapter list and the prep rail (stage navigation Phase 3, mock 02)', () => {
    it('opens a chapter from the chapter list and marks it as the one being read', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const list = screen.getByRole('navigation', { name: 'Chapters' });
      fireEvent.click(within(list).getByRole('button', { name: /The Pool of Tears/ }));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 2 — The Pool of Tears' })).toBeTruthy());
      await waitFor(() =>
        expect(
          within(list)
            .getByRole('button', { name: /The Pool of Tears/ })
            .getAttribute('aria-current'),
        ).toBe('true'),
      );
    });

    it("shows each chapter's names still to confirm, and the rail's queries open the Story Bible's queries panel", async () => {
      renderScript();
      const list = await screen.findByRole('navigation', { name: 'Chapters' });
      // The demo Story Bible's pronunciations are all "researched", so every name with a first line has a query open.
      await waitFor(() => expect(within(list).getAllByText(/to confirm$/).length).toBeGreaterThan(0));
      const rail = screen.getByRole('complementary', { name: 'Prep' });
      fireEvent.click(await within(rail).findByRole('tab', { name: /^Queries · \d+$/ }));
      fireEvent.click(within(rail).getByRole('button', { name: 'Manage queries' }));
      expect(await screen.findByRole('dialog', { name: 'Pronunciation queries' })).toBeTruthy();
    });

    it("opens a name's Story Bible summary from the rail", async () => {
      const { focusStoryBibleEntity } = renderScript();
      const rail = await screen.findByRole('complementary', { name: 'Prep' });
      fireEvent.click(await within(rail).findByRole('button', { name: 'White Rabbit' }));
      const panel = await screen.findByRole('dialog', { name: 'White Rabbit' });
      fireEvent.click(within(panel).getByRole('button', { name: /Open in Story Bible/ }));
      expect(focusStoryBibleEntity).toHaveBeenCalledWith('white-rabbit');
    });

    it('opens the rail as a panel from the band, for widths where it is not a column', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      fireEvent.click(screen.getByRole('button', { name: 'Prep rail' }));
      const panel = await screen.findByRole('dialog', { name: 'Prep' });
      expect(within(panel).getByRole('tablist', { name: 'Prep' })).toBeTruthy();
    });
  });

  it('switches chapters from the Chapters & Search overlay', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));

    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Chapter 2/ })).at(-1)!);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 2 — The Pool of Tears' })).toBeTruthy());
  });

  it('uses only manual chapter expansion controls', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    expect(screen.queryByText('Auto-focus chapters')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Collapse all/ }));
    await waitFor(() => expect(document.querySelector('[data-paragraph="0"]')).toBeNull());

    fireEvent.click(within(readerText()).getByRole('button', { name: /Chapter 2 — The Pool of Tears/ }));
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 2"] .manuscript-reader')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Expand all/ }));
    await waitFor(() => expect(document.querySelector('[data-paragraph="0"]')).toBeTruthy());
  });

  it('uses outline/fill chapter bookmarks and has no per-paragraph bookmark gutter', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    expect(document.querySelector('[data-chapter="Chapter 1"] button.group svg')).toBeTruthy();
    expect(document.querySelectorAll('[data-chapter="Chapter 1"] button.group svg')).toHaveLength(2);
    expect(document.querySelector('.ms-marker-gutter')).toBeNull();
    expect(document.querySelector('.paragraph-bookmark')).toBeNull();
    expect(document.querySelector('.marker-count')).toBeNull();
  });

  it('names each chapter bookmark toggle, since its icons say nothing to a screen reader (axe: button-name)', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    const toggle = document.querySelector<HTMLElement>('[data-chapter="Chapter 1"] button.group')!;
    expect(toggle.getAttribute('aria-label')).toBe('Bookmark this chapter');
    fireEvent.click(toggle);
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 1"] button.group')!.getAttribute('aria-label')).toBe('Remove chapter bookmark'));
  });

  it('filters chapters and nests matching search results beneath them', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search Script');
    fireEvent.change(input, { target: { value: 'Rabbit' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // fires the search immediately, bypassing the debounce (R1)

    const [result] = await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });
    expect(within(document.querySelector('[data-slide-over]')!).queryByRole('button', { name: /Chapter 3/ })).toBeNull();
    fireEvent.click(result);
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 1"] .manuscript-reader')).toBeTruthy());
  });

  it('keeps only the latest asynchronous search response', async () => {
    let resolveOld: (results: Array<{ chapter: string; paragraph: number; sourceLine: number; excerpt: string }>) => void = () => {};
    renderScript({
      manuscriptSearch: async (query) =>
        query === 'old'
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : [{ chapter: 'Chapter 2', paragraph: 4, sourceLine: 200, excerpt: 'new result' }],
    });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search Script');
    // Each Enter fires immediately (R1), simulating two real requests racing - the debounce itself
    // (see the dedicated debounce test below) would collapse two edits this close together into one.
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByLabelText(/Search result in Chapter 2/);
    resolveOld([{ chapter: 'Chapter 1', paragraph: 0, sourceLine: 10, excerpt: 'old result' }]);
    await waitFor(() => expect(screen.queryByLabelText(/Search result in Chapter 1/)).toBeNull());
  });

  it('debounces the line search 2s behind the last keystroke; chapter-title matches show at once and Enter fires immediately (R1, R2)', async () => {
    const searchSpy = vi.fn(async () => []);
    renderScript({ manuscriptSearch: searchSpy });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search Script');

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'Pool of Tears' } });

    // The chapter-title/subtitle subset is client-side and never debounced (R2).
    expect(screen.getAllByRole('button', { name: /Chapter 2/ }).length).toBeGreaterThan(0);
    expect(searchSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Searching…')).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1));
    expect(searchSpy).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('Pool of Tears');
  });

  it('does not repeat the search 2s after Enter already fetched it (code review: the debounce catching up must not re-fire)', async () => {
    const searchSpy = vi.fn(async () => []);
    renderScript({ manuscriptSearch: searchSpy });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search Script');

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'Rabbit' } });
    await act(() => vi.advanceTimersByTimeAsync(0)); // let the Enter-triggered fetch's promise settle
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(searchSpy).toHaveBeenCalledTimes(1);

    // The debounce hook's own timer, still armed from the keystroke, now catches up to the same
    // already-settled query - it must not fire fetchSearch a second time for it.
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the query and results when a search result is selected (R8)', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.change(screen.getByLabelText('Search Script'), { target: { value: 'Rabbit' } });
    const [result] = await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });
    fireEvent.click(result);

    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    expect((screen.getByLabelText('Search Script') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: /Search result in/ })).toBeNull();
  });

  it('Escape clears an in-progress search before it closes the panel (R8)', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.change(screen.getByLabelText('Search Script'), { target: { value: 'Rabbit' } });
    await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });

    // Fired on the focused input itself (not window directly) so it bubbles through Base UI's own
    // document-level Escape listener exactly as a real keypress would - dispatching straight on
    // window would skip that listener entirely and prove nothing about production behavior.
    const input = screen.getByLabelText('Search Script');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((screen.getByLabelText('Search Script') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('[data-slide-over]')).toBeTruthy();

    fireEvent.keyDown(screen.getByLabelText('Search Script'), { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-slide-over]')).toBeNull());
  });

  it('autofocuses the search input when the Chapters & Search panel opens (R8)', async () => {
    renderScript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search Script')));
  });

  describe('when the data it loads cannot be read (ADR 0069)', () => {
    const unreadable = () =>
      new WireError('host.binding', 'ManuscriptChapters', [{ path: '[0].index', message: 'Invalid input: expected number, received string' }]);

    it('shows an inline error with Retry, in plain words and without the technical text', async () => {
      renderScript({ manuscriptChapters: () => Promise.reject(unreadable()) });
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The app received data it could not read.');
      expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy();
      expect(document.body.textContent).not.toContain('index');
    });

    it('loads the page when Retry succeeds', async () => {
      const real = createMockApi();
      const chapters = vi
        .fn()
        .mockRejectedValueOnce(unreadable())
        .mockImplementation(() => real.manuscriptChapters());
      renderScript({ manuscriptChapters: chapters });
      fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(await screen.findByRole('button', { name: 'Text size' })).toBeTruthy();
      expect(chapters).toHaveBeenCalledTimes(2);
    });
  });

  describe('hides reference material from the continuous reader (R13, Phase 5)', () => {
    it('opens on the first recorded chapter even when a reference chapter sorts first', async () => {
      renderScript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });

    it('falls back to expanded, not collapsed, when a reader state saved before this phase points at a hidden chapter', async () => {
      // No expandedChapters saved (the shape a pre-Phase-5 project's reader state can be in) - the
      // default used to be [state.activeChapter], which would have resolved to the now-filtered-out
      // 'contents' id and left the fallback chapter's header rendered but its body collapsed.
      renderScript({
        manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())],
        readerState: async () => ({ activeChapter: 'contents', bookmarks: [] }),
      });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(paragraph(0)).toBeTruthy());
    });

    it('never renders a reference chapter as an article in the page-flip view', async () => {
      renderScript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(screen.queryByText('Contents')).toBeNull();
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });

    it('Expand all chapters never requests paragraphs for a reference chapter', async () => {
      const paragraphsSpy = vi.fn(async () => []);
      renderScript({
        manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())],
        manuscriptParagraphs: paragraphsSpy,
      });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      fireEvent.click(screen.getByRole('button', { name: 'Expand all chapters' }));
      await waitFor(() => expect(paragraphsSpy).toHaveBeenCalled());
      expect(paragraphsSpy).not.toHaveBeenCalledWith('contents');
    });

    it('a "#p" deep link into a hidden paragraph tells the narrator instead of navigating there', async () => {
      const { notify } = renderScript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] }, vi.fn(), [
        '/script#p900',
      ]);
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('reference material')));
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });
  });

  describe('credits pseudo-entries (PRD audiobook-credits-templates.prd.md, Phase 3)', () => {
    it('shows an Opening credits entry before the first chapter and a Closing credits entry after the last, both open by default (MC5)', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 12 — Alice’s Evidence' }));

      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]')!;
      const closing = screen.getByRole('heading', { name: 'Closing credits' }).closest('[data-credits-entry]')!;
      const reader = document.querySelector('.reader-chapters')!;
      const order = [...reader.children].map((el) => el.getAttribute('data-credits-entry') || el.getAttribute('data-chapter'));
      expect(order[0]).toBe('opening');
      expect(order.at(-1)).toBe('closing');

      // Open by default (MC5): the rendered preview and its unresolved-token count already show, with no click needed.
      expect(await within(opening as HTMLElement).findByText(/unresolved token/)).toBeTruthy();
      expect(within(closing as HTMLElement).queryByText(/unresolved token/)).toBeTruthy();
    });

    it('shows an unresolved-token chip, never silent empty text (C6)', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]') as HTMLElement;

      // The mock's default project has no Title/Author/Narrator value set, so the shipped opening template's
      // tokens are all unresolved - each renders as its own bracketed chip rather than empty text.
      expect(await within(opening).findByText('[Title]')).toBeTruthy();
      expect(within(opening).getByText('[Author]')).toBeTruthy();
      expect(within(opening).getByText('[Narrator]')).toBeTruthy();
      expect(within(opening).getByText(/3 unresolved tokens: Title, Author, Narrator/)).toBeTruthy();
    });

    it('collapsing a credits card hides its preview, and remembers that per project across a reload (MC5 b)', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const opening = () => screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]') as HTMLElement;
      await within(opening()).findByText('[Title]');

      fireEvent.click(screen.getByRole('button', { name: 'Opening credits' }));
      await waitFor(() => expect(within(opening()).queryByText('[Title]')).toBeNull());
      cleanup();

      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(screen.getByRole('button', { name: 'Opening credits' }).getAttribute('aria-expanded')).toBe('false');
      expect(within(opening()).queryByText('[Title]')).toBeNull();
    });

    it('Expand all and Collapse all include the credits cards, and never send a credits id to readerStateSave or manuscriptParagraphs', async () => {
      const saveStateSpy = vi.fn(async () => ({ expandedChapters: [], bookmarks: [] }));
      const paragraphsSpy = vi.fn(async () => []);
      renderScript({ readerStateSave: saveStateSpy, manuscriptParagraphs: paragraphsSpy });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));

      fireEvent.click(screen.getByRole('button', { name: 'Collapse all chapters' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Opening credits' }).getAttribute('aria-expanded')).toBe('false'));
      expect(screen.getByRole('button', { name: 'Closing credits' }).getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(screen.getByRole('button', { name: 'Expand all chapters' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Opening credits' }).getAttribute('aria-expanded')).toBe('true'));
      expect(screen.getByRole('button', { name: 'Closing credits' }).getAttribute('aria-expanded')).toBe('true');

      for (const call of [...saveStateSpy.mock.calls, ...paragraphsSpy.mock.calls]) {
        expect(JSON.stringify(call)).not.toMatch(/opening|closing/);
      }
    });

    it('a credits entry is not a chapter: it is absent from Chapters & Search and never counted in the chapter list', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
      const chaptersPanel = await screen.findByText('Chapters');
      const nav = chaptersPanel.closest('div')!.parentElement!;
      expect(within(nav as HTMLElement).queryByText('Opening credits')).toBeNull();
      expect(within(nav as HTMLElement).queryByText('Closing credits')).toBeNull();
    });

    it('renders no credits entries when the template library has no opening or closing template', async () => {
      renderScript({ creditsTemplates: async () => [] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(screen.queryByRole('heading', { name: 'Opening credits' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Closing credits' })).toBeNull();
    });

    it('a "#credits-opening"/"#credits-closing" deep link (Home\'s credits rows, credits-in-chapter-table.prd.md Phase 2, CT7) opens the matching entry', async () => {
      // Both cards open by default (MC5), so start them collapsed: the hash alone must open the closing one.
      saveCreditsExpanded('/projects/alice', { opening: false, closing: false });
      renderScript({}, vi.fn(), ['/script#credits-closing']);
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      // Collapsed entries show no unresolved-token count (asserted above); the closing entry opening on its own,
      // with the opening entry left collapsed, proves the hash targeted the right one.
      await waitFor(() => expect(screen.getByText(/3 unresolved tokens: Title, Author, Narrator/)).toBeTruthy());
      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]')!;
      expect(within(opening as HTMLElement).queryByText(/unresolved token/)).toBeNull();
    });
  });

  describe('the credits-setup banner and Fill in (credits-token-setup-and-front-matter-detection.prd.md, Phase 3)', () => {
    it('shows the banner above the credits cards while setup is not dismissed at the project scope', async () => {
      renderScript({}, vi.fn(), ['/script'], { creditsSetup: true });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const banner = await screen.findByText(/The credits need 3 values/);
      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]')!;
      // The banner sits before the opening credits card in source order (mockups/.../03-manuscript-banner-and-fill-in.webp).
      expect(banner.compareDocumentPosition(opening) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('no banner on the default mock boot, even though the default project has unresolved tokens (already dismissed at the project scope)', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(screen.getAllByText(/3 unresolved tokens: Title, Author, Narrator/).length).toBeGreaterThan(0));
      expect(screen.queryByText(/The credits need/)).toBeNull();
    });

    it('Fill in on the credits card opens the setup dialog, prefilled from the same detected candidates as Home', async () => {
      renderScript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]') as HTMLElement;
      await within(opening).findByText(/unresolved token/);
      fireEvent.click(within(opening).getByRole('button', { name: 'Fill in' }));
      expect(await screen.findByRole('dialog', { name: 'Set up the credits' })).toBeTruthy();
    });

    it('Fill in on the banner opens the same dialog and the banner steps aside while it is open', async () => {
      renderScript({}, vi.fn(), ['/script'], { creditsSetup: true });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const banner = (await screen.findByText(/The credits need 3 values/)).closest('section') as HTMLElement;
      fireEvent.click(within(banner).getByRole('button', { name: 'Fill in' }));
      expect(await screen.findByRole('dialog', { name: 'Set up the credits' })).toBeTruthy();
      expect(screen.queryByText(/The credits need 3 values/)).toBeNull();
    });

    it('Save in the dialog opened from Manuscript resolves the credits card, closing the dialog', async () => {
      renderScript({}, vi.fn(), ['/script'], { creditsSetup: true });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      const banner = (await screen.findByText(/The credits need 3 values/)).closest('section') as HTMLElement;
      fireEvent.click(within(banner).getByRole('button', { name: 'Fill in' }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Set up the credits' }));
      fireEvent.change(dialog.getByLabelText('Narrator'), { target: { value: 'Ada Finch' } });
      fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set up the credits' })).toBeNull());
    });
  });

  describe('retail sample marker (PRD audiobook-credits-templates.prd.md, Phase 5, C10)', () => {
    const sampleOnChapterTwo = async () => {
      const chapter = (await createMockApi().manuscriptChapters())[1];
      const ids = chapter.paragraphIds ?? [];
      return {
        chapter,
        answer: {
          sample: {
            startParagraphId: ids[1].id,
            endParagraphId: ids[2].id,
            startChapterId: chapter.id,
            startLine: 2,
            endChapterId: chapter.id,
            endLine: 3,
            words: 60,
            seconds: 23.2,
          },
          problem: '',
        },
      };
    };

    it('marks the chapter that holds the sample and, once it is open, exactly the sampled lines', async () => {
      const { chapter, answer } = await sampleOnChapterTwo();
      renderScript({ creditsRetailSample: async () => answer });
      const heading = await screen.findByRole('heading', { name: /Chapter 2/ });
      const article = heading.closest('article')!;
      expect(await within(article).findByText('Retail sample')).toBeTruthy();
      expect(within(screen.getByRole('heading', { name: /Chapter 1 —/ }).closest('article')!).queryByText('Retail sample')).toBeNull();

      fireEvent.click(heading);
      await waitFor(() => expect(article.querySelectorAll('[data-retail-sample]').length).toBe(2));
      const marked = [...article.querySelectorAll('[data-retail-sample]')].map((row) => Number(row.getAttribute('data-paragraph')));
      expect(marked).toEqual([chapter.paragraphIds![1].index, chapter.paragraphIds![2].index]);
      expect(within(article).getByText(/Retail sample starts · about 0m 23s/)).toBeTruthy();
    });

    it('marks nothing when no sample is picked or the saved one cannot be measured', async () => {
      renderScript({ creditsRetailSample: async () => ({ sample: null, problem: 'pick the range again' }) });
      await screen.findByRole('heading', { name: /Chapter 2/ });
      expect(screen.queryByText('Retail sample')).toBeNull();
    });
  });

  describe('Open workspace (edit-and-proof-workspace.prd.md Phase 4)', () => {
    it('opens the chapter workspace for a narration chapter', async () => {
      const goToWorkspace = vi.fn();
      renderScript({}, vi.fn(), ['/script'], {}, goToWorkspace);
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: 'Open in Proof for Chapter 1' }));

      expect(goToWorkspace).toHaveBeenCalledWith('chapter-1');
    });

    it('renders no Workspace entry when the caller has none to open', async () => {
      renderScript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());
      expect(screen.queryByRole('button', { name: /Open in Proof for/ })).toBeNull();
    });
  });

  // stage-navigation-and-page-replacement.prd.md Phase 4 (Q9): the cards' Read aloud, Booth and Companion buttons became one
  // "Record in Booth" link to the Booth page; the Read aloud dialog is gone (ADR 0407).
  describe('Record in Booth', () => {
    it('opens the Booth on a narration chapter, with no dialog of its own', async () => {
      const { goToBooth } = renderScript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: 'Record Chapter 1 in Booth' }));

      expect(goToBooth).toHaveBeenCalledWith({ chapter: 'chapter-1' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: /aloud|Open booth|Open companion/ })).toBeNull();
    });

    it('opens the Booth on the opening and the closing credits', async () => {
      const { goToBooth } = renderScript();
      for (const [kind, name] of [
        ['opening', 'Opening credits'],
        ['closing', 'Closing credits'],
      ] as const) {
        const heading = await screen.findByRole('heading', { name });
        const card = heading.closest('[data-credits-entry]') as HTMLElement;
        fireEvent.click(await within(card).findByRole('button', { name: `Record ${name} in Booth` }));
        expect(goToBooth).toHaveBeenLastCalledWith({ credits: kind });
      }
    });

    it('shows no Record in Booth on a credits card with nothing to read (preview.words === 0)', async () => {
      renderScript({ creditsPreview: async () => ({ text: '', words: 0, unresolved: [] }) });
      const openingHeading = await screen.findByRole('heading', { name: 'Opening credits' });
      const opening = openingHeading.closest('[data-credits-entry]') as HTMLElement;
      await within(opening).findByText('Nothing to preview yet.');
      expect(within(opening).queryByRole('button', { name: /in Booth/ })).toBeNull();
    });
  });

  // D85 #3 on issue #509, ADR 0393 (superseding ADR 0392): three columns show at the mock's own 1440px capture width, not
  // just from `2xl` (1536px) - jsdom does not lay out at a real width, so this only pins the class mechanism; the actual
  // rendered layout is checked by the visual suite (script/retail-sample, script/markup-dialog at desktop, 1440px).
  it('introduces the rail column at 1440px, not 2xl', async () => {
    renderScript();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy());
    const grid = document.querySelector('.reader-page')!;
    expect(grid.className).toContain('min-[1440px]:grid-cols-[12rem_minmax(0,1fr)_21.5rem]');
    expect(grid.className).not.toMatch(/(^|\s)2xl:grid-cols-/);
    const rail = screen.getByRole('complementary', { name: 'Prep' });
    expect(rail.className).toContain('min-[1440px]:flex');
    expect(rail.className).not.toMatch(/(^|\s)2xl:flex/);
  });

  // Audit row SC3 (docs/research/visual-mockup-divergence-audit.md): mock 02's "Markup layer" key describes the reader's
  // own script marks, not the Story Bible's category colors.
  describe('the markup layer key (SC3)', () => {
    it('is titled "Markup layer", not "Marks"', async () => {
      renderScript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy());
      expect(screen.getAllByText('Markup layer').length).toBeGreaterThan(0);
      expect(screen.queryByText('Marks')).toBeNull();
    });

    it('names the reader marks mock 02 draws, not the Story Bible categories', async () => {
      renderScript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy());
      // The `xl`+ aside key and the sub-`xl` band key both render the same entries; getAllByText covers either or both.
      for (const text of ['Speaker', 'stress', 'breath ·', 'pause', 'pronunciation', 'author query']) {
        expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
      }
      // The old key (the Story Bible's category colors) is gone: "Location"/"Organization"/"Lore" never named a real
      // reader mark, and this page has no Location/Organization/Lore entities to otherwise put those words on screen.
      expect(screen.queryByText('Location')).toBeNull();
      expect(screen.queryByText('Organization')).toBeNull();
      expect(screen.queryByText('Lore')).toBeNull();
    });
  });
});
