// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuideEntity, ManuscriptParagraph, PrepMarkupSpan } from '../../types';
import { ParagraphView } from './ParagraphView';

afterEach(cleanup);

const line: ManuscriptParagraph = {
  id: 'p-1',
  chapterId: 'c-1',
  chapter: 'Chapter One',
  index: 7,
  text: '“Off with her head!” the Queen shouted at the top of her voice.',
  entityIds: ['queen'],
};
const other: ManuscriptParagraph = { ...line, id: 'p-2', index: 8, text: 'The soldiers were silent.', entityIds: [] };
const queen = { id: 'queen', canonical_name: 'Queen', aliases: [], category: 'Character' } as unknown as GuideEntity;

function span(words: string, kind: PrepMarkupSpan['kind'], value = '', on: ManuscriptParagraph = line, extra: Partial<PrepMarkupSpan> = {}): PrepMarkupSpan {
  const start = on.text.indexOf(words);
  return {
    id: `${kind}-${words}`,
    chapterId: 'c-1',
    paragraphId: on.id,
    paragraph: on.index,
    start,
    end: start + words.length,
    anchorText: words,
    kind,
    value,
    createdAt: '2026-09-27T12:00:00Z',
    stale: false,
    ...extra,
  };
}

function renderView(markup: PrepMarkupSpan[], removeMarkup = vi.fn(), paragraphs = [line, other]) {
  render(
    <ParagraphView
      paragraphs={paragraphs}
      entities={[queen]}
      notes={[]}
      markup={markup}
      removeMarkup={removeMarkup}
      textClass=""
      lineNumberPadding=""
      openEntity={vi.fn()}
      openNote={vi.fn()}
    />,
  );
  return removeMarkup;
}

const lineText = (index: number) => document.querySelector(`[data-paragraph="${index}"] [data-paragraph-text]`)!;

describe('ParagraphView script markup (prep-depth PRD Phase 5)', () => {
  it('marks a stressed word, a pause after a word and a character tag, without adding to the line’s text', () => {
    renderView([span('head!', 'stress'), span('shouted', 'pause', 'long'), span('Off with her head!', 'character_tag', 'Queen')]);

    const stress = document.querySelector('[data-markup="stress"]')!;
    expect(stress.textContent).toBe('head!');
    const pause = document.querySelector('[data-markup="pause"]')!;
    expect(pause.textContent).toBe('shouted');
    expect(pause.getAttribute('data-pause')).toBe('long');
    const tag = document.querySelector('[data-markup="character_tag"]')!;
    expect(tag.getAttribute('data-speaker')).toBe('Queen');
    // The glyphs are CSS generated content: the selection offsets (useTextSelection) and every other reader of the line's
    // text see exactly the manuscript's words.
    expect(lineText(7).textContent).toBe(line.text);
  });

  it('says what each mark is to a screen reader', () => {
    renderView([span('head!', 'stress'), span('shouted', 'pause', 'short'), span('Off with her head!', 'character_tag', 'Queen')]);

    expect(document.querySelector('[data-markup="stress"]')!.getAttribute('aria-description')).toBe('stressed');
    expect(document.querySelector('[data-markup="pause"]')!.getAttribute('aria-description')).toBe('breath after');
    expect(document.querySelector('[data-markup="character_tag"]')!.getAttribute('aria-description')).toBe('spoken by Queen');
  });

  it('draws a span split by an entity highlight once: the tag at its start, the pause at its end', () => {
    renderView([span('the Queen shouted', 'pause', 'short'), span('the Queen shouted', 'character_tag', 'Queen')]);

    const pauses = [...document.querySelectorAll('[data-markup="pause"]')];
    expect(pauses.length).toBeGreaterThan(1);
    expect(pauses.filter((element) => element.hasAttribute('data-pause'))).toHaveLength(1);
    expect(pauses.at(-1)!.getAttribute('data-pause')).toBe('short');
    const tags = [...document.querySelectorAll('[data-markup="character_tag"]')];
    expect(tags.filter((element) => element.hasAttribute('data-speaker'))).toHaveLength(1);
    expect(tags[0].getAttribute('data-speaker')).toBe('Queen');
    expect(lineText(7).textContent).toBe(line.text);
  });

  it('never draws a stale span on the line; it says the text changed there and offers to remove it', async () => {
    const stale = span('soldiers', 'stress', '', other, { anchorText: 'warriors', stale: true, staleReason: 'text_changed' });
    const removeMarkup = renderView([stale]);

    expect(document.querySelector('[data-markup]')).toBeNull();
    const row = document.querySelector('[data-paragraph="8"]') as HTMLElement;
    const notice = within(row).getByRole('note');
    expect(notice.textContent).toContain('Text changed here');
    expect(notice.textContent).toContain('“warriors”');
    expect(notice.textContent).toContain('stress');
    await userEvent.click(within(notice).getByRole('button', { name: 'Remove the stress mark on “warriors”' }));
    expect(removeMarkup).toHaveBeenCalledWith(stale);
    expect(lineText(8).textContent).toBe(other.text);
  });

  it('lists a span whose line is gone above the chapter, with its own Remove', async () => {
    const orphan = span('soldiers', 'character_tag', 'Five', other, { paragraphId: 'p-gone', paragraph: null, stale: true, staleReason: 'paragraph_missing' });
    const removeMarkup = renderView([orphan], vi.fn(), [line]);

    const notice = screen.getByRole('note');
    expect(notice.textContent).toContain('no longer in this chapter');
    await userEvent.click(within(notice).getByRole('button', { name: 'Remove the Five tag on “soldiers”' }));
    expect(removeMarkup).toHaveBeenCalledWith(orphan);
  });

  it('draws nothing extra with no markup', () => {
    renderView([]);
    expect(document.querySelector('[data-markup]')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
