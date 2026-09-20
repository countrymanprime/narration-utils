import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

// A third action (Discard & continue) needs both its label and its handler: a button without a name is unusable to a
// screen reader, so the type refuses one without the other.
type DangerAction = { danger?: undefined; dangerLabel?: undefined } | { danger: () => void; dangerLabel: string };

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
  children?: ReactNode;
} & DangerAction;

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
  cancel,
  escapeCancels = true,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      variant="alert"
      onClose={cancel}
      escapeCloses={escapeCancels}
      description={body}
      actions={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {danger && (
              <Button variant="danger" onClick={danger}>
                {dangerLabel}
              </Button>
            )}
            <Button variant={confirmVariant} onClick={confirm}>
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
