import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUpRightAndDownLeftFromCenter } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DawTransport } from '../../api/contracts/daw';
import { useCommand } from '../../input/useCommand';
import { Button } from '../primitives/Button';
import { CompactShell } from '../primitives/CompactShell';
import { Kbd } from '../primitives/Kbd';
import { StatusBadge, type StatusTone } from '../primitives/StatusBadge';
import { Toolbar, ToolbarButton } from '../primitives/Toolbar';
import { ReadAlongView } from './ReadAlongView';
import type { ReaderMark } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import type { RecordInReaperState } from './useRecordInReaper';
import type { TeleprompterSession } from './useTeleprompterSession';

type Props = {
  session: TeleprompterSession;
  follow: FollowCursor;
  chapterTitle?: string;
  /** The Record-in-REAPER orchestration `BoothSession` owns, so Play and Stop here arm and stop exactly as the Booth's do. */
  recording: RecordInReaperState;
  marks?: Map<string, ReaderMark[]>;
  onOpenMark?: (mark: ReaderMark) => void;
  header?: ReactNode;
  /** "Full app" and the double Escape: back to the full-size app, the same session still running. */
  onFullApp: () => void;
};

// How long a first Escape waits for the second (Open Question 5: "pressing Escape twice, once to confirm").
const ESCAPE_CONFIRM_MS = 3000;

const SECTION = 'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm';
const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

/** Project seconds as REAPER shows them in its transport, m:ss.t (the mock's "2:14.6"). */
function playheadTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** REAPER's transport from `daw_transport_changed` (DAW port PRD Phase 9). Pushed only: until the first push, stopped. */
function useDawTransport(): DawTransport {
  const api = useApi();
  const [transport, setTransport] = useState<DawTransport>({ playing: false, recording: false });
  useEffect(() => api.subscribeDawTransport(setTransport), [api]);
  return transport;
}

function playheadBadge({ playing, recording, position }: DawTransport): { tone: StatusTone; label: string } {
  const at = position === undefined ? '' : playheadTime(position);
  if (recording) return { tone: 'danger', label: at ? `Recording · ${at}` : 'Recording' };
  if (playing) return { tone: 'info', label: at ? `Playhead ${at}` : 'Playhead moving' };
  return { tone: 'neutral', label: 'Playhead stopped' };
}

/**
 * Narrows and pins the app's one window while this is mounted, and gives it back on unmount (ADR 0401: the same window,
 * never a second one). Unmount covers every way out - Full app, the double Escape, the dialog closing - and the host's
 * exit is a no-op when nothing was entered, so there is no path that leaves the window narrow and pinned.
 */
function useCompanionWindow(): string | null {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.companionModeEnter().catch((reason) => live && setError(apiErrorMessage(reason)));
    return () => {
      live = false;
      void api.companionModeExit().catch(() => {});
    };
  }, [api]);
  return error;
}

/**
 * While the companion shows, it is the whole window: everything else in `<body>` is hidden from assistive technology and
 * made inert, and given back exactly as it was on unmount. `CompactShell` brings its own `<main>`, which must not sit
 * beside the full app's own one (`landmark-no-duplicate-main`), and a narrow window has no room for the full app anyway.
 * The full app's own live regions are hidden with it; that is the booth's rule too - nothing interrupts the narrator here.
 */
function useWholeWindow(root: HTMLElement | null) {
  useEffect(() => {
    if (!root) return;
    const hidden: { element: Element; ariaHidden: string | null }[] = [];
    for (const element of Array.from(document.body.children)) {
      if (element === root || element.hasAttribute('inert')) continue;
      hidden.push({ element, ariaHidden: element.getAttribute('aria-hidden') });
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    }
    return () => {
      for (const { element, ariaHidden } of hidden) {
        element.removeAttribute('inert');
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      }
    };
  }, [root]);
}

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={SECTION}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 id={headingId} className={SECTION_LABEL}>
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

const TOOLBAR_BUTTON_CLASS = 'gap-1.5 px-3 py-1.5 text-[0.75rem]';

/**
 * Companion mode's layout (booth-mode-and-companion-panel.prd.md Phase 7): `CompactShell` in the app's own window, narrowed
 * and pinned beside the DAW (Phase 6's bindings). It is the same teleprompter session the Read aloud dialog and the booth
 * show (`BoothSession` renders this in place of `BoothView`), re-laid out for a 380 px column: REAPER's playhead in the
 * header, then the script, the note at the playhead and the chapter's pickups (both reserved for the closed-loop proofing
 * PRD, which fills them - an honest "Coming soon" until then, D3), and the gestures that work here.
 *
 * Play/Pause and Stop repeat `BoothView`'s few lines on the same handlers rather than share a hook with it: each surface
 * is mounted alone (one `reading.toggle` registration at a time), and those files belong to other phases in flight.
 */
export function CompanionShell({ session: t, follow, chapterTitle, recording, marks, onFullApp, onOpenMark, header }: Props) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [escapeArmed, setEscapeArmed] = useState(false);
  const escapeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const windowError = useCompanionWindow();
  const transport = useDawTransport();
  const playhead = playheadBadge(transport);
  useWholeWindow(root);

  useEffect(() => {
    root?.focus();
  }, [root]);
  useEffect(() => () => clearTimeout(escapeTimer.current), []);

  const listening = t.active && !t.paused;
  const playPauseLabel = listening ? 'Pause' : 'Play';
  const playPauseDisabled = t.host.phase === 'starting' || t.host.phase === 'stopping' || (!t.active && !t.canStart);
  const onPlayPause = () => {
    if (!t.active)
      void recording.beforeStart().then((ok) => {
        if (ok) void t.start();
      });
    else t.pause(listening);
  };
  const onStop = () => {
    t.stop();
    recording.afterStop();
  };
  useCommand('reading.toggle', () => {
    if (!playPauseDisabled) onPlayPause();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    clearTimeout(escapeTimer.current);
    if (escapeArmed) {
      setEscapeArmed(false);
      onFullApp();
      return;
    }
    setEscapeArmed(true);
    escapeTimer.current = setTimeout(() => setEscapeArmed(false), ESCAPE_CONFIRM_MS);
  };

  return createPortal(
    // The window itself: in the real app it is already 380 px wide; anywhere wider (the mock build, or the moment before
    // the host narrows it) the column keeps CompactShell's own width, centred.
    <div
      ref={setRoot}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-companion=""
      className="fixed inset-0 z-40 flex justify-center bg-[var(--bg)] focus:outline-none"
    >
      <CompactShell
        title="Companion"
        status={<StatusBadge tone={playhead.tone} label={playhead.label} />}
        action={
          <Button variant="ghost" className="px-2.5 py-1 text-xs" onClick={onFullApp}>
            <FontAwesomeIcon icon={faUpRightAndDownLeftFromCenter} /> Full app
          </Button>
        }
      >
        {windowError && (
          <p role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
            Couldn&apos;t pin the window beside your DAW: {windowError}
          </p>
        )}
        <p role="status" className="text-xs empty:hidden" style={{ color: 'var(--text-muted)' }}>
          {escapeArmed ? 'Press Esc again to return to the full app.' : ''}
        </p>
        <Section title="Script">
          {chapterTitle && <p className="mb-2 font-semibold">{chapterTitle}</p>}
          <Toolbar label="Companion commands">
            <ToolbarButton
              render={
                <Button
                  aria-label={playPauseLabel}
                  aria-pressed={listening}
                  onClick={onPlayPause}
                  disabled={playPauseDisabled}
                  className={TOOLBAR_BUTTON_CLASS}
                >
                  <Kbd keys={['Space']} />
                  {playPauseLabel}
                </Button>
              }
            />
            <ToolbarButton
              render={
                <Button
                  aria-label="Stop reading"
                  variant="danger"
                  onClick={onStop}
                  disabled={!t.active || t.host.phase === 'stopping'}
                  className={TOOLBAR_BUTTON_CLASS}
                >
                  Stop reading
                </Button>
              }
            />
            {t.active && (
              <ToolbarButton
                render={
                  <Button aria-label="Follow" onClick={follow.resume} disabled={follow.following} className={TOOLBAR_BUTTON_CLASS}>
                    Follow
                  </Button>
                }
              />
            )}
          </Toolbar>
          {/* Its own scroll box, so the sections below stay in reach however long the chapter is; the cursor follows inside it. */}
          <div className="mt-2 max-h-[45vh] overflow-y-auto">
            <ReadAlongView session={t} follow={follow} header={header} marks={marks} onOpenMark={onOpenMark} hideKey />
          </div>
        </Section>
        <Section title="Note at playhead" badge={<StatusBadge tone="neutral" label="Coming soon" />}>
          <p style={{ color: 'var(--text-muted)' }}>The proofer&apos;s note at REAPER&apos;s playhead, with Resolve and Waive, will show here.</p>
        </Section>
        <Section title="Pickups" badge={<StatusBadge tone="neutral" label="Coming soon" />}>
          <p style={{ color: 'var(--text-muted)' }}>This chapter&apos;s pickups will be listed here. For now, find them in the full app.</p>
        </Section>
        <Section title="Hotkeys">
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
            <dt>
              <Kbd keys={['Space']} />
            </dt>
            <dd>Play or pause reading</dd>
            <dt className="flex gap-1">
              <Kbd keys={['Esc']} />
              <Kbd keys={['Esc']} />
            </dt>
            <dd>Back to the full app</dd>
          </dl>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            These work only while this window has focus; hotkeys that reach it from REAPER are not available yet.
          </p>
        </Section>
      </CompactShell>
    </div>,
    document.body,
  );
}
