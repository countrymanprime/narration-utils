// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Highlight, type HighlightKind } from './Highlight';

afterEach(cleanup);

// ADR 0059: an entity's text is the kind colour mixed toward --text (a derived `--<token>-text`), which keeps its hue and
// reaches 4.5:1 on the tint; the tint and the 1.5px underline stay the pure kind colour, a mark held to 3:1. A note keeps
// the text colour (ADR 0016) and the Teleprompter cursor is an accent fill. The palette guard reads tokens, not component
// source, so this test is what ties the component to them.
const ENTITY_TOKEN: Record<string, string> = {
  Character: 'character',
  Place: 'place',
  Organization: 'org',
  Lore: 'lore',
  Item: 'item',
  Event: 'event',
  Review: 'review',
};

describe('Highlight colours (ADR 0059)', () => {
  for (const [kind, token] of Object.entries(ENTITY_TOKEN)) {
    it(`draws a ${kind} in --${token}-text on a 20% tint and 1.5px underline of the pure --${token}`, () => {
      render(<Highlight kind={kind as HighlightKind}>word</Highlight>);
      const mark = screen.getByText('word');
      expect(mark.style.color).toBe(`var(--${token}-text)`);
      expect(mark.style.background).toBe(`color-mix(in srgb, var(--${token}) 20%, transparent)`);
      expect(mark.style.boxShadow).toBe(`inset 0 -1.5px 0 var(--${token})`);
    });
  }

  it('leaves a note in the text colour and marks it with --note', () => {
    render(<Highlight kind="Note">word</Highlight>);
    const mark = screen.getByText('word');
    expect(mark.style.color).toBe('');
    expect(mark.style.background).toBe('color-mix(in srgb, var(--note) 20%, transparent)');
    expect(mark.style.boxShadow).toBe('inset 0 -1.5px 0 var(--note)');
  });

  it('draws the Teleprompter cursor as an accent fill in the accent contrast colour', () => {
    render(<Highlight kind="Cursor">word</Highlight>);
    const mark = screen.getByText('word');
    expect(mark.style.color).toBe('var(--accent-contrast)');
    expect(mark.style.background).toContain('var(--accent)');
  });
});
