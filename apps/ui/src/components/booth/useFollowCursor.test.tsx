// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_SETTLE_MS, inFollowBand, isScrollKey, useFollowCursor } from './useFollowCursor';

// jsdom's window is 768 px tall, so the follow band (25%-70%) runs from 192 px to 537.6 px.
const IN_BAND = 300;
const ABOVE_BAND = 40;

let wordTop = IN_BAND;

beforeEach(() => {
  vi.useFakeTimers();
  wordTop = IN_BAND;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-current-word') ? wordTop : 0;
    return { top, bottom: top + 30, left: 0, right: 100, width: 100, height: 30, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Harness({ active, cursor }: { active: boolean; cursor: number }) {
  const { following, resume, readerRef } = useFollowCursor({ active, cursor });
  return (
    <div>
      <div ref={readerRef} data-testid="reader">
        <span data-current-word>word {cursor}</span>
        <input aria-label="Field" />
        <button type="button">Seek</button>
        <div role="radiogroup">
          <span role="radio" aria-checked="false" tabIndex={0}>
            Option
          </span>
        </div>
      </div>
      <span data-testid="following">{String(following)}</span>
      <button type="button" onClick={resume}>
        Follow
      </button>
    </div>
  );
}

const following = () => screen.getByTestId('following').textContent;
const reader = () => screen.getByTestId('reader');
const settle = () => act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS + 1));

describe('inFollowBand', () => {
  it('is true only for a word wholly between 25% and 70% of the viewport height', () => {
    expect(inFollowBand({ top: 300, bottom: 330 }, 768)).toBe(true);
    expect(inFollowBand({ top: 100, bottom: 130 }, 768)).toBe(false);
    expect(inFollowBand({ top: 520, bottom: 550 }, 768)).toBe(false);
  });
});

describe('isScrollKey', () => {
  const key = (init: KeyboardEventInit, target: Element = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };

  it('accepts the keys that scroll a page', () => {
    for (const k of ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']) expect(isScrollKey(key({ key: k }))).toBe(true);
  });

  it('ignores other keys, modified keys and keys a control already handled', () => {
    expect(isScrollKey(key({ key: 'a' }))).toBe(false);
    expect(isScrollKey(key({ key: 'ArrowLeft' }))).toBe(false);
    expect(isScrollKey(key({ key: 'PageDown', ctrlKey: true }))).toBe(false);
    const handled = key({ key: 'PageDown' });
    handled.preventDefault();
    expect(isScrollKey(handled)).toBe(false);
  });

  it('ignores keys typed into a field, arrows inside a widget and Space on a button', () => {
    const input = document.createElement('input');
    const radio = document.createElement('span');
    radio.setAttribute('role', 'radio');
    const button = document.createElement('button');
    expect(isScrollKey(key({ key: 'ArrowDown' }, input))).toBe(false);
    expect(isScrollKey(key({ key: 'ArrowDown' }, radio))).toBe(false);
    expect(isScrollKey(key({ key: ' ' }, button))).toBe(false);
    expect(isScrollKey(key({ key: 'PageDown' }, button))).toBe(true);
  });
});

describe('useFollowCursor', () => {
  it('follows from the start of a session', () => {
    render(<Harness active cursor={0} />);
    expect(following()).toBe('true');
  });

  it('pauses on a mouse wheel, a touch drag or a scrolling key over the reader', () => {
    render(<Harness active cursor={0} />);
    fireEvent.wheel(reader(), { deltaY: 120 });
    expect(following()).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(following()).toBe('true');
    fireEvent.touchMove(reader());
    expect(following()).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(following()).toBe('false');
  });

  it('pauses when the scroll container’s own scrollbar is pressed, not when its content is', () => {
    render(<Harness active cursor={0} />);
    const box = reader();
    Object.defineProperty(box, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(box, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });

    fireEvent.pointerDown(box, { clientX: 50, clientY: 10 });
    expect(following()).toBe('true');
    fireEvent.pointerDown(box, { clientX: 205, clientY: 10 });
    expect(following()).toBe('false');
  });

  it('never pauses on scroll events alone, which its own follow scrolling also fires', () => {
    render(<Harness active cursor={0} />);
    fireEvent.scroll(window);
    fireEvent.scroll(reader());
    expect(following()).toBe('true');
  });

  it('ignores keys typed into a field and Space on a button', () => {
    render(<Harness active cursor={0} />);
    fireEvent.keyDown(screen.getByLabelText('Field'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Seek' }), { key: ' ' });
    fireEvent.keyDown(screen.getByRole('radio'), { key: 'ArrowDown' });
    expect(following()).toBe('true');
  });

  it('ignores input outside the reader’s scroll container', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    function Contained() {
      const { following: on, readerRef } = useFollowCursor({ active: true, cursor: 0 });
      return (
        <div style={{ overflowY: 'auto' }}>
          <div ref={readerRef}>
            <span data-current-word>word</span>
          </div>
          <span data-testid="following">{String(on)}</span>
        </div>
      );
    }
    render(<Contained />);
    fireEvent.wheel(outside, { deltaY: 120 });
    expect(following()).toBe('true');
    outside.remove();
  });

  it('does nothing while no session is running', () => {
    render(<Harness active={false} cursor={0} />);
    fireEvent.wheel(reader(), { deltaY: 120 });
    expect(following()).toBe('true');
  });

  it('stays paused while the current word is outside the band, however far the reading goes', () => {
    const { rerender } = render(<Harness active cursor={0} />);
    wordTop = ABOVE_BAND;
    fireEvent.wheel(reader(), { deltaY: 400 });
    settle();
    for (let cursor = 1; cursor <= 20; cursor += 1) rerender(<Harness active cursor={cursor} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(following()).toBe('false');
  });

  it('resumes by itself once reading brings the current word back inside the band', () => {
    const { rerender } = render(<Harness active cursor={0} />);
    wordTop = ABOVE_BAND;
    fireEvent.wheel(reader(), { deltaY: 400 });
    settle();
    rerender(<Harness active cursor={1} />);
    expect(following()).toBe('false');

    wordTop = IN_BAND;
    rerender(<Harness active cursor={2} />);
    expect(following()).toBe('true');
  });

  it('resumes by itself once the narrator scrolls the current word back inside the band and the scroll settles', () => {
    render(<Harness active cursor={0} />);
    wordTop = ABOVE_BAND;
    fireEvent.wheel(reader(), { deltaY: 400 });
    settle();
    expect(following()).toBe('false');

    fireEvent.wheel(reader(), { deltaY: -400 });
    wordTop = IN_BAND;
    fireEvent.scroll(window);
    expect(following()).toBe('false');
    settle();
    expect(following()).toBe('true');
  });

  it('does not resume while a scroll is still moving, even with the word passing through the band', () => {
    const { rerender } = render(<Harness active cursor={0} />);
    fireEvent.touchMove(reader());
    // The word is still in the band as the drag starts, and a position arrives before any scroll event does.
    rerender(<Harness active cursor={1} />);
    expect(following()).toBe('false');
    // Momentum carries on after the finger lifts: scroll events with no input keep the settle window open.
    for (let step = 0; step < 5; step += 1) {
      act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS - 20));
      fireEvent.scroll(window);
      rerender(<Harness active cursor={2 + step} />);
      expect(following()).toBe('false');
    }
    wordTop = ABOVE_BAND;
    settle();
    expect(following()).toBe('false');
  });

  it('resumes at once from the Follow control', () => {
    render(<Harness active cursor={0} />);
    wordTop = ABOVE_BAND;
    fireEvent.wheel(reader(), { deltaY: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(following()).toBe('true');
  });

  it('follows again when the next session starts', () => {
    const { rerender } = render(<Harness active cursor={0} />);
    wordTop = ABOVE_BAND;
    fireEvent.wheel(reader(), { deltaY: 400 });
    rerender(<Harness active={false} cursor={0} />);
    rerender(<Harness active cursor={0} />);
    expect(following()).toBe('true');
  });
});
