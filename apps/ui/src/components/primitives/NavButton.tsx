import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { faHouse } from '@fortawesome/free-solid-svg-icons';
import { TooltipTarget } from './Tooltip';

export function NavButton({
  active,
  icon,
  children,
  onClick,
  iconOnly = false,
  disabled = false,
  disabledReason,
}: {
  active: boolean;
  icon: typeof faHouse;
  children: string;
  onClick: () => void;
  iconOnly?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const button = (
    <button
      className={`relative flex w-full items-center gap-[0.6rem] rounded-[0.4rem] border-0 px-[0.8rem] py-[0.55rem] text-left font-['Barlow_Condensed',sans-serif] text-base font-semibold tracking-[0.03em] uppercase hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-[0.46] disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] [.medium-rail_&]:h-10 [.medium-rail_&]:justify-center [.medium-rail_&]:p-0 [.medium-rail_&_svg]:text-base ${active ? 'bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? children : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <FontAwesomeIcon icon={icon} fixedWidth />
      {!iconOnly && children}
    </button>
  );
  return iconOnly || disabled ? (
    <TooltipTarget text={disabledReason || children} className={iconOnly ? '[.medium-rail_&]:w-full' : ''}>
      {button}
    </TooltipTarget>
  ) : (
    button
  );
}
