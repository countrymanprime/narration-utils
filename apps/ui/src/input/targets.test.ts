// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isGuardedTarget } from './targets';

function el(html: string): Element {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.firstElementChild!;
}

describe('isGuardedTarget', () => {
  it('is false for null or a non-Element target', () => {
    expect(isGuardedTarget(null)).toBe(false);
  });

  it('is false for plain text-flow elements', () => {
    expect(isGuardedTarget(el('<div></div>'))).toBe(false);
    expect(isGuardedTarget(document.body)).toBe(false);
  });

  it('is true for a field', () => {
    expect(isGuardedTarget(el('<input />'))).toBe(true);
    expect(isGuardedTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isGuardedTarget(el('<select></select>'))).toBe(true);
    expect(isGuardedTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isGuardedTarget(el('<div contenteditable="false"></div>'))).toBe(false);
  });

  it('is true for an element Space activates', () => {
    expect(isGuardedTarget(el('<button></button>'))).toBe(true);
    expect(isGuardedTarget(el('<a href="#"></a>'))).toBe(true);
    expect(isGuardedTarget(el('<summary></summary>'))).toBe(true);
    expect(isGuardedTarget(el('<div role="button"></div>'))).toBe(true);
    expect(isGuardedTarget(el('<div role="checkbox"></div>'))).toBe(true);
    expect(isGuardedTarget(el('<div role="switch"></div>'))).toBe(true);
  });

  it('is true for a KEY_WIDGET_ROLES role', () => {
    expect(isGuardedTarget(el('<div role="tab"></div>'))).toBe(true);
    expect(isGuardedTarget(el('<div role="slider"></div>'))).toBe(true);
  });

  it('is false for an unrelated role', () => {
    expect(isGuardedTarget(el('<div role="note"></div>'))).toBe(false);
  });

  it('reaches up through a nested target (closest), not just the exact element', () => {
    const wrapper = el('<button><span>label</span></button>');
    expect(isGuardedTarget(wrapper.firstElementChild)).toBe(true);
  });
});
