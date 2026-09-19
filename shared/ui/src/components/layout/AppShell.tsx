import { useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBars,
  faBookOpen,
  faFileLines,
  faFolder,
  faGear,
  faHouse,
  faLayerGroup,
  faMicrophone,
  faScroll,
  faWaveSquare,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { NavButton } from '../primitives/NavButton';

// alwaysEnabled items don't depend on an imported manuscript - Tracks reads
// the project's REAPER file directly, independent of the manuscript feature.
const NAV = [
  { name: 'Home', path: '/', icon: faHouse, alwaysEnabled: true },
  { name: 'Manuscript', path: '/manuscript', icon: faFileLines, alwaysEnabled: false },
  { name: 'Proofing', path: '/proofing', icon: faWaveSquare, alwaysEnabled: false },
  { name: 'Story Bible', path: '/story-bible', icon: faBookOpen, alwaysEnabled: false },
  { name: 'Teleprompter', path: '/teleprompter', icon: faScroll, alwaysEnabled: false },
  { name: 'Tracks', path: '/tracks', icon: faLayerGroup, alwaysEnabled: true },
];
const MANUSCRIPT_REQUIRED_REASON = 'Import a manuscript to unlock this page.';
const isActivePath = (pathname: string, path: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`));

export function AppShell({
  pathname,
  navigate,
  projectName,
  daw,
  hasManuscript,
  children,
}: {
  pathname: string;
  navigate: (path: string) => void;
  projectName: string;
  daw: string;
  hasManuscript: boolean;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const go = (next: string) => {
    setDrawerOpen(false);
    navigate(next);
  };
  const settingsActive = isActivePath(pathname, '/settings');
  const isDisabled = (item: (typeof NAV)[number]) => !item.alwaysEnabled && !hasManuscript;
  const navigation = (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-4">
        <span className="flex size-7 items-center justify-center rounded bg-[var(--accent)] text-[var(--accent-contrast)]">
          <FontAwesomeIcon icon={faMicrophone} fixedWidth />
        </span>
        <span className="leading-tight">
          <b className="block font-['Barlow_Condensed',sans-serif] text-sm tracking-[0.02em] uppercase">Narration</b>
          <span className="block font-['Barlow_Condensed',sans-serif] text-[0.65rem] tracking-[0.08em] text-[var(--text-faint)] uppercase">Console</span>
        </span>
      </div>
      <nav className="flex-1 p-2">
        {NAV.map((item) => (
          <NavButton
            key={item.name}
            active={isActivePath(pathname, item.path)}
            icon={item.icon}
            onClick={() => go(item.path)}
            disabled={isDisabled(item)}
            disabledReason={isDisabled(item) ? MANUSCRIPT_REQUIRED_REASON : undefined}
          >
            {item.name}
          </NavButton>
        ))}
      </nav>
      <div className="border-t border-[var(--border)] p-2">
        <NavButton active={settingsActive} icon={faGear} onClick={() => go('/settings')}>
          Settings
        </NavButton>
      </div>
    </>
  );
  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg)]">
      <aside className="hidden w-56 flex-none flex-col border-r border-[var(--border)] bg-[var(--surface)] min-[1400px]:flex">{navigation}</aside>
      <aside
        className="medium-rail hidden w-14 flex-none flex-col gap-1 border-r border-[var(--border)] bg-[var(--surface)] p-2 md:max-[1399px]:flex"
        aria-label="Primary navigation"
      >
        {NAV.map((item) => (
          <NavButton
            key={item.name}
            active={isActivePath(pathname, item.path)}
            icon={item.icon}
            onClick={() => go(item.path)}
            iconOnly
            disabled={isDisabled(item)}
            disabledReason={isDisabled(item) ? MANUSCRIPT_REQUIRED_REASON : undefined}
          >
            {item.name}
          </NavButton>
        ))}
        <div className="mt-auto">
          <NavButton active={settingsActive} icon={faGear} onClick={() => go('/settings')} iconOnly>
            Settings
          </NavButton>
        </div>
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-[70] bg-[var(--backdrop)]" onMouseDown={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-[min(17rem,86vw)] flex-col bg-[var(--surface)] shadow-[var(--shadow-lg)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            {navigation}
          </aside>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-sm md:px-5">
          <button
            className="hidden size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] max-md:inline-flex"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <FontAwesomeIcon icon={faBars} />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="section-label">Project</span>
            <FontAwesomeIcon icon={faFolder} style={{ color: 'var(--text-faint)' }} />
            <span className="truncate font-medium">{projectName}</span>
          </div>
          <span className="inline-flex items-center gap-[0.4rem] rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-[0.6rem] py-[0.2rem] font-['Barlow_Condensed',sans-serif] text-[0.8rem] font-semibold tracking-[0.03em]">
            <span className="size-[7px] flex-none rounded-full bg-[var(--character)] shadow-[0_0_5px_var(--character)]" />
            {daw}
          </span>
        </header>
        <div className={`scroll-chrome-hidden flex-1 overflow-y-auto ${isActivePath(pathname, '/manuscript') ? 'p-0' : 'p-4 md:p-6'}`}>{children}</div>
      </main>
    </div>
  );
}
