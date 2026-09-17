import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';

export function Dialog({
  title,
  onClose,
  actions,
  actionsAlign = 'between',
  children,
}: {
  title: string;
  onClose?: () => void;
  actions: ReactNode;
  // WorkDialog only ever shows one action at a time - 'between' would strand
  // it on the left, so it opts into 'end' instead.
  actionsAlign?: 'between' | 'end';
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="flex w-full max-w-[70vw] flex-col overflow-hidden rounded-[0.55rem] border"
        style={{ maxHeight: '80dvh', background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="panel-head flex-none">
          <h2 className="font-semibold">{title}</h2>
          {onClose && (
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
          )}
        </div>
        <div className="panel-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden break-words">{children}</div>
        <div
          className={`flex flex-none gap-2 border-t px-4 pb-4 pt-3 ${actionsAlign === 'between' ? 'justify-between' : 'justify-end'}`}
          style={{ borderColor: 'var(--border)' }}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}
