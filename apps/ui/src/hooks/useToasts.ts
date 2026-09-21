import { useCallback, useRef, useState } from 'react';
import type { Notify, ToastMessage, ToastTone } from '../components/primitives/Toast';

/** How many messages are on screen at once; the oldest information message goes first, then the oldest error. */
export const TOAST_VISIBLE_LIMIT = 4;

/**
 * Adds a message to the queue. The same text and tone that is already showing is replaced by the new one, so it starts its time again
 * and looks new (a second press of the same action still gives a signal) without stacking a copy. Beyond the limit the oldest
 * information message is dropped before any error is, and never the message just added.
 */
export function pushToast(current: readonly ToastMessage[], next: ToastMessage): ToastMessage[] {
  const queue = [...current.filter((message) => !(message.text === next.text && message.tone === next.tone)), next];
  while (queue.length > TOAST_VISIBLE_LIMIT) {
    // The message just added is never the one dropped: a narrator who pressed something must see its result.
    const older = queue.slice(0, -1);
    const info = older.findIndex((message) => message.tone === 'info');
    queue.splice(info >= 0 ? info : 0, 1);
  }
  return queue;
}

/** The app's message queue: `notify` shows a message, `dismiss` removes one. Both keep their identity for the life of the app. */
export function useToasts(): { messages: ToastMessage[]; notify: Notify; dismiss: (id: number) => void } {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const lastId = useRef(0);
  const notify = useCallback((text: string, tone: ToastTone = 'info') => {
    if (!text) return;
    lastId.current += 1;
    const message = { id: lastId.current, text, tone };
    setMessages((current) => pushToast(current, message));
  }, []);
  const dismiss = useCallback((id: number) => setMessages((current) => current.filter((message) => message.id !== id)), []);
  return { messages, notify, dismiss };
}
