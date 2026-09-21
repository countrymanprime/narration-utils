import { Popover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { isValidElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HINT_POPUP_ATTRIBUTE, HINT_POPUP_CLASSES } from './hintLayer';
import { lastInputWasKeyboard } from './inputModality';

// A hint waits for the pointer to rest for a second (keyboard focus shows it at once). It stays while it is hovered or
// focused, does not move when the pointer travels onto it, and Escape dismisses it, which is what WCAG 1.4.13 asks of
// content that appears on hover or focus (ADR 0049).
const HOVER_DELAY_MS = 1000;

// The popup sits 5 px clear of its target when it is above it and 13 px when it flipped below, within a pixel of where the
// previous hand-placed tooltip ended up. Base UI measures the popup, so it flips on its own.
const hintOffset = ({ side }: { side: string }): number => (side === 'top' ? 5 : 13);

// The provider stays as the one place the app and Storybook mount for tooltips, but it adds no Base UI provider: the
// library's provider groups neighbouring tooltips so the next one opens at once while another is showing, and every hint
// here waits its own second (each trigger carries the delay itself).
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// A hint for a control that carries its own label: the tooltip is for sighted users (the library documents it that way),
// so the child must already have an accessible name. A disabled child cannot take focus or hover, so the wrapper becomes
// the tab stop and carries the reason as its name.
export function TooltipTarget({ text, children, className = '', style }: { text: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const disabledChild = isValidElement(children) && Boolean((children.props as { disabled?: boolean }).disabled);
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        delay={HOVER_DELAY_MS}
        className={`inline-flex ${className}`}
        style={style}
        render={<span tabIndex={disabledChild ? 0 : undefined} role={disabledChild ? 'group' : undefined} aria-label={disabledChild ? text : undefined} />}
      >
        {children}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side="top" sideOffset={hintOffset} collisionPadding={8} className="z-[1000]">
          <BaseTooltip.Popup role="tooltip" {...{ [HINT_POPUP_ATTRIBUTE]: '' }} className={HINT_POPUP_CLASSES}>
            {text}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

// The "i" next to a label. It is a real button, so the keyboard reaches it and a screen reader announces it, and its text
// is its accessible description (a hint that only appears on hover is invisible to a screen reader). Hover (after a
// second), keyboard focus and a press open the popup; Escape closes it. `label` names the icon when a page has more than one, so a screen
// reader can tell them apart ("About reference material").
export function Tooltip({ text, label = 'More information' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const openedByFocus = useRef(false);
  const popupRef = useRef<HTMLDivElement>(null);
  // Escape closes the note wherever focus is (WCAG 1.4.13: dismissible without moving the pointer or focus). Base UI closes it from its own
  // handler, but inside a dialog that handler is not reached for a note opened by hover, so the icon listens itself while its note is open.
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      openedByFocus.current = false;
      setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [open]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // Enter or Space on an icon that keyboard focus has just opened would close it again: keep it open, and let the
        // next press close it.
        if (!next && details.reason === 'trigger-press' && openedByFocus.current) {
          openedByFocus.current = false;
          details.cancel();
          return;
        }
        if (!next) openedByFocus.current = false;
        setOpen(next);
      }}
    >
      <Popover.Trigger
        openOnHover
        delay={HOVER_DELAY_MS}
        aria-label={label}
        aria-description={text}
        onFocus={() => {
          if (!lastInputWasKeyboard()) return;
          openedByFocus.current = true;
          setOpen(true);
        }}
        onBlur={(event) => {
          // Focus moving onto the popup itself (a press on its text) is not leaving.
          if (popupRef.current?.contains(event.relatedTarget as Node | null)) return;
          openedByFocus.current = false;
          setOpen(false);
        }}
        className="ml-1 inline-flex size-[15px] cursor-help items-center justify-center rounded-full border border-[var(--non-text)] font-['IBM_Plex_Mono',monospace] text-[0.68rem] text-[var(--text-muted)] [text-transform:inherit] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        i
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={hintOffset} collisionPadding={8} className="z-[1000]">
          {/* The text is a description, not something to move into: focus stays on the button. */}
          <Popover.Popup
            ref={popupRef}
            role="tooltip"
            initialFocus={false}
            finalFocus={false}
            {...{ [HINT_POPUP_ATTRIBUTE]: '' }}
            className={HINT_POPUP_CLASSES}
          >
            {text}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
