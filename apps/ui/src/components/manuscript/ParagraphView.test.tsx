// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIRE_NOTES, WIRE_PARAGRAPHS } from '../../api/mockFixtures';
import type { GuideEntity, ManuscriptParagraph, TextSpan } from '../../types';
import { ParagraphView } from './ParagraphView';

afterEach(cleanup);

// A seed paragraph given one span of each style the importer preserves (ADR-0013/0014), and the paragraph a note is anchored to.
const plain = WIRE_PARAGRAPHS.find((paragraph) => paragraph.index === 4)!;
const words = plain.text.split(' ');
const spanOf = (word: string, style: TextSpan['style']): TextSpan => {
  const start = plain.text.indexOf(word);
  return { start, end: start + word.length, style };
};
const formatted: ManuscriptParagraph = { ...plain, spans: [spanOf(words[1], 'bold'), spanOf(words[3], 'italic'), spanOf(words[5], 'underline')] };
const note = WIRE_NOTES[0];
const noted = WIRE_PARAGRAPHS.find((paragraph) => paragraph.index === note.paragraph)!;

function renderView(openNote = vi.fn()) {
  render(
    <ParagraphView paragraphs={[noted, formatted]} entities={[]} notes={[note]} textClass="" lineNumberPadding="" openEntity={vi.fn()} openNote={openNote} />,
  );
  return openNote;
}

describe('ParagraphView', () => {
  it('renders the preserved bold, italic and underline spans as strong, em and u', () => {
    renderView();

    for (const span of formatted.spans!) {
      const tag = { bold: 'STRONG', italic: 'EM', underline: 'U' }[span.style];
      const element = screen.getByText(formatted.text.slice(span.start, span.end), { selector: tag.toLowerCase() });
      expect(element.tagName).toBe(tag);
    }
  });

  it('highlights the text a note is anchored to and opens the note when it is activated', async () => {
    const openNote = renderView();

    const highlight = screen.getAllByRole('button').find((element) => element.getAttribute('data-highlight') === 'Note')!;
    expect(highlight.textContent).toBe(note.anchorText);
    await userEvent.click(highlight);

    expect(openNote).toHaveBeenCalledWith(note);
  });

  it('highlights a Story Bible mention in its category colour and opens the entry when it is activated', async () => {
    const entity = { id: 'e1', canonical_name: words[2], aliases: [], category: 'Place' } as unknown as GuideEntity;
    const openEntity = vi.fn();
    render(
      <ParagraphView
        paragraphs={[{ ...plain, entityIds: ['e1'] }]}
        entities={[entity]}
        notes={[]}
        textClass=""
        lineNumberPadding=""
        openEntity={openEntity}
        openNote={vi.fn()}
      />,
    );

    const highlight = screen.getAllByRole('button').find((element) => element.getAttribute('data-highlight') === 'Place')!;
    expect(highlight.textContent?.toLowerCase()).toBe(words[2].toLowerCase());
    await userEvent.click(highlight);

    expect(openEntity).toHaveBeenCalledWith(entity);
  });
});
