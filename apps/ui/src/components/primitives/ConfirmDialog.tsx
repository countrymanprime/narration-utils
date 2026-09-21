import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

// A third action (Discard & continue) needs both its label and its handler: a button without a name is unusable to a
// screen reader, so the type refuses one without the other.
type DangerAction = { danger?: undefined; dangerLabel?: undefined } | { danger: () => void; dangerLabel: string };

// A second, quieter way forward beside the confirm (the Story Bible asks to download a language model, and offers to build without one this
// once): the same rule, a label needs its handler.
type SecondaryAction = { secondary?: undefined; secondaryLabel?: undefined } | { secondary: () => void; secondaryLabel: string };

type ConfirmDialogProps = {
  title: string;
  // What the dialog asks. A string or richer content; it is the dialog's accessible description.
  body: ReactNode;
  confirmLabel: string;
  confirm: () => void;
  // 'danger' draws the confirm button red for an action that destroys data (D12: clear project data, remove a local
  // voice or model, delete an entry, merge and delete the source, replace and reset).
  confirmVariant?: 'primary' | 'danger';
  cancel: () => void;
  // false: Escape does not decline. For a confirm that has turned into a running download, where declining aborts the
  // download: the header button and Cancel stay as the deliberate ways out.
  escapeCancels?: boolean;
  // The confirmed action is running (ADR 0075): the confirm button says so and ignores a press, and nothing else in the dialog can be pressed,
  // so the action cannot be confirmed twice or walked away from half done. The caller closes the dialog when the action ends.
  pending?: boolean;
  children?: ReactNode;
} & DangerAction &
  SecondaryAction;

// Every confirm interrupts and needs an answer, so it is an alertdialog: Escape and Cancel decline, a press on the
// backdrop does nothing (ADR 0048).
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirm,
  confirmVariant = 'primary',
  dangerLabel,
  danger,
  secondaryLabel,
  secondary,
  cancel,
  escapeCancels = true,
  pending = false,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      variant="alert"
      onClose={pending ? undefined : cancel}
      escapeCloses={escapeCancels && !pending}
      description={body}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={cancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {danger && (
              <Button variant="danger" disabled={pending} onClick={danger}>
                {dangerLabel}
              </Button>
            )}
            {secondary && (
              <Button variant="ghost" disabled={pending} onClick={secondary}>
                {secondaryLabel}
              </Button>
            )}
            <Button variant={confirmVariant} pending={pending} onClick={confirm}>
              {confirmLabel}
            </Button>
          </div>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
