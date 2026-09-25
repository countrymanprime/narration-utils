// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ToastMessage } from '../components/primitives/Toast';
import { pushToast, TOAST_VISIBLE_LIMIT, useToasts } from './useToasts';

const message = (id: number, text: string, tone: ToastMessage['tone'] = 'info'): ToastMessage => ({ id, text, tone });

describe('pushToast', () => {
  it('queues messages in order instead of replacing the last one', () => {
    const queue = pushToast(pushToast([], message(1, 'One')), message(2, 'Two'));
    expect(queue.map((m) => m.text)).toEqual(['One', 'Two']);
  });

  it('replaces an identical message that is showing, so it starts over without stacking a copy', () => {
    const queue = pushToast([message(1, 'Same'), message(2, 'Other')], message(3, 'Same'));
    expect(queue).toEqual([message(2, 'Other'), message(3, 'Same')]);
  });

  it('does not treat the same text with another tone as the same message', () => {
    expect(pushToast([message(1, 'Same')], message(2, 'Same', 'error'))).toHaveLength(2);
  });

  it('drops the oldest information message before it drops any error once the limit is reached', () => {
    let queue: ToastMessage[] = [message(1, 'Failure A', 'error'), message(2, 'Info A'), message(3, 'Info B'), message(4, 'Failure B', 'error')];
    queue = pushToast(queue, message(5, 'Info C'));
    expect(queue.map((m) => m.text)).toEqual(['Failure A', 'Info B', 'Failure B', 'Info C']);
    expect(queue).toHaveLength(TOAST_VISIBLE_LIMIT);
  });

  it('never drops the message it just added, even an information message among four errors', () => {
    const errors = [1, 2, 3, 4].map((id) => message(id, `Failure ${id}`, 'error'));
    expect(pushToast(errors, message(5, 'Saved.')).map((m) => m.id)).toEqual([2, 3, 4, 5]);
  });

  it('drops the oldest error only when every message is an error', () => {
    const errors = [1, 2, 3, 4].map((id) => message(id, `Failure ${id}`, 'error'));
    expect(pushToast(errors, message(5, 'Failure 5', 'error')).map((m) => m.id)).toEqual([2, 3, 4, 5]);
  });
});

describe('useToasts', () => {
  it('notifies with the information tone by default, ignores an empty text, and dismisses by id', () => {
    const { result } = renderHook(() => useToasts());
    act(() => result.current.notify('Saved.'));
    act(() => result.current.notify(''));
    act(() => result.current.notify('Could not save.', 'error'));
    expect(result.current.messages.map((m) => [m.text, m.tone])).toEqual([
      ['Saved.', 'info'],
      ['Could not save.', 'error'],
    ]);
    act(() => result.current.dismiss(result.current.messages[0].id));
    expect(result.current.messages.map((m) => m.text)).toEqual(['Could not save.']);
  });

  it('carries an action through to the message', () => {
    const { result } = renderHook(() => useToasts());
    const onAction = () => {};
    act(() => result.current.notify('Linked track “Ch. 11” to Chapter 11.', 'info', { label: 'Undo', onAction }));
    expect(result.current.messages[0].action).toEqual({ label: 'Undo', onAction });
  });

  it('keeps notify and dismiss the same functions across renders, so an effect that lists them does not re-run', () => {
    const { result, rerender } = renderHook(() => useToasts());
    const { notify, dismiss } = result.current;
    act(() => result.current.notify('A message'));
    rerender();
    expect(result.current.notify).toBe(notify);
    expect(result.current.dismiss).toBe(dismiss);
  });
});
