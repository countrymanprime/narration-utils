import { describe, expect, it } from 'vitest';
import { gesture, gestureFromKeyboardEvent, resolveGesture, serializeGesture } from './gestures';

describe('gesture', () => {
  it('dedupes and sorts modifiers into a stable order regardless of input order', () => {
    expect(gesture('keyboard', 'KeyP', ['Shift', 'Ctrl', 'Ctrl'])).toEqual(gesture('keyboard', 'KeyP', ['Ctrl', 'Shift']));
  });
});

describe('resolveGesture', () => {
  it('resolves Mod to Meta on macOS', () => {
    expect(resolveGesture({ source: 'keyboard', code: 'BracketLeft', modifiers: ['Mod'] }, true)).toEqual(gesture('keyboard', 'BracketLeft', ['Meta']));
  });

  it('resolves Mod to Ctrl elsewhere', () => {
    expect(resolveGesture({ source: 'keyboard', code: 'BracketLeft', modifiers: ['Mod'] }, false)).toEqual(gesture('keyboard', 'BracketLeft', ['Ctrl']));
  });

  it('leaves a concrete modifier untouched', () => {
    expect(resolveGesture({ source: 'keyboard', code: 'ArrowLeft', modifiers: ['Alt'] }, true)).toEqual(gesture('keyboard', 'ArrowLeft', ['Alt']));
  });
});

describe('serializeGesture', () => {
  it('serialises a bare key as just its code', () => {
    expect(serializeGesture(gesture('keyboard', 'Space'))).toBe('Space');
  });

  it('serialises modifiers before the code, in a stable order', () => {
    expect(serializeGesture(gesture('keyboard', 'ArrowLeft', ['Ctrl', 'Alt']))).toBe('Alt+Ctrl+ArrowLeft');
  });

  it('prefixes a non-keyboard source', () => {
    expect(serializeGesture(gesture('midi', 'cc/1/64'))).toBe('midi:cc/1/64');
    expect(serializeGesture(gesture('hid', '<vid>:<pid>/<button>'))).toBe('hid:<vid>:<pid>/<button>');
  });

  it('is the same string for the same binding regardless of how the modifiers were ordered when built', () => {
    const a = serializeGesture(gesture('keyboard', 'KeyP', ['Shift', 'Ctrl']));
    const b = serializeGesture(gesture('keyboard', 'KeyP', ['Ctrl', 'Shift']));
    expect(a).toBe(b);
  });
});

describe('gestureFromKeyboardEvent', () => {
  it('reads code and the four modifier flags', () => {
    expect(gestureFromKeyboardEvent({ code: 'ArrowLeft', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toEqual(
      gesture('keyboard', 'ArrowLeft', ['Alt']),
    );
  });

  it('reads a bare key with no modifiers', () => {
    expect(gestureFromKeyboardEvent({ code: 'Space', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toEqual(gesture('keyboard', 'Space'));
  });
});
