// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createKeyboardSource } from './KeyboardSource';
import { gesture } from './gestures';

function keydown(init: Partial<KeyboardEventInit> & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('createKeyboardSource', () => {
  it('emits a resolved gesture for a plain key', () => {
    const source = createKeyboardSource(document);
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);

    document.dispatchEvent(keydown({ code: 'Space' }));

    expect(onGesture).toHaveBeenCalledTimes(1);
    expect(onGesture.mock.calls[0][0].gesture).toEqual(gesture('keyboard', 'Space'));
    unsubscribe();
  });

  it('reads the modifiers held', () => {
    const source = createKeyboardSource(document);
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);

    document.dispatchEvent(keydown({ code: 'ArrowLeft', altKey: true }));

    expect(onGesture.mock.calls[0][0].gesture).toEqual(gesture('keyboard', 'ArrowLeft', ['Alt']));
    unsubscribe();
  });

  it('ignores a repeated key (held down)', () => {
    const source = createKeyboardSource(document);
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);

    document.dispatchEvent(keydown({ code: 'Space', repeat: true }));

    expect(onGesture).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('passes the real target and a working preventDefault', () => {
    const source = createKeyboardSource(document);
    const input = document.createElement('input');
    document.body.appendChild(input);
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);

    const event = keydown({ code: 'Space' });
    input.dispatchEvent(event);

    expect(onGesture.mock.calls[0][0].target).toBe(input);
    onGesture.mock.calls[0][0].preventDefault();
    expect(event.defaultPrevented).toBe(true);

    unsubscribe();
    input.remove();
  });

  it('stops listening once unsubscribed', () => {
    const source = createKeyboardSource(document);
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);
    unsubscribe();

    document.dispatchEvent(keydown({ code: 'Space' }));

    expect(onGesture).not.toHaveBeenCalled();
  });
});
