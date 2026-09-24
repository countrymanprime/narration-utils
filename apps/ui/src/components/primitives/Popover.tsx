import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';

// A layer above a dialog carries this attribute on its popup, so Dialog.tsx's Escape handler can tell that a key is
// meant for the popover that is showing (device pickers, a settings panel) and not for the dialog it sits in - the
// same reasoning as a hint's HINT_POPUP_ATTRIBUTE (hintLayer.ts), for a popup with real, focusable content instead of
// a read-only hover note.
export const POPOVER_POPUP_ATTRIBUTE = 'data-popover-popup';
export const POPOVER_POPUP_SELECTOR = `[${POPOVER_POPUP_ATTRIBUTE}]`;

// An interactive popup over other content: a click opens it, focus moves into it, Escape closes it and returns focus to
// the trigger, and a press outside closes it too (read-aloud-control-bar.prd.md's microphone device list and Settings
// panel; ADR 0047 wraps Base UI's Popover). Unlike the hint-style popup behind Tooltip's info icon (hover/focus,
// read-only, focus never moves in), this one is for a control a person operates. Sits above the dialog layer
// (z-[70], between Dialog's z-[60] and a hint's z-[1000]), so it works when opened from inside a full-size dialog.
export function Popover({
  trigger,
  label,
  side = 'bottom',
  align = 'start',
  open,
  defaultOpen,
  onOpenChange,
  children,
}: {
  // The trigger's own element (a `Button`, an `IconButton`), the same `render` pattern as `Menu` and `TooltipTarget`.
  trigger: ReactElement;
  // The popup's accessible name (its content is often controls, not a sentence a `aria-describedby` could read).
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  // Uncontrolled by default (Base UI keeps the open state); pass both to control it (closing it once a session starts).
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={8} collisionPadding={8} className="z-[70]">
          <BasePopover.Popup
            aria-label={label}
            {...{ [POPOVER_POPUP_ATTRIBUTE]: '' }}
            className="w-max min-w-48 rounded-[0.5rem] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)] outline-none"
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
