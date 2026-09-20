import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useRef, useState, type ReactNode } from 'react';

// The one modal shell (ADR 0001, 0002, 0047). Base UI supplies the behaviour: the page behind is hidden from assistive
// technology and unreachable by Tab, Tab loops inside, focus moves in on open and comes back on close. This wrapper owns
// the policy on top of it:
// - Escape closes a dialog that has somewhere to go (`onClose`, or `onEscape` when there is no header button) and is
//   ignored otherwise, so a job that is still running is never dismissed by a stray key.
// - A press on the backdrop never closes it: an accidental click on the scrim must not discard a confirm.
// - Focus lands on the body region (so a screen reader reads the message first) unless a child asked for focus with
//   `autoFocus`, and returns to the element that opened the dialog, or to the page's <main> when that is gone.
// Dialogs are mounted conditionally (`{open && <Dialog />}`), so `open` is always true here and the parent's unmount is
// the close; no exit animation exists to wait for.
export function Dialog({
  title,
  onClose,
  onEscape,
  description,
  variant = 'dialog',
  actions,
  actionsAlign = 'between',
  children,
}: {
  title: string;
  // Shows the header Close button and lets Escape close the dialog.
  onClose?: () => void;
  // Escape only, for a dialog whose header has no Close button (WorkDialog closes from its action row once the job ends).
  onEscape?: () => void;
  // What the dialog asks, shown first in the body. It is what `aria-describedby` points at, which an alert dialog needs.
  description?: ReactNode;
  // 'alert' is an alertdialog: it interrupts and wants an answer (every ConfirmDialog).
  variant?: 'dialog' | 'alert';
  actions: ReactNode;
  // WorkDialog only ever shows one action at a time - 'between' would strand
  // it on the left, so it opts into 'end' instead.
  actionsAlign?: 'between' | 'end';
  children: ReactNode;
}) {
  // Both families share their parts; typing them as one keeps the wrapper a single shell.
  const Parts = (variant === 'alert' ? AlertDialog : BaseDialog) as typeof BaseDialog;
  const popupRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // What had focus when the dialog mounted: the button that opened it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const dismiss = onClose ?? onEscape;

  const initialFocus = () => {
    const focused = document.activeElement;
    // An `autoFocus` child has already taken focus by now; leave it there.
    if (focused instanceof HTMLElement && focused !== popupRef.current && popupRef.current?.contains(focused)) return focused;
    return bodyRef.current;
  };
  const finalFocus = () => {
    if (opener?.isConnected && opener !== document.body) return opener;
    // The opener is gone (the click removed it, or one dialog replaced another): the landmark is the next best place.
    return document.querySelector<HTMLElement>('main') ?? true;
  };

  return (
    <Parts.Root
      open
      disablePointerDismissal
      onOpenChange={(_open, details) => {
        if (details.reason !== 'escape-key') return;
        if (!dismiss || details.event.defaultPrevented) details.cancel();
        else dismiss();
      }}
    >
      <Parts.Portal>
        <Parts.Backdrop data-dialog-backdrop className="fixed inset-0 z-[60] bg-[var(--backdrop)]" />
        <Parts.Viewport className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <Parts.Popup
            ref={popupRef}
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            className="flex w-full max-w-[70vw] flex-col overflow-hidden rounded-[0.55rem] border focus:outline-none"
            style={{ maxHeight: '80dvh', background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
              <Parts.Title className="font-semibold">{title}</Parts.Title>
              {onClose && (
                <button
                  type="button"
                  className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  aria-label="Close"
                  onClick={onClose}
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </div>
            {/* tabIndex: the body scrolls when content is tall, and a scrolling region must be reachable by keyboard. */}
            <div
              ref={bodyRef}
              tabIndex={0}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-[1.1rem] break-words focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
            >
              {description !== undefined && (
                <Parts.Description render={typeof description === 'string' ? <p /> : <div />} className="text-sm text-[var(--text-muted)]">
                  {description}
                </Parts.Description>
              )}
              {children}
            </div>
            <div
              className={`flex flex-none gap-2 border-t px-4 pt-3 pb-4 ${actionsAlign === 'between' ? 'justify-between' : 'justify-end'}`}
              style={{ borderColor: 'var(--border)' }}
            >
              {actions}
            </div>
          </Parts.Popup>
        </Parts.Viewport>
      </Parts.Portal>
    </Parts.Root>
  );
}
