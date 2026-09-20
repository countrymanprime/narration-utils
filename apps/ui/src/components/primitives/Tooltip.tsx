import { Popover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { isValidElement, useState, type CSSProperties, type ReactNode } from 'react';
import { HINT_POPUP_ATTRIBUTE, HINT_POPUP_CLASSES } from './hintLayer';
import { lastInputWasKeyboard } from './inputModality';

// A hint waits for the pointer to rest for a second (keyboard focus shows it at once). It stays while it is hovered or
// focused, does not move when the pointer travels onto it, and Escape dismisses it, which is what WCAG 1.4.13 asks of
// content that appears on hover or focus (ADR 0049).
const HOVER_DELAY_MS = 1000;

// The popup sits 5 px clear of its target when it is above it and 14 px when it flipped below, which is where the previous
// hand-placed tooltip ended up (a 10 px offset and a 4 px nudge). Base UI measures the popup, so it flips on its own.
const hintOffset = ({ side }: { side: string }): number => (side === 'top' ? 5 : 13);

// The provider is kept so the app and Storybook mount one place for tooltip behaviour. `timeout={0}` turns off the
// library's "a neighbouring tooltip opens at once" grouping: every hint waits its own second, as it always has.
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={HOVER_DELAY_MS} timeout={0}>
      {children}
    </BaseTooltip.Provider>
  );
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
// second), keyboard focus and a press open the popup; Escape closes it.
export function Tooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={HOVER_DELAY_MS}
        aria-label="More information"
        aria-description={text}
        onFocus={() => {
          if (lastInputWasKeyboard()) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex size-[15px] cursor-help items-center justify-center rounded-full border border-[var(--text-faint)] font-['IBM_Plex_Mono',monospace] text-[0.68rem] text-[var(--text-faint)] [text-transform:inherit] hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        i
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={hintOffset} collisionPadding={8} className="z-[1000]">
          {/* The text is a description, not something to move into: focus stays on the button. */}
          <Popover.Popup role="tooltip" initialFocus={false} finalFocus={false} {...{ [HINT_POPUP_ATTRIBUTE]: '' }} className={HINT_POPUP_CLASSES}>
            {text}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
