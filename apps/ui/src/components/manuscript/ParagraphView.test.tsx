// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WIRE_NOTES, WIRE_PARAGRAPHS } from '../../api/mockFixtures';
import type { GuideEntity, ManuscriptParagraph, TextSpan } from '../../types';
import type { DialogueCue } from './dialogueCues';
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

  // axe's nested-interactive: a note anchored over the whole line and a Story Bible mention inside it used to render
  // as one interactive <mark> nested in another. Only the shorter, inner one should still carry the click/keyboard
  // activation - the outer note stays reachable through its own, non-overlapping text either side.
  it('does not nest an entity mark inside a note mark that overlaps it, and keeps both activatable', async () => {
    const user = userEvent.setup();
    const entity = { id: 'e1', canonical_name: words[2], aliases: [], category: 'Place' } as unknown as GuideEntity;
    const openEntity = vi.fn();
    const openNote = vi.fn();
    const overlappingNote = { ...note, paragraph: plain.index, anchorStart: 0, anchorEnd: plain.text.length, anchorText: plain.text };
    render(
      <ParagraphView
        paragraphs={[{ ...plain, entityIds: ['e1'] }]}
        entities={[entity]}
        notes={[overlappingNote]}
        textClass=""
        lineNumberPadding=""
        openEntity={openEntity}
        openNote={openNote}
      />,
    );

    const buttons = screen.getAllByRole('button');
    for (const button of buttons) expect(buttons.filter((other) => other !== button && button.contains(other))).toHaveLength(0);

    const entityMark = buttons.find((button) => button.getAttribute('data-highlight') === 'Place')!;
    await user.click(entityMark);
    expect(openEntity).toHaveBeenCalledWith(entity);

    const noteMark = buttons.find((button) => button.getAttribute('data-highlight') === 'Note')!;
    await user.click(noteMark);
    expect(openNote).toHaveBeenCalledWith(overlappingNote);
  });

  // Speaker attribution (prep-depth.prd.md Phase 4): a fixed cue against a recorded fixture, not the real
  // extractor - see dialogueCues.test.ts for the pure-function coverage of unknown/single-speaker/ambiguous cues.
  describe('speaker attribution', () => {
    const speaker = { id: 'queen-of-hearts', canonical_name: 'Queen of Hearts', aliases: [], category: 'Character' } as unknown as GuideEntity;
    const cueFor = (overrides: Partial<DialogueCue>): DialogueCue => ({
      id: 'demo-cue-1',
      chapterId: plain.chapterId,
      paragraphId: plain.id,
      quote_start: 0,
      quote_end: 1,
      quote_text: '',
      speaker_entity_id: null,
      speaker_source: 'unknown',
      evidence: { chapterId: plain.chapterId, paragraphId: plain.id, excerpt: '', tag: '' },
      corrected: false,
      ...overrides,
    });

    it('single-speaker: shows a chip naming the resolved speaker', () => {
      render(
        <ParagraphView
          paragraphs={[plain]}
          entities={[speaker]}
          notes={[]}
          textClass=""
          lineNumberPadding=""
          dialogueCues={[cueFor({ speaker_source: 'tag', speaker_entity_id: 'queen-of-hearts' })]}
          openEntity={vi.fn()}
          openNote={vi.fn()}
        />,
      );

      const chip = screen.getByText('Queen of Hearts');
      expect(chip.getAttribute('data-speaker-tag')).not.toBeNull();
    });

    it('ambiguous-cue: a cue resolved by continuation still shows its resolved speaker', () => {
      render(
        <ParagraphView
          paragraphs={[plain]}
          entities={[speaker]}
          notes={[]}
          textClass=""
          lineNumberPadding=""
          dialogueCues={[cueFor({ speaker_source: 'continuation', speaker_entity_id: 'queen-of-hearts' })]}
          openEntity={vi.fn()}
          openNote={vi.fn()}
        />,
      );

      expect(screen.getByText('Queen of Hearts')).toBeTruthy();
    });

    it('unknown: renders no chip and no placeholder name', () => {
      render(
        <ParagraphView
          paragraphs={[plain]}
          entities={[speaker]}
          notes={[]}
          textClass=""
          lineNumberPadding=""
          dialogueCues={[cueFor({ speaker_source: 'unknown', speaker_entity_id: null })]}
          openEntity={vi.fn()}
          openNote={vi.fn()}
        />,
      );

      expect(screen.queryByText('Queen of Hearts')).toBeNull();
      expect(document.querySelector('[data-speaker-tag]')).toBeNull();
    });

    it('no dialogue cues at all: renders exactly as before (no chip)', () => {
      renderView();

      expect(document.querySelector('[data-speaker-tag]')).toBeNull();
    });
  });
});
