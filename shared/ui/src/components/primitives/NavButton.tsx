import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { faHouse } from '@fortawesome/free-solid-svg-icons';
import { TooltipTarget } from './Tooltip';

export function NavButton({
  active,
  icon,
  children,
  onClick,
  iconOnly = false,
}: {
  active: boolean;
  icon: typeof faHouse;
  children: string;
  onClick: () => void;
  iconOnly?: boolean;
}) {
  const button = (
    <button
      className={`rail-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-label={iconOnly ? children : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <FontAwesomeIcon icon={icon} fixedWidth />
      {!iconOnly && children}
    </button>
  );
  return iconOnly ? (
    <TooltipTarget text={children} className="rail-tooltip">
      {button}
    </TooltipTarget>
  ) : (
    button
  );
}
