import { useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBars,
  faBookOpen,
  faFileLines,
  faFolder,
  faGaugeHigh,
  faGear,
  faHouse,
  faLayerGroup,
  faListCheck,
  faMicrophone,
  faScroll,
  faWaveSquare,
} from '@fortawesome/free-solid-svg-icons';
import { NavButton } from '../primitives/NavButton';
import { NavDrawer } from '../primitives/NavDrawer';
import { IconButton } from '../primitives/IconButton';
import { TooltipTarget } from '../primitives/Tooltip';
import { combinedRequiredReason } from '../../dawAvailability';
import { DemoBanner } from './DemoBanner';

// requiresManuscript/requiresDaw name what each nav item is gated on (PRD project-workspace-and-daw-link.prd.md, Open
// Question W16): only Proofing needs a linked DAW project file today - Tracks reads the project's REAPER file
// directly through its own discovery flow and is not gated here.
const NAV = [
  { name: 'Home', path: '/', icon: faHouse, requiresManuscript: false, requiresDaw: false },
  { name: 'Manuscript', path: '/manuscript', icon: faFileLines, requiresManuscript: true, requiresDaw: false },
  { name: 'Proofing', path: '/proofing', icon: faWaveSquare, requiresManuscript: true, requiresDaw: true },
  { name: 'Story Bible', path: '/story-bible', icon: faBookOpen, requiresManuscript: true, requiresDaw: false },
  { name: 'Teleprompter', path: '/teleprompter', icon: faScroll, requiresManuscript: true, requiresDaw: false },
  { name: 'Tracks', path: '/tracks', icon: faLayerGroup, requiresManuscript: false, requiresDaw: false },
  // Every check's findings in one queue (review-dashboard-and-findings-adoption.prd.md Phase 5). Not gated: take-review findings need
  // no manuscript, and the page says itself when there is nothing to review yet.
  { name: 'Review', path: '/review', icon: faListCheck, requiresManuscript: false, requiresDaw: false },
  // Measuring rendered chapter files (diagnostics-delivery-and-cleanup-tools.prd.md Phase 5). Not gated: it reads files the narrator
  // picks, so it needs neither a manuscript nor a REAPER project.
  { name: 'Delivery', path: '/delivery', icon: faGaugeHigh, requiresManuscript: false, requiresDaw: false },
];
const isActivePath = (pathname: string, path: string) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`));

export function AppShell({
  pathname,
  navigate,
  projectName,
  hasManuscript,
  dawFileLinked,
  dawReachable = false,
  dawProjectMatches = false,
  onLinkDawFile,
  linkingDawFile = false,
  children,
}: {
  pathname: string;
  navigate: (path: string) => void;
  projectName: string;
  hasManuscript: boolean;
  dawFileLinked: boolean;
  /** Whether a live REAPER heartbeat has been seen recently (Phase 7, ADR 0092); false also covers "unknown". */
  dawReachable?: boolean;
  /** Whether that heartbeat's open project is the linked file (Phase 7); only meaningful when dawReachable is true. */
  dawProjectMatches?: boolean;
  onLinkDawFile: () => void;
  /** True while the shared DAW-link binding is running for any of its three call sites (ADR 0075's ref guard). */
  linkingDawFile?: boolean;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const go = (next: string) => {
    setDrawerOpen(false);
    navigate(next);
  };
  const settingsActive = isActivePath(pathname, '/settings');
  const isDisabled = (item: (typeof NAV)[number]) => (item.requiresManuscript && !hasManuscript) || (item.requiresDaw && !dawFileLinked);
  const requiredReason = (item: (typeof NAV)[number]) =>
    combinedRequiredReason({ manuscript: item.requiresManuscript && !hasManuscript, dawFile: item.requiresDaw && !dawFileLinked });
  // Phase 7 (ADR 0092, W10): dawReachable/dawProjectMatches are now real facts (a live PROJECT_STATUS heartbeat),
  // not the permanently-unknown placeholders Phase 4 shipped. The mismatch state only fires when REAPER is
  // confirmed reachable and disagrees with the linked file - a stale or absent heartbeat still reads as the plain
  // "linked" state (PRD W15: "No DAW detected" over-promises when only the absence of a session dir is knowable).
  const dawMismatch = dawFileLinked && dawReachable && !dawProjectMatches;
  const pillLabel = dawMismatch ? 'Wrong REAPER project open' : dawFileLinked ? 'REAPER project linked' : 'No REAPER project linked';
  const pillTooltip = dawMismatch
    ? 'REAPER has a different project open than the one linked here. Click to link the open project, or switch REAPER to the linked file.'
    : dawFileLinked
      ? 'Change the linked REAPER project (.rpp) file'
      : 'Link a REAPER project (.rpp) file';
  const pillDotStyle = dawMismatch
    ? { backgroundColor: 'var(--warn)', boxShadow: '0 0 5px var(--warn)' }
    : dawFileLinked
      ? { backgroundColor: 'var(--character)', boxShadow: '0 0 5px var(--character)' }
      : { backgroundColor: 'var(--non-text)' };
  const navigation = (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-4">
        <span className="flex size-7 items-center justify-center rounded bg-[var(--accent)] text-[var(--accent-contrast)]">
          <FontAwesomeIcon icon={faMicrophone} fixedWidth />
        </span>
        <span className="leading-tight">
          <b className="block font-['Barlow_Condensed',sans-serif] text-sm tracking-[0.02em] uppercase">Narration</b>
          <span className="block font-['Barlow_Condensed',sans-serif] text-[0.65rem] tracking-[0.08em] text-[var(--text-muted)] uppercase">Console</span>
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
            disabledReason={requiredReason(item)}
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
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg)]">
      <DemoBanner />
      <div className="flex min-h-0 flex-1 overflow-hidden">
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
              disabledReason={requiredReason(item)}
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
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          {navigation}
        </NavDrawer>
        {/* tabIndex -1: a dialog that closes with nothing to give focus back to (its opener is gone) sends focus into <main> (its first control, or <main> itself), not to <body>. */}
        <main tabIndex={-1} className="flex min-w-0 flex-1 flex-col overflow-hidden focus:outline-none">
          <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-sm md:px-5">
            <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)} className="hidden max-md:inline-flex">
              <FontAwesomeIcon icon={faBars} />
            </IconButton>
            <div className="flex min-w-0 items-center gap-2">
              <span className="section-label">Project</span>
              <FontAwesomeIcon icon={faFolder} style={{ color: 'var(--non-text)' }} />
              <span className="truncate font-medium">{projectName}</span>
            </div>
            <TooltipTarget text={pillTooltip}>
              <button
                type="button"
                onClick={onLinkDawFile}
                disabled={linkingDawFile}
                aria-busy={linkingDawFile || undefined}
                aria-label={`${pillLabel} — ${pillTooltip}`}
                className="inline-flex items-center gap-[0.4rem] rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-[0.6rem] py-[0.2rem] font-['Barlow_Condensed',sans-serif] text-[0.8rem] font-semibold tracking-[0.03em] hover:border-[var(--accent)] disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="size-[7px] flex-none rounded-full" style={pillDotStyle} />
                {pillLabel}
              </button>
            </TooltipTarget>
          </header>
          <div className={`scroll-chrome-hidden relative flex-1 overflow-y-auto ${isActivePath(pathname, '/manuscript') ? 'p-0' : 'p-4 md:p-6'}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
