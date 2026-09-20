import { Toggle } from '@base-ui/react/toggle';
import { TooltipTarget } from './Tooltip';

// A toggle chip. Base UI's Toggle gives it `aria-pressed`, so a screen reader hears which chip of a group is selected. The
// callers use chips as a single choice, so pressing one (even the selected one) just reports a click and the caller decides.
// The `active` class stays, and stays mutually exclusive with the inactive classes (ADR 0017): tests and drivers select it.
export function Pill({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const button = (
    <Toggle
      pressed={active}
      disabled={disabled}
      onPressedChange={() => onClick?.()}
      className={`rounded-[0.35rem] border px-[0.65rem] py-[0.3rem] font-['Barlow_Condensed',sans-serif] text-[0.78rem] font-semibold tracking-[0.03em] uppercase disabled:opacity-40 ${active ? 'active border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
    >
      {label}
    </Toggle>
  );
  return title ? <TooltipTarget text={title}>{button}</TooltipTarget> : button;
}
