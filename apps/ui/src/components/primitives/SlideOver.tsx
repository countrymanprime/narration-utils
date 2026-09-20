import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

// Right-edge panel with a transparent click-away backdrop. The panel stays
// mounted so it can slide, and is `invisible` (not just translated) while
// closed so it can never take focus or clicks. All positioning is Tailwind:
// an unlayered legacy panel rule used to shadow these utilities and keep the
// panel permanently off-screen behind a live backdrop (ADR-0017).
export function SlideOver({
  open,
  title,
  closeLabel = 'Close',
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      {open && <div data-slide-over-backdrop className="fixed inset-0 z-[45] bg-transparent" onMouseDown={onClose} />}
      <aside
        data-slide-over
        data-open={open}
        aria-hidden={!open}
        className={`fixed top-0 right-0 z-50 flex h-screen w-[min(20rem,100vw)] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-[transform,visibility] duration-200 ease-out ${open ? 'visible translate-x-0' : 'invisible translate-x-full'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        {/* tabIndex: the body scrolls when content is tall, and a scrolling region must be reachable by keyboard. */}
        <div
          tabIndex={0}
          className="scroll-chrome-hidden flex-1 overflow-y-auto p-[1.1rem] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          {children}
        </div>
      </aside>
    </>
  );
}
