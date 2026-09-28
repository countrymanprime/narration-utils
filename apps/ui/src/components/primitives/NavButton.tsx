import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { faHouse } from '@fortawesome/free-solid-svg-icons';
import { TooltipTarget } from './Tooltip';

// The nav item as mock 01 draws it (mock-fidelity-primitives-and-components.prd.md Phase 8, ADR 0635), measured at 1440 px:
// 34 px tall on a 37 px pitch (the rail's group puts 3 px between items), radius 7; a 12 px icon centred at x 26 of the rail
// and the label from x 45 (the rail's 8 px inset, 10 px, the icon's fixed-width box, 11 px); the label Barlow Condensed 600
// at 13 px, tracked 0.11 em, in capitals. The current page is `--accent-soft` with its label in `--accent-strong`.
// The icon-only rail (`medium-rail`) keeps its 40 px square items and 16 px icons.
const ITEM =
  "relative flex h-[2.125rem] w-full items-center gap-[0.6875rem] rounded-[0.4375rem] border-0 pr-3 pl-[0.625rem] text-left font-['Barlow_Condensed',sans-serif] text-[0.8125rem] font-semibold tracking-[0.11em] uppercase [&_svg]:text-[0.75rem] hover:bg-[var(--surface-2)] hover:text-[var(--text)] disabled:opacity-[0.46] disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] [.medium-rail_&]:h-10 [.medium-rail_&]:justify-center [.medium-rail_&]:p-0 [.medium-rail_&_svg]:text-base";

export function NavButton({
  active,
  icon,
  children,
  onClick,
  iconOnly = false,
  disabled = false,
  disabledReason,
  count,
}: {
  active: boolean;
  icon: typeof faHouse;
  children: string;
  onClick: () => void;
  iconOnly?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** How many items wait on the page (mock 01's "14" beside Proof), drawn at the item's end; nothing passes one until a
   * page's count has data behind it (visual audit SH5). The wide rail only: the icon rail has no room for it. */
  count?: number;
}) {
  const showCount = !iconOnly && count !== undefined && count > 0;
  const button = (
    <button
      className={`${ITEM} ${active ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]' : 'text-[var(--text-muted)]'}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={iconOnly ? children : showCount ? `${children}, ${count}` : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <FontAwesomeIcon icon={icon} fixedWidth />
      {!iconOnly && children}
      {/* The count pill, measured on mock 01: 16 px tall, fully rounded, `--surface-2` in `--text-muted` (the current page's
          in `--accent-strong`), Barlow Condensed 600 at 11 px, its right edge 12 px inside the item. */}
      {showCount && (
        <span
          aria-hidden="true"
          className={`ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--surface-2)] px-[0.3125rem] text-[length:var(--font-size-label)] tracking-normal ${active ? 'text-[var(--accent-strong)]' : 'text-[var(--text-muted)]'}`}
        >
          {count}
        </span>
      )}
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
