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

// The fill each badge sits on, which is what the palette guard measures the text against: a soft token for the four kinds
// that have one, an 18% mix of the kind colour into the surface for the other three.
const FILL: Record<string, string> = {
  Character: 'var(--character-soft)',
  Place: 'var(--place-soft)',
  Organization: 'var(--org-soft)',
  Review: 'var(--review-soft)',
  Lore: 'color-mix(in srgb, var(--lore) 18%, var(--surface))',
  Item: 'color-mix(in srgb, var(--item) 18%, var(--surface))',
  Event: 'color-mix(in srgb, var(--event) 18%, var(--surface))',
};
describe('entity badge colours (ADR 0059)', () => {
  it('has a badge for every kind and no other', () => {
    expect(Object.keys(BADGE_STYLE).sort()).toEqual(Object.keys(TOKEN).sort());
  });

  for (const [kind, token] of Object.entries(TOKEN)) {
    it(`draws a ${kind} badge in --${token}-text on ${FILL[kind]}`, () => {
      const style = BADGE_STYLE[kind];
      expect(style.color).toBe(`var(--${token}-text)`);
      expect(style.background).toBe(FILL[kind]);
    });
  }
});
