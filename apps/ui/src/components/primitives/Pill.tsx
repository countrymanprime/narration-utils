import { Toggle } from '@base-ui/react/toggle';
import { TooltipTarget } from './Tooltip';

/** `chip` is a standalone toggle (the Whisper model, chunk length): 32 px, its own border, the label in capitals. `segmented`
 * is one segment of a `ToggleGroup look="segmented"` container (mock-fidelity-primitives-and-components.prd.md Phase 5): no
 * border of its own (the container draws it), the label in its own case, and the height fills the container's inset. */
export type PillLook = 'chip' | 'segmented';

const LOOK_CLASS: Record<PillLook, (active: boolean) => string> = {
  chip: (active) =>
    `h-[var(--button-height)] rounded-[var(--radius-button)] border px-3 uppercase leading-none ${active ? 'active border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`,
  segmented: (active) =>
    `h-full rounded-[0.28rem] border-0 px-3 leading-none ${active ? 'active bg-[var(--accent)] text-[var(--accent-contrast)]' : 'text-[var(--text)]'}`,
};

// A toggle chip. Base UI's Toggle gives it `aria-pressed`, so a screen reader hears which chip of a group is selected. The
// callers use chips as a single choice, so pressing one (even the selected one) just reports a click and the caller decides.
// The `active` class stays, and stays mutually exclusive with the inactive classes (ADR 0017): tests and drivers select it.
export function Pill({
  label,
  active,
  disabled,
  title,
  look = 'chip',
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  look?: PillLook;
  onClick?: () => void;
}) {
  const button = (
    <Toggle
      pressed={active}
      disabled={disabled}
      onPressedChange={() => onClick?.()}
      className={`inline-flex items-center justify-center font-['Barlow_Condensed',sans-serif] text-[0.85rem] font-semibold tracking-[var(--tracking-button)] disabled:opacity-40 ${LOOK_CLASS[look](active)}`}
    >
      {label}
    </Toggle>
  );
  return title ? <TooltipTarget text={title}>{button}</TooltipTarget> : button;
}
