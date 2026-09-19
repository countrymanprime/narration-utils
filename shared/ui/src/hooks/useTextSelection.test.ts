// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { offsetsWithinParagraph, paragraphIndexFromNode } from './useTextSelection';

describe('offsetsWithinParagraph', () => {
  const row = '<div data-paragraph="7"><div><span class="source-line-number">12</span></div><p data-paragraph-text>She <em>never</em> said so</p></div>';

  it('measures offsets from the prose, not the line-number gutter', () => {
    document.body.innerHTML = row;
    const em = document.querySelector('em')!.firstChild!;
    const range = document.createRange();
    range.setStart(em, 0);
    range.setEnd(em, 5);
    expect(offsetsWithinParagraph(range)).toEqual({ paragraphIndex: 7, anchorStart: 4, anchorEnd: 9 });
  });

  it('rejects a selection that begins in the gutter', () => {
    document.body.innerHTML = row;
    const range = document.createRange();
    range.setStart(document.querySelector('.source-line-number')!.firstChild!, 0);
    range.setEnd(document.querySelector('p')!.firstChild!, 3);
    expect(offsetsWithinParagraph(range)).toEqual({});
  });
});

describe('paragraphIndexFromNode', () => {
  it('finds the nearest ancestor carrying data-paragraph', () => {
    document.body.innerHTML = '<div data-paragraph="42"><p><mark>Saint Voltage</mark></p></div>';
    const mark = document.querySelector('mark')!;
    expect(paragraphIndexFromNode(mark.firstChild)).toBe(42);
    expect(paragraphIndexFromNode(mark)).toBe(42);
  });

  it('returns undefined when nothing up the tree has data-paragraph', () => {
    document.body.innerHTML = '<div><p>plain text</p></div>';
    expect(paragraphIndexFromNode(document.querySelector('p')!.firstChild)).toBeUndefined();
  });
});
