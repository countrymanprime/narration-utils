import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';

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
    <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-dialog">
        <div className="panel-head">
          <h2 className="font-semibold">{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={cancel}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className="panel-body">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {body}
          </p>
          {children}
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
            {danger && (
              <button className="btn btn-danger" onClick={danger}>
                {dangerLabel}
              </button>
            )}
            <button className="btn btn-primary" onClick={confirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
