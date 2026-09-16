import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { faHouse } from '@fortawesome/free-solid-svg-icons';

export function NavButton({ active, icon, children, onClick }: { active: boolean; icon: typeof faHouse; children: string; onClick: () => void }) {
  return (
    <button className={`rail-btn ${active ? 'active' : ''}`} onClick={onClick}>
      <FontAwesomeIcon icon={icon} fixedWidth />
      {children}
    </button>
  );
}
