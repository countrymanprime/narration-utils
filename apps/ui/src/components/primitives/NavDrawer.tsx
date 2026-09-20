import { Drawer } from '@base-ui/react/drawer';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useEffect, type ReactNode } from 'react';
import { useReturnFocusTarget } from './focusReturn';

// The navigation drawer of the narrow layout (AppShell's hamburger), on Base UI's Drawer (ADR 0047, 0051): a modal panel
// from the left edge with the app's scrim, so the page behind is hidden and unreachable, Tab loops inside, Escape, the
// scrim and the Close button close it, and focus returns to the menu button. It was inline markup in AppShell with none of
// that. The suite captures no phone viewport (ADR 0037), so the atlas stories are its visual record.
export function NavDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const finalFocus = useReturnFocusTarget(open);
  // The drawer exists only in the narrow layout (below Tailwind's `md`, 48rem). If the window grows past it while the drawer
  // is open, close it: the desktop navigation is already on screen and the menu button that opened it is gone.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia('(min-width: 48rem)');
    const closeWhenWide = () => {
      if (wide.matches) onClose();
    };
    wide.addEventListener('change', closeWhenWide);
    return () => wide.removeEventListener('change', closeWhenWide);
  }, [open, onClose]);
  return (
    <Drawer.Root
      open={open}
      modal
      swipeDirection="left"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop data-nav-drawer-backdrop className="fixed inset-0 z-[70] bg-[var(--backdrop)]" />
        <Drawer.Viewport className="fixed inset-0 z-[70] flex items-stretch justify-start">
          <Drawer.Popup
            finalFocus={finalFocus}
            className="relative flex h-full w-[min(17rem,86vw)] [transform:translateX(var(--drawer-swipe-movement-x,0px))] flex-col bg-[var(--surface)] shadow-[var(--shadow-lg)] outline-none"
          >
            <Drawer.Title className="sr-only">Navigation</Drawer.Title>
            <button
              type="button"
              className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              aria-label="Close navigation"
              onClick={onClose}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            {children}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
