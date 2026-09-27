// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { gesture } from './gestures';
import { useGestureCapture } from './useGestureCapture';

function keydown(init: Partial<KeyboardEventInit> & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('useGestureCapture', () => {
  it('captures a plain key while active', () => {
    const onCapture = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, vi.fn()));

    document.dispatchEvent(keydown({ code: 'PageDown' }));

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(gesture('keyboard', 'PageDown'));
  });

  it('reads the modifiers held', () => {
    const onCapture = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, vi.fn()));

    document.dispatchEvent(keydown({ code: 'ArrowDown', shiftKey: true }));

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(gesture('keyboard', 'ArrowDown', ['Shift']));
  });

  it('cancels on a bare Escape instead of capturing it', () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, onCancel));

    document.dispatchEvent(keydown({ code: 'Escape' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('captures Escape held with a modifier, since that is a real chord and not the cancel gesture', () => {
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, onCancel));

    document.dispatchEvent(keydown({ code: 'Escape', altKey: true }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(gesture('keyboard', 'Escape', ['Alt']));
  });

  it('ignores a bare modifier key and a repeat, waiting for a real key', () => {
    const onCapture = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, vi.fn()));

    document.dispatchEvent(keydown({ code: 'ControlLeft' }));
    document.dispatchEvent(keydown({ code: 'KeyA', repeat: true }));

    expect(onCapture).not.toHaveBeenCalled();
  });

  it('prevents the default action and stops the event reaching a bound command underneath', () => {
    const onCapture = vi.fn();
    renderHook(() => useGestureCapture(true, onCapture, vi.fn()));
    const bubblePhase = vi.fn();
    document.addEventListener('keydown', bubblePhase);

    const event = keydown({ code: 'Space' });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(bubblePhase).not.toHaveBeenCalled();
    document.removeEventListener('keydown', bubblePhase);
  });

  it('listens for nothing while inactive, and stops listening once no longer active', () => {
    const onCapture = vi.fn();
    const { rerender } = renderHook(({ active }) => useGestureCapture(active, onCapture, vi.fn()), { initialProps: { active: false } });
    document.dispatchEvent(keydown({ code: 'Space' }));
    expect(onCapture).not.toHaveBeenCalled();

    rerender({ active: true });
    document.dispatchEvent(keydown({ code: 'Space' }));
    expect(onCapture).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    document.dispatchEvent(keydown({ code: 'Space' }));
    expect(onCapture).toHaveBeenCalledTimes(1);
  });
});
