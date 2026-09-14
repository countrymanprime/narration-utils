// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Manuscript } from './Manuscript';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';

afterEach(cleanup);

function renderManuscript(overrides: Parameters<typeof createMockApi>[0] = {}, focusStoryBibleEntity = vi.fn()) {
  const api = createMockApi(overrides);
  const notify = vi.fn();
  render(
    <div className="shell-content">
      <ApiProvider api={api}>
        <Manuscript notify={notify} focusStoryBibleEntity={focusStoryBibleEntity} />
      </ApiProvider>
    </div>,
  );
  return { api, focusStoryBibleEntity, notify };
}

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
    expect(highlighted.className).toContain('hl-Character');
    expect(document.querySelector('.note-overlay')).toBeTruthy();
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

  it('keeps the wireframe selection menu for a multi-line selection, but validates when adding a note', async () => {
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

  it('opens an existing note with the wireframe headers and a delete button (not a bookmark toggle)', async () => {
    const { api } = renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    await waitFor(() => expect(document.querySelector('.note-overlay')).toBeTruthy());
    const [existingNote] = await api.noteList();

    fireEvent.click(document.querySelector('.note-overlay')!);

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

  it('uses outline/fill chapter bookmarks and right-gutter paragraph bookmarks', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    expect(document.querySelector('.chapter-bookmark-target > .chapter-bookmark .bookmark-outline')).toBeTruthy();
    expect(document.querySelector('.chapter-bookmark-target > .chapter-bookmark .bookmark-fill')).toBeTruthy();
    expect(document.querySelector('.ms-marker-gutter .paragraph-bookmark')).toBeTruthy();
    expect(document.querySelector('.ms-gutter .gutter-bookmark')).toBeNull();
    expect(document.querySelector('.marker-count')).toBeNull();
  });

  it('filters chapters and nests matching search results beneath them', async () => {
    renderManuscript();
    await waitFor(() => screen.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole' }));
    fireEvent.click(screen.getByRole('button', { name: /Chapters & Search/ }));
    fireEvent.change(screen.getByLabelText('Search manuscript'), { target: { value: 'Rabbit' } });

    const [result] = await screen.findAllByRole('button', { name: /Search result in Chapter 1/ });
    expect(within(document.querySelector('.overlay-panel')!).queryByRole('button', { name: /Chapter 3/ })).toBeNull();
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
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.change(input, { target: { value: 'new' } });

    await screen.findByLabelText('Search result in Chapter 2, line 200');
    resolveOld([{ chapter: 'Chapter 1', paragraph: 0, sourceLine: 10, excerpt: 'old result' }]);
    await waitFor(() => expect(screen.queryByLabelText('Search result in Chapter 1, line 10')).toBeNull());
  });
});
