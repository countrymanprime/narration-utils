import { Drawer } from '@base-ui/react/drawer';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';

// Right-edge panel with a transparent click-away backdrop, on Base UI's Drawer (ADR 0047, 0051). It is a real modal
// panel: the page behind is hidden and unreachable, Tab loops inside, Escape and a press on the backdrop close it, and
// focus goes back to what opened it. The library keeps the panel mounted while it slides out and removes it afterwards,
// so a closed panel is not in the page at all (it used to stay mounted, invisible). All positioning is Tailwind: an
// unlayered legacy panel rule used to shadow these utilities and keep the panel permanently off-screen behind a live
// backdrop (ADR-0017). `data-slide-over` and `data-slide-over-backdrop` mark the panel and its backdrop for tests.
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
    <Drawer.Root
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop data-slide-over-backdrop className="fixed inset-0 z-[45] bg-transparent" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-stretch justify-end">
          <Drawer.Popup
            data-slide-over
            className="flex h-screen w-[min(20rem,100vw)] [transform:translateX(var(--drawer-swipe-movement-x,0px))] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-transform duration-200 ease-out outline-none data-[ending-style]:[transform:translateX(100%)] data-[starting-style]:[transform:translateX(100%)]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
              <Drawer.Title render={<h3 />} className="text-sm font-semibold">
                {title}
              </Drawer.Title>
              <button
                type="button"
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
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
