import { useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faBookOpen, faFileLines, faFolder, faGear, faHouse, faMicrophone, faWaveSquare, faXmark } from '@fortawesome/free-solid-svg-icons';
import { NavButton } from '../primitives/NavButton';

const NAV = [
  { name: 'Home', path: '/', icon: faHouse },
  { name: 'Manuscript', path: '/manuscript', icon: faFileLines },
  { name: 'Proofing', path: '/proofing', icon: faWaveSquare },
  { name: 'Story Bible', path: '/story-bible', icon: faBookOpen },
];
const isActivePath = (pathname: string, path: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`));

export function AppShell({
  pathname,
  navigate,
  projectName,
  daw,
  children,
}: {
  pathname: string;
  navigate: (path: string) => void;
  projectName: string;
  daw: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const go = (next: string) => {
    setDrawerOpen(false);
    navigate(next);
  };
  const settingsActive = isActivePath(pathname, '/settings');
  const navigation = (
    <>
      <div className="brand-block">
        <span className="brand-icon">
          <FontAwesomeIcon icon={faMicrophone} fixedWidth />
        </span>
        <span className="leading-tight">
          <b className="brand-name">Narration</b>
          <span className="brand-subtitle">Console</span>
        </span>
      </div>
      <nav className="shell-nav">
        {NAV.map((item) => (
          <NavButton key={item.name} active={isActivePath(pathname, item.path)} icon={item.icon} onClick={() => go(item.path)}>
            {item.name}
          </NavButton>
        ))}
      </nav>
      <div className="shell-settings">
        <NavButton active={settingsActive} icon={faGear} onClick={() => go('/settings')}>
          Settings
        </NavButton>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">{navigation}</aside>
      <aside className="medium-rail" aria-label="Primary navigation">
        {NAV.map((item) => (
          <NavButton key={item.name} active={isActivePath(pathname, item.path)} icon={item.icon} onClick={() => go(item.path)}>
            {item.name}
          </NavButton>
        ))}
        <div className="mt-auto">
          <NavButton active={settingsActive} icon={faGear} onClick={() => go('/settings')}>
            Settings
          </NavButton>
        </div>
      </aside>
      {drawerOpen && (
        <div className="drawer-backdrop" onMouseDown={() => setDrawerOpen(false)}>
          <aside className="mobile-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <button className="icon-btn drawer-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>
              <FontAwesomeIcon icon={faXmark} />
            </button>
            {navigation}
          </aside>
        </div>
      )}
      <main className="shell-main">
        <header className="shell-header">
          <button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
            <FontAwesomeIcon icon={faBars} />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="section-label">Project</span>
            <FontAwesomeIcon icon={faFolder} style={{ color: 'var(--text-faint)' }} />
            <span className="truncate font-medium">{projectName}</span>
          </div>
          <span className="pill">
            <span className="led" />
            {daw}
          </span>
        </header>
        <div className={`shell-content scroll-chrome-hidden ${isActivePath(pathname, '/manuscript') ? 'manuscript-content' : ''}`}>{children}</div>
      </main>
    </div>
  );
}
