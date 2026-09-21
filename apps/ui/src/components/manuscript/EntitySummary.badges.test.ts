// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BADGE_STYLE } from './EntitySummary';

// ADR 0059: a badge's text is the derived `--<token>-text` of its kind (the kind colour mixed toward --text), on the kind's
// own soft fill; the pure kind colour on its soft fill was 3.0 to 4.4:1. The palette guard reads tokens, not component
// source, so this test is what ties the badges to the tokens it measures.
const TOKEN: Record<string, string> = {
  Character: 'character',
  Place: 'place',
  Organization: 'org',
  Review: 'review',
  Lore: 'lore',
  Item: 'item',
  Event: 'event',
};

describe('entity badge colours (ADR 0059)', () => {
  it('has a badge for every kind and no other', () => {
    expect(Object.keys(BADGE_STYLE).sort()).toEqual(Object.keys(TOKEN).sort());
  });

  for (const [kind, token] of Object.entries(TOKEN)) {
    it(`draws a ${kind} badge in --${token}-text on the soft fill of --${token}`, () => {
      const style = BADGE_STYLE[kind];
      expect(style.color).toBe(`var(--${token}-text)`);
      expect(String(style.background)).toContain(`var(--${token}`);
    });
  }
});
