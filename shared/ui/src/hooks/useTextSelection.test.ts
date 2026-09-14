// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { paragraphIndexFromNode } from './useTextSelection';

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
