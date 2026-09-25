import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useState } from 'react';

export type ToastTone = 'info' | 'error';
/** A toast's one action (for example Undo): its own label, run when pressed, which also dismisses the toast. */
export type ToastAction = { label: string; onAction: () => void };
export type ToastMessage = { id: number; text: string; tone: ToastTone; action?: ToastAction };
/** How a page or a component tells the narrator something. An error is announced at once and stays until it is dismissed (ADR 0075).
 * `action` adds one button (for example Undo) before the dismiss button; pressing it runs the action and dismisses the toast. */
export type Notify = (text: string, tone?: ToastTone, action?: ToastAction) => void;

/** How long an information message stays. An error has no timer. */
export const TOAST_INFO_MS = 5_000;
const FADE_MS = 150;

function ToastItem({ message, dismiss }: { message: ToastMessage; dismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const sticky = message.tone === 'error';
  const { id } = message;
  useEffect(() => {
    if (sticky) return;
    const fade = window.setTimeout(() => setLeaving(true), TOAST_INFO_MS - FADE_MS);
    const remove = window.setTimeout(() => dismiss(id), TOAST_INFO_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(remove);
    };
  }, [dismiss, id, sticky]);
  return (
    <div
      data-tone={message.tone}
      className={`ease flex items-center gap-[0.6rem] rounded-[0.4rem] bg-[var(--text)] px-4 py-[0.65rem] text-[0.85rem] text-[var(--bg)] shadow-[var(--shadow)] motion-safe:transition-[opacity,transform] motion-safe:duration-150 ${sticky ? 'border-l-4 border-[var(--danger)]' : ''} ${leaving ? 'translate-y-1 opacity-0' : 'opacity-100'}`}
    >
      {sticky && <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />}
      <span className="min-w-0 break-words">{message.text}</span>
      {message.action && (
        <button
          className="flex-none font-semibold underline underline-offset-2"
          onClick={() => {
            message.action!.onAction();
            dismiss(id);
          }}
        >
          {message.action.label}
        </button>
      )}
      <button aria-label="Dismiss message" className="flex-none" onClick={() => dismiss(id)}>
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}

// The messages the app shows, newest last. Neither region is atomic: a new message is read on its own, not every message again. Two live regions that are always mounted, so a screen reader hears a message that arrives
// later: errors interrupt (alert), everything else waits its turn (status). Base UI hides everything outside an open dialog from
// assistive technology except live regions carrying `aria-live`, and an error raised from inside a dialog is announced here.
export function ToastRegion({ messages, dismiss }: { messages: readonly ToastMessage[]; dismiss: (id: number) => void }) {
  return (
    <div className="fixed right-5 bottom-5 z-50 flex max-w-[min(28rem,calc(100vw-2.5rem))] flex-col items-end gap-2">
      <div role="alert" aria-live="assertive" aria-atomic="false" aria-relevant="additions" className="flex flex-col items-end gap-2">
        {messages
          .filter((message) => message.tone === 'error')
          .map((message) => (
            <ToastItem key={message.id} message={message} dismiss={dismiss} />
          ))}
      </div>
      <div role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions" className="flex flex-col items-end gap-2">
        {messages
          .filter((message) => message.tone === 'info')
          .map((message) => (
            <ToastItem key={message.id} message={message} dismiss={dismiss} />
          ))}
      </div>
    </div>
  );
}
