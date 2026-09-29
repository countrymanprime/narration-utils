import { Fragment, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft,
  faArrowRight,
  faBars,
  faBookOpen,
  faCircleDot,
  faFileLines,
  faFolder,
  faGaugeHigh,
  faGear,
  faHouse,
  faMicrophone,
  faMinus,
  faPlus,
  faRotateLeft,
  faWaveSquare,
} from '@fortawesome/free-solid-svg-icons';
import { NavButton } from '../primitives/NavButton';
import { NavDrawer } from '../primitives/NavDrawer';
import { IconButton } from '../primitives/IconButton';
import { Button } from '../primitives/Button';
import { TooltipTarget } from '../primitives/Tooltip';
import { dawCapabilityGate } from '../../dawAvailability';
import { DemoBanner } from './DemoBanner';
import { EngineChip, type EngineState } from './EngineChip';
import { TimerChip, type RunningTimer } from './TimerChip';
import type { NavCounts } from './useNavCounts';

// requiresManuscript/requiresDaw name what each nav item is gated on (PRD project-workspace-and-daw-link.prd.md, Open
// Question W16): no item needs a linked DAW project file since Proof replaced Proofing (stage-navigation-and-page-replacement.prd.md
// Phase 5: its compare run gates itself inside the chapter view). The requiresDaw field stays for the next item that needs one.
// The Production stage's page (stage-navigation-and-page-replacement.prd.md Phase 2): the Production home at `/`, which replaced Home.
// Not gated: with no manuscript it is where the import is.
const PRODUCTION = { name: 'Production', path: '/', icon: faHouse, requiresManuscript: false, requiresDaw: false };
const SCRIPT = { name: 'Script', path: '/script', icon: faFileLines, requiresManuscript: true, requiresDaw: false };
const STORY_BIBLE = { name: 'Story Bible', path: '/story-bible', icon: faBookOpen, requiresManuscript: true, requiresDaw: false };
// The Record stage's one page (stage-navigation-and-page-replacement.prd.md Phase 4): it replaced the Teleprompter page. Its
// icon is a record dot, as the stage-nav mocks draw it (audit SH12).
const BOOTH = { name: 'Booth', path: '/booth', icon: faCircleDot, requiresManuscript: true, requiresDaw: false };
// Proof (stage-navigation-and-page-replacement.prd.md Phase 5): the book's notes at /proof and a chapter's view at /proof/:chapterId,
// replacing Review and Proofing. Not gated: take-review notes need no manuscript, the page says itself when there is nothing to
// proof yet, and the compare run inside a chapter view gates itself on the DAW (CapabilityGate).
const PROOF = { name: 'Proof', path: '/proof', icon: faWaveSquare, requiresManuscript: false, requiresDaw: false };
// Measuring rendered chapter files (diagnostics-delivery-and-cleanup-tools.prd.md Phase 5). Not gated: it reads files the narrator
// picks, so it needs neither a manuscript nor a REAPER project.
// Pickups (stage-navigation-and-page-replacement.prd.md Phase 7): the proofer's pickup list, replacing the Tracks page's
// Pickups dialog. Not gated: its import, export and jumps talk to REAPER and each says itself when REAPER is not there.
const PICKUPS = { name: 'Pickups', path: '/pickups', icon: faRotateLeft, requiresManuscript: false, requiresDaw: false };
const MASTER_QC = { name: 'Master & QC', path: '/master', icon: faGaugeHigh, requiresManuscript: false, requiresDaw: false };

// Grouped by production stage (stage-navigation-and-page-replacement.prd.md Phase 1, ADR 0407 item 3): Production,
// Prep, Record, Review, Finish, with Settings pinned at the foot (below, not a group). Phase 1 holds each existing
// page under its current name in the group its job belongs to (D3/Q5): a page is renamed only in the phase that
// ships its replacement. Phase 2 made the Production page the home at `/` (`/production` redirects there).
type NavItem = typeof PRODUCTION;
const NAV_COUNT_KEYS: Record<string, keyof NavCounts> = { 'Story Bible': 'storyBible', Proof: 'proof', Pickups: 'pickups' };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Production', items: [PRODUCTION] },
  { label: 'Prep', items: [SCRIPT, STORY_BIBLE] },
  { label: 'Record', items: [BOOTH] },
  { label: 'Review', items: [PROOF, PICKUPS] },
  { label: 'Finish', items: [MASTER_QC] },
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
  onOpenEnginePanel,
  linkingDawFile = false,
  engine = 'daw',
  timer = null,
  navCounts = {},
  history,
  zoom,
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
  /** Opens the engine panel from the header's engine chip (stage-navigation-and-page-replacement.prd.md Phase 6). */
  onOpenEnginePanel: () => void;
  /** True while the shared DAW-link binding is running for any of its three call sites (ADR 0075's ref guard). */
  linkingDawFile?: boolean;
  /** Which engine the header's chip shows (stage-navigation-and-page-replacement.prd.md Phase 1, Q7); UI-only until native recording picks 'builtin'. */
  engine?: EngineState;
  /** The production stage timer while it runs (Phase 2's timer chip); null hides the chip. */
  timer?: RunningTimer | null;
  /** The rail's count badges (mock 05), from useNavCounts: a missing or zero count draws none. */
  navCounts?: NavCounts;
  /** Page-level Back/Forward (app-navigation-and-zoom-controls.prd.md Phase 1): already guarded and gated by App.tsx. */
  history: { canGoBack: boolean; canGoForward: boolean; back: () => void; forward: () => void };
  /** The header's zoom group (app-navigation-and-zoom-controls.prd.md Phase 2): `useZoom`'s own state and actions. */
  zoom: { percent: number; canZoomOut: boolean; canZoomIn: boolean; zoomIn: () => void; zoomOut: () => void; reset: () => void; announcement: string };
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const go = (next: string) => {
    setDrawerOpen(false);
    navigate(next);
  };
  const settingsActive = isActivePath(pathname, '/settings');
  // A requiresDaw item needs a linked file only: the one that also read the DAW port's `review` capability was Proofing, whose
  // compare run now gates itself in the Proof chapter view (stage-navigation-and-page-replacement.prd.md Phase 5, CapabilityGate).
  const gateFor = (item: NavItem) =>
    dawCapabilityGate(
      { manuscript: item.requiresManuscript && !hasManuscript, dawFile: item.requiresDaw && !dawFileLinked },
      { level: 'supported', available: true },
    );
  const isDisabled = (item: NavItem) => gateFor(item).disabled;
  const requiredReason = (item: NavItem) => gateFor(item).reason;
  const backTooltip = history.canGoBack ? 'Back (Alt+Left)' : 'Back (Alt+Left): no earlier page in this project';
  const forwardTooltip = history.canGoForward ? 'Forward (Alt+Right)' : 'Forward (Alt+Right): no later page yet';
  // The header's zoom group (Phase 2, Q1/Q9): the readout is always shown and is itself the reset button, disabled
  // only at exactly 100% (Q9 A). The reset tooltip's wording is the approved mock's (04-tooltip-reset-zoom.webp).
  const zoomOutTooltip = 'Zoom out (Ctrl+-)';
  const zoomInTooltip = 'Zoom in (Ctrl+=)';
  const zoomResetTooltip = 'Reset zoom to 100% (Ctrl+0)';
  const zoomAtDefault = zoom.percent === 100;
  // The wide rail's group heading (Q6): a visible `section-label`, referenced by the group's `aria-labelledby` so a
  // screen reader hears the stage name once, not twice. Shared by the sidebar and the drawer, which render the same markup.
  const groupHeadingId = (label: string) => `nav-group-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const navigation = (
    <>
      {/* The brand block (mock 01, Phase 8): 62 px and its rule; the 30 px mark at 16 px in, radius 6; the name Barlow
          Condensed 700 at 13 px over a 10 px muted tagline, 10 px after the mark. */}
      <div className="flex h-[3.9375rem] flex-none items-center gap-[0.625rem] border-b border-[var(--border)] px-4">
        <span className="flex size-[1.875rem] flex-none items-center justify-center rounded-[var(--radius-button)] bg-[var(--accent)] text-[0.875rem] text-[var(--accent-contrast)]">
          <FontAwesomeIcon icon={faMicrophone} fixedWidth />
        </span>
        <span className="pb-[0.125rem] font-['Barlow_Condensed',sans-serif] leading-none uppercase">
          <b className="block text-[0.8125rem] font-bold tracking-[0.11em]">Narration</b>
          <span className="mt-[0.4375rem] block text-[0.625rem] font-semibold tracking-[0.1em] text-[var(--text-muted)]">Studio</span>
        </span>
      </div>
      <nav className="flex-1 px-2 pt-[0.5625rem] pb-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} role="group" aria-labelledby={groupHeadingId(group.label)} className="flex flex-col gap-[0.1875rem]">
            {/* Every group is headed (ADR 0407 item 3): 10 px capitals at x 19, 29 px deep with the gap above the group's first
                item, so a heading sits 32 px between two items as mock 01 spaces it. Mock 01 draws no heading over its first group,
                but that group also holds a Schedule item the app has no page for (ADR 0407 item 5); the drawn heading takes most of
                that item's place, so every later item sits within 8 px of where the benchmark mocks draw it (ADR 0636). */}
            <div
              id={groupHeadingId(group.label)}
              className="section-label px-[0.625rem] pt-[0.6875rem] pb-[0.375rem] text-[0.625rem] leading-[0.75rem] tracking-[0.1em]"
            >
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavButton
                key={item.name}
                active={isActivePath(pathname, item.path)}
                icon={item.icon}
                onClick={() => go(item.path)}
                disabled={isDisabled(item)}
                disabledReason={requiredReason(item)}
                count={NAV_COUNT_KEYS[item.name] ? navCounts[NAV_COUNT_KEYS[item.name]] : undefined}
              >
                {item.name}
              </NavButton>
            ))}
          </div>
        ))}
      </nav>
      {/* The foot: its rule, then Settings 10 px from it, 4 px further in than the items above (mock 01). */}
      <div className="flex-none border-t border-[var(--border)] px-3 py-[0.625rem]">
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
        <aside className="hidden w-54 flex-none flex-col border-r border-[var(--border)] bg-[var(--surface)] min-[1400px]:flex">{navigation}</aside>
        <aside
          className="medium-rail hidden w-14 flex-none flex-col gap-1 border-r border-[var(--border)] bg-[var(--surface)] p-2 md:max-[1399px]:flex"
          aria-label="Primary navigation"
        >
          {NAV_GROUPS.map((group, index) => (
            <Fragment key={group.label}>
              {/* Icon-only rail (Q6): a thin divider between groups, not a text heading; the group keeps its accessible
                  name via aria-label so a screen reader still hears the stage. The divider is decorative only. */}
              {index > 0 && <div aria-hidden="true" className="m-1 border-t border-[var(--border)]" />}
              <div role="group" aria-label={group.label} className="flex flex-col gap-1">
                {group.items.map((item) => (
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
              </div>
            </Fragment>
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
          <header className="flex h-13 flex-none items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 text-sm md:px-5">
            <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)} className="hidden max-md:inline-flex">
              <FontAwesomeIcon icon={faBars} />
            </IconButton>
            {/* Page history (Phase 1, Q1 A): walks the app's own page moves only, through App.tsx's guards. */}
            <div className="flex flex-none items-center gap-1" role="group" aria-label="Page history">
              <TooltipTarget text={backTooltip}>
                <IconButton label="Back" disabledReason={history.canGoBack ? undefined : backTooltip} onClick={history.back}>
                  <FontAwesomeIcon icon={faArrowLeft} />
                </IconButton>
              </TooltipTarget>
              <TooltipTarget text={forwardTooltip}>
                <IconButton label="Forward" disabledReason={history.canGoForward ? undefined : forwardTooltip} onClick={history.forward}>
                  <FontAwesomeIcon icon={faArrowRight} />
                </IconButton>
              </TooltipTarget>
            </div>
            {/* Left-aligned after the history buttons, as the mocks draw it; it takes the free width and truncates first. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* Below `md` the two new history buttons leave less room (Phase 1, Q10 A): the label and
                  folder icon drop first, and the project name is left to truncate on its own. */}
              <span className="section-label max-md:hidden">Project</span>
              <FontAwesomeIcon icon={faFolder} style={{ color: 'var(--non-text)' }} className="max-md:hidden" />
              <span className="truncate font-medium">{projectName}</span>
            </div>
            {timer && <TimerChip timer={timer} />}
            {/* The zoom group (Phase 2, D79/ADR 0407): after a running timer chip, before the engine chip. */}
            <div className="flex flex-none items-center gap-1" role="group" aria-label="Zoom">
              <TooltipTarget text={zoomOutTooltip}>
                <IconButton label="Zoom out" disabledReason={zoom.canZoomOut ? undefined : zoomOutTooltip} onClick={zoom.zoomOut}>
                  <FontAwesomeIcon icon={faMinus} />
                </IconButton>
              </TooltipTarget>
              <TooltipTarget text={zoomResetTooltip}>
                <Button
                  variant="secondary"
                  aria-label={`Reset zoom to 100% (now ${zoom.percent}%)`}
                  aria-disabled={zoomAtDefault || undefined}
                  onClick={zoomAtDefault ? (event) => event.preventDefault() : zoom.reset}
                  className="h-8 min-w-14 justify-center px-2 py-0 font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8rem] font-normal tracking-normal normal-case aria-disabled:pointer-events-none aria-disabled:opacity-40"
                >
                  {zoom.percent}%
                </Button>
              </TooltipTarget>
              <TooltipTarget text={zoomInTooltip}>
                <IconButton label="Zoom in" disabledReason={zoom.canZoomIn ? undefined : zoomInTooltip} onClick={zoom.zoomIn}>
                  <FontAwesomeIcon icon={faPlus} />
                </IconButton>
              </TooltipTarget>
              {/* A level change is announced once, politely, debounced by useZoom - not on every wheel notch (Solution Detail). */}
              <div aria-live="polite" className="sr-only">
                {zoom.announcement}
              </div>
            </div>
            <EngineChip
              engine={engine}
              dawFileLinked={dawFileLinked}
              dawReachable={dawReachable}
              dawProjectMatches={dawProjectMatches}
              onOpenEnginePanel={onOpenEnginePanel}
              linkingDawFile={linkingDawFile}
            />
          </header>
          <div className={`scroll-chrome-hidden relative flex-1 overflow-y-auto ${isActivePath(pathname, '/script') ? 'p-0' : 'p-4 md:p-6'}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}
