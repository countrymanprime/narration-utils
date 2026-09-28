import { Drawer } from '@base-ui/react/drawer';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ReactNode } from 'react';
import { useReturnFocusTarget } from './focusReturn';
import { IconButton } from './IconButton';

// Right-edge panel with a transparent click-away backdrop, on Base UI's Drawer (ADR 0047, 0051). It is a real modal
// panel: the page behind is hidden and unreachable, Tab loops inside, Escape and a press on the backdrop close it, and
// focus goes back to what opened it. The library keeps the panel mounted while it slides out and removes it afterwards,
// so a closed panel is not in the page at all (it used to stay mounted, invisible). All positioning is Tailwind: an
// unlayered legacy panel rule used to shadow these utilities and keep the panel permanently off-screen behind a live
// backdrop (ADR-0017). `data-slide-over` and `data-slide-over-backdrop` mark the panel and its backdrop for tests.
// `size="wide"` (ADR 0430) is for a panel that holds tables and lists a page used to (the engine panel), not a detail view.
// `headingLevel` 2 is for a panel that opens over any page and sits beside it rather than inside one of its sections (the
// engine panel again): its title then follows the page's <h1> directly, where the default <h3> would skip a level.
const WIDTH = { default: 'w-[min(20rem,100vw)]', wide: 'w-[min(44rem,100vw)]' } as const;

export function SlideOver({
  open,
  title,
  closeLabel = 'Close',
  size = 'default',
  headingLevel = 3,
  onClose,
  onEscape,
  children,
}: {
  open: boolean;
  title: ReactNode;
  closeLabel?: string;
  size?: keyof typeof WIDTH;
  headingLevel?: 2 | 3;
  onClose: () => void;
  // Runs before Escape closes the panel; returning true means the caller already handled the key
  // itself (for example, clearing a search - R8) and the panel should stay open.
  onEscape?: () => boolean;
  children: ReactNode;
}) {
  const finalFocus = useReturnFocusTarget(open);
  return (
    <Drawer.Root
      open={open}
      modal
      swipeDirection="right"
      onOpenChange={(next, eventDetails) => {
        if (next) return;
        if (eventDetails.reason === 'escape-key' && onEscape?.()) {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop data-slide-over-backdrop className="fixed inset-0 z-[45] bg-transparent" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-stretch justify-end">
          <Drawer.Popup
            data-slide-over
            finalFocus={finalFocus}
            className={`flex h-full ${WIDTH[size]} [transform:translateX(var(--drawer-swipe-movement-x,0px))] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] transition-transform duration-200 ease-out outline-none data-[ending-style]:[transform:translateX(100%)] data-[starting-style]:[transform:translateX(100%)] data-[swiping]:duration-0`}
          >
            {/* Content: a mouse drag inside the panel selects text instead of starting a swipe-to-dismiss (touch still swipes). */}
            <Drawer.Content className="flex min-h-0 flex-1 flex-col">
              {/* 59 px and a 1 px divider, the same header as Dialog's (chapter-track-link-control/02). */}
              <div className="flex min-h-[3.75rem] flex-none items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
                <Drawer.Title render={headingLevel === 2 ? <h2 /> : <h3 />} className="text-sm font-semibold">
                  {title}
                </Drawer.Title>
                <IconButton label={closeLabel} onClick={onClose}>
                  <FontAwesomeIcon icon={faXmark} />
                </IconButton>
              </div>
              {/* tabIndex: the body scrolls when content is tall, and a scrolling region must be reachable by keyboard. */}
              <div
                tabIndex={0}
                className="scroll-chrome-hidden flex-1 overflow-y-auto p-[1.1rem] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
              >
                {children}
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
