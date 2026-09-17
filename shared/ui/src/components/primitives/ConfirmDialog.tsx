import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirm,
  dangerLabel,
  danger,
  cancel,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirm: () => void;
  dangerLabel?: string;
  danger?: () => void;
  cancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      onClose={cancel}
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
            <Button variant="primary" onClick={confirm}>
              {confirmLabel}
            </Button>
          </div>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {body}
      </p>
      {children}
    </Dialog>
  );
}
