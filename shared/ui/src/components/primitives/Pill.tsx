import { TooltipTarget } from './Tooltip';

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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-[0.35rem] border px-[0.65rem] py-[0.3rem] font-['Barlow_Condensed',sans-serif] text-[0.78rem] font-semibold tracking-[0.03em] uppercase disabled:opacity-40 ${active ? 'active border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
    >
      {label}
    </button>
  );
  return title ? <TooltipTarget text={title}>{button}</TooltipTarget> : button;
}
