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
    <button type="button" disabled={disabled} onClick={onClick} className={`swatch-toggle ${active ? 'active' : ''}`}>
      {label}
    </button>
  );
  return title ? <TooltipTarget text={title}>{button}</TooltipTarget> : button;
}
