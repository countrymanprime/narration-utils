// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Manuscript } from './Manuscript';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WireError } from '../../api/wire/WireError';
import { SEARCH_DEBOUNCE_MS } from '../../hooks/useDebouncedValue';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderManuscript(overrides: Parameters<typeof createMockApi>[0] = {}, focusStoryBibleEntity = vi.fn(), initialEntries = ['/manuscript']) {
  const api = createMockApi(overrides);
  const notify = vi.fn();
  render(
    <div className="shell-content">
      <MemoryRouter initialEntries={initialEntries}>
        <ApiProvider api={api}>
          <Manuscript notify={notify} focusStoryBibleEntity={focusStoryBibleEntity} />
        </ApiProvider>
      </MemoryRouter>
    </div>,
  );
  return { api, focusStoryBibleEntity, notify };
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
function selectPhrase(phrase: string) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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

describe('Manuscript page (integration, driven through the mock NarrationApi)', () => {
  it('loads the first chapter and highlights Story Bible entities inline', async () => {
    renderManuscript();
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
    const { api } = renderManuscript();
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

  it('sending a selection to the Story Bible creates a draft entity and hands off to the Story Bible page', async () => {
    const { focusStoryBibleEntity } = renderManuscript({ guideCreate: async () => 'new-halcyon' });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(paragraph(0)).toBeTruthy());

    selectPhrase('Alice');
    fireEvent.click(await screen.findByRole('button', { name: '+ Story Bible' }));

    await waitFor(() => expect(focusStoryBibleEntity).toHaveBeenCalledWith('new-halcyon'));
  });

  it('allows a selection spanning two adjacent lines', async () => {
    renderManuscript();
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
    const { notify } = renderManuscript();
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
    const { api } = renderManuscript();
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

  it('switches chapters from the Chapters & Search overlay', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));

    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.click((await screen.findAllByRole('button', { name: /Chapter 2/ })).at(-1)!);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 2 — The Pool of Tears' })).toBeTruthy());
  });

  it('uses only manual chapter expansion controls', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    expect(screen.queryByText('Auto-focus chapters')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Collapse all/ }));
    await waitFor(() => expect(document.querySelector('[data-paragraph="0"]')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Chapter 2 — The Pool of Tears/ }));
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 2"] .manuscript-reader')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Expand all/ }));
    await waitFor(() => expect(document.querySelector('[data-paragraph="0"]')).toBeTruthy());
  });

  it('uses outline/fill chapter bookmarks and has no per-paragraph bookmark gutter', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    expect(document.querySelector('[data-chapter="Chapter 1"] button.group svg')).toBeTruthy();
    expect(document.querySelectorAll('[data-chapter="Chapter 1"] button.group svg')).toHaveLength(2);
    expect(document.querySelector('.ms-marker-gutter')).toBeNull();
    expect(document.querySelector('.paragraph-bookmark')).toBeNull();
    expect(document.querySelector('.marker-count')).toBeNull();
  });

  it('names each chapter bookmark toggle, since its icons say nothing to a screen reader (axe: button-name)', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    const toggle = document.querySelector<HTMLElement>('[data-chapter="Chapter 1"] button.group')!;
    expect(toggle.getAttribute('aria-label')).toBe('Bookmark this chapter');
    fireEvent.click(toggle);
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 1"] button.group')!.getAttribute('aria-label')).toBe('Remove chapter bookmark'));
  });

  it('filters chapters and nests matching search results beneath them', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search manuscript');
    fireEvent.change(input, { target: { value: 'Rabbit' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // fires the search immediately, bypassing the debounce (R1)

    const [result] = await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });
    expect(within(document.querySelector('[data-slide-over]')!).queryByRole('button', { name: /Chapter 3/ })).toBeNull();
    fireEvent.click(result);
    await waitFor(() => expect(document.querySelector('[data-chapter="Chapter 1"] .manuscript-reader')).toBeTruthy());
  });

  it('keeps only the latest asynchronous search response', async () => {
    let resolveOld: (results: Array<{ chapter: string; paragraph: number; sourceLine: number; excerpt: string }>) => void = () => {};
    renderManuscript({
      manuscriptSearch: async (query) =>
        query === 'old'
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : [{ chapter: 'Chapter 2', paragraph: 4, sourceLine: 200, excerpt: 'new result' }],
    });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search manuscript');
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
    renderManuscript({ manuscriptSearch: searchSpy });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search manuscript');

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
    renderManuscript({ manuscriptSearch: searchSpy });
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    const input = screen.getByLabelText('Search manuscript');

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
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.change(screen.getByLabelText('Search manuscript'), { target: { value: 'Rabbit' } });
    const [result] = await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });
    fireEvent.click(result);

    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    expect((screen.getByLabelText('Search manuscript') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: /Search result in/ })).toBeNull();
  });

  it('Escape clears an in-progress search before it closes the panel (R8)', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.change(screen.getByLabelText('Search manuscript'), { target: { value: 'Rabbit' } });
    await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });

    // Fired on the focused input itself (not window directly) so it bubbles through Base UI's own
    // document-level Escape listener exactly as a real keypress would - dispatching straight on
    // window would skip that listener entirely and prove nothing about production behavior.
    const input = screen.getByLabelText('Search manuscript');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((screen.getByLabelText('Search manuscript') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('[data-slide-over]')).toBeTruthy();

    fireEvent.keyDown(screen.getByLabelText('Search manuscript'), { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-slide-over]')).toBeNull());
  });

  it('autofocuses the search input when the Chapters & Search panel opens (R8)', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search manuscript')));
  });

  describe('when the data it loads cannot be read (ADR 0069)', () => {
    const unreadable = () =>
      new WireError('host.binding', 'ManuscriptChapters', [{ path: '[0].index', message: 'Invalid input: expected number, received string' }]);

    it('shows an inline error with Retry, in plain words and without the technical text', async () => {
      renderManuscript({ manuscriptChapters: () => Promise.reject(unreadable()) });
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The app received data it could not read.');
      expect(screen.getByRole('heading', { name: 'Manuscript' })).toBeTruthy();
      expect(document.body.textContent).not.toContain('index');
    });

    it('loads the page when Retry succeeds', async () => {
      const real = createMockApi();
      const chapters = vi
        .fn()
        .mockRejectedValueOnce(unreadable())
        .mockImplementation(() => real.manuscriptChapters());
      renderManuscript({ manuscriptChapters: chapters });
      fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(await screen.findByRole('button', { name: 'Text size' })).toBeTruthy();
      expect(chapters).toHaveBeenCalledTimes(2);
    });
  });

  describe('hides reference material from the continuous reader (R13, Phase 5)', () => {
    it('opens on the first recorded chapter even when a reference chapter sorts first', async () => {
      renderManuscript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });

    it('falls back to expanded, not collapsed, when a reader state saved before this phase points at a hidden chapter', async () => {
      // No expandedChapters saved (the shape a pre-Phase-5 project's reader state can be in) - the
      // default used to be [state.activeChapter], which would have resolved to the now-filtered-out
      // 'contents' id and left the fallback chapter's header rendered but its body collapsed.
      renderManuscript({
        manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())],
        readerState: async () => ({ activeChapter: 'contents', bookmarks: [] }),
      });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(paragraph(0)).toBeTruthy());
    });

    it('never renders a reference chapter as an article in the page-flip view', async () => {
      renderManuscript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(screen.queryByText('Contents')).toBeNull();
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });

    it('Expand all chapters never requests paragraphs for a reference chapter', async () => {
      const paragraphsSpy = vi.fn(async () => []);
      renderManuscript({
        manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())],
        manuscriptParagraphs: paragraphsSpy,
      });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      fireEvent.click(screen.getByRole('button', { name: 'Expand all chapters' }));
      await waitFor(() => expect(paragraphsSpy).toHaveBeenCalled());
      expect(paragraphsSpy).not.toHaveBeenCalledWith('contents');
    });

    it('a "#p" deep link into a hidden paragraph tells the narrator instead of navigating there', async () => {
      const { notify } = renderManuscript({ manuscriptChapters: async () => [referenceChapter, ...(await createMockApi().manuscriptChapters())] }, vi.fn(), [
        '/manuscript#p900',
      ]);
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('reference material')));
      expect(document.querySelector('[data-chapter-id="contents"]')).toBeNull();
    });
  });

  describe('credits pseudo-entries (PRD audiobook-credits-templates.prd.md, Phase 3)', () => {
    it('shows an Opening credits entry before the first chapter and a Closing credits entry after the last, both collapsed by default', async () => {
      renderManuscript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 12 — Alice’s Evidence' }));

      const opening = screen.getByRole('heading', { name: 'Opening credits' }).closest('[data-credits-entry]')!;
      const closing = screen.getByRole('heading', { name: 'Closing credits' }).closest('[data-credits-entry]')!;
      const reader = document.querySelector('.reader-chapters')!;
      const order = [...reader.children].map((el) => el.getAttribute('data-credits-entry') || el.getAttribute('data-chapter'));
      expect(order[0]).toBe('opening');
      expect(order.at(-1)).toBe('closing');

      // Collapsed by default: no rendered preview text or unresolved-token count is shown yet.
      expect(within(opening as HTMLElement).queryByText(/unresolved token/)).toBeNull();
      expect(within(closing as HTMLElement).queryByText(/unresolved token/)).toBeNull();
    });

    it('expanding the Opening credits entry shows the rendered preview with an unresolved-token chip, never silent empty text (C6)', async () => {
      renderManuscript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));

      fireEvent.click(screen.getByRole('button', { name: /Opening credits/ }));
      // The mock's default project has no Title/Author/Narrator value set, so the shipped opening template's
      // tokens are all unresolved - each renders as its own bracketed chip rather than empty text.
      expect(await screen.findByText('[Title]')).toBeTruthy();
      expect(screen.getByText('[Author]')).toBeTruthy();
      expect(screen.getByText('[Narrator]')).toBeTruthy();
      expect(screen.getByText(/3 unresolved tokens: Title, Author, Narrator/)).toBeTruthy();
    });

    it('a credits entry is not a chapter: it is absent from Chapters & Search and never counted in the chapter list', async () => {
      renderManuscript();
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
      const chaptersPanel = await screen.findByText('Chapters');
      const nav = chaptersPanel.closest('div')!.parentElement!;
      expect(within(nav as HTMLElement).queryByText('Opening credits')).toBeNull();
      expect(within(nav as HTMLElement).queryByText('Closing credits')).toBeNull();
    });

    it('renders no credits entries when the template library has no opening or closing template', async () => {
      renderManuscript({ creditsTemplates: async () => [] });
      await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
      expect(screen.queryByRole('heading', { name: 'Opening credits' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Closing credits' })).toBeNull();
    });
  });

  describe('Read aloud (teleprompter-manuscript-integration.prd.md Phase 2)', () => {
    it('opens the read-aloud modal for a narration chapter, with no separate chapter picker', async () => {
      renderManuscript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());

      fireEvent.click(screen.getByRole('button', { name: 'Read Chapter 1 aloud' }));

      expect(await screen.findByRole('dialog', { name: /Read aloud.*Chapter 1/ })).toBeTruthy();
    });

    it('closing the modal returns to the Manuscript reader', async () => {
      renderManuscript();
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' })).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Read Chapter 1 aloud' }));
      await screen.findByRole('dialog', { name: /Read aloud/ });

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: /Read aloud/ })).toBeNull());
    });
  });
});
