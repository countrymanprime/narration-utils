import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCrosshairs, faGear, faMicrophone, faPlay, faStop, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { Popover } from '../primitives/Popover';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { MicrophoneField } from './MicrophoneField';
import { EDITABLE, SPACE_ACTIVATES, KEY_WIDGET_ROLES, type FollowCursor } from './useFollowCursor';
import { ENGINE_LABELS, MODELS, type TeleprompterSession } from './useTeleprompterSession';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

/** The start point the sibling PRD's resume prompt chose, shown as a clearable chip while idle (its RD9). */
type StartPoint = { label: string; onClear: () => void };

type Props = {
  session: TeleprompterSession;
  follow: FollowCursor;
  startPoint?: StartPoint;
};

/** Whether a keydown's target already owns the key: a field, a button, a tab or another interactive widget (the same
 * check `isScrollKey` makes, `useFollowCursor.ts`), so Space there activates the widget instead of the reading toggle. */
function isWidgetTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE) || target.closest(SPACE_ACTIVATES)) return true;
  const role = target.getAttribute('role');
  return Boolean(role && KEY_WIDGET_ROLES.has(role));
}

/**
 * Space toggles Play/Stop when focus is not in a field, button, tab or other widget (Q10 A, amends ADR 0119 decision 2
 * for this dialog): `preventDefault` stops it also being read as a scroll key by `useFollowCursor`'s own document
 * listener, which already skips a prevented event (`isScrollKey`, `useFollowCursor.ts`).
 */
function useSpaceShortcut(onToggle: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isWidgetTarget(event.target)) return;
      event.preventDefault();
      onToggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);
}

/**
 * The read-aloud media bar (read-aloud-control-bar.prd.md Phase 3), replacing the configuration `Panel`: Play/Stop, status
 * and word count, the start-point chip, Follow, a microphone popover (device list and Refresh - the level meter is Phase
 * 4) and a Settings popover (Engine and Model). Rendered outside the dialog's scrolling body (`Dialog`'s `footer` slot) or,
 * on the standalone page, sticky at the bottom of its own column (Q11), so it is never scrolled out of view. No Pause (Q3)
 * and no "Record in REAPER" toggle (Q7-Q9) yet - both are later phases.
 */
export function ReadingControlBar({ session: t, follow, startPoint }: Props) {
  useSpaceShortcut(() => {
    if (t.active) t.stop();
    else if (t.canStart) void t.start();
  });

  const micLabel = `Microphone: ${t.device || 'not chosen'}`;
  const engineOptions = t.engines.map((option) => ({ ...option, disabled: t.active }));
  const modelOptions = MODELS.map((option) => ({ value: option.value, label: option.label, title: option.caption, disabled: t.active }));

  return (
    <div role="toolbar" aria-label="Reading controls" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <TooltipTarget text={t.startReason}>
          <Button aria-label="Play" onClick={() => void t.start()} disabled={t.active || !t.canStart}>
            <FontAwesomeIcon icon={faPlay} />
            <span className="hidden lg:inline">Play</span>
          </Button>
        </TooltipTarget>
        <Button aria-label="Stop reading" variant="danger" onClick={t.stop} disabled={!t.active || t.host.phase === 'stopping'}>
          <FontAwesomeIcon icon={faStop} />
          <span className="hidden lg:inline">Stop reading</span>
        </Button>
      </div>

      <div className="order-first min-w-0 basis-full text-sm lg:order-none lg:flex-1 lg:basis-auto">
        <span role="status" className="font-semibold" style={{ color: t.session.position?.status === 'waiting' && t.active ? 'var(--warn-text)' : undefined }}>
          {t.status || 'Ready'}
        </span>
        {t.session.script && (
          <span className="ml-2 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
            {t.session.cursor.toLocaleString()} of {t.session.script.tokens.toLocaleString()} words
          </span>
        )}
        {t.active && t.session.heard && (
          <span className="ml-2 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            Heard: {t.session.heard}
          </span>
        )}
        <div aria-live="polite" className="text-xs empty:hidden" style={{ color: 'var(--text-muted)' }}>
          {t.active && !follow.following && 'Following paused. Scroll back to the highlighted word or press Follow.'}
        </div>
      </div>

      {!t.active && startPoint && (
        <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-xs" style={{ borderColor: 'var(--border)' }}>
          <span className="truncate">Starts at &lsquo;{startPoint.label}&rsquo;</span>
          <IconButton label="Clear start point" onClick={startPoint.onClear} className="size-4 border-0 bg-transparent p-0 hover:bg-transparent">
            <FontAwesomeIcon icon={faXmark} className="text-[0.7rem]" />
          </IconButton>
        </span>
      )}

      {t.active && (
        // Always shown while a session runs, so it is where the narrator expects it; enabled only while following is paused.
        <Button aria-label="Follow" variant="ghost" onClick={follow.resume} disabled={follow.following}>
          <FontAwesomeIcon icon={faCrosshairs} />
          <span className="hidden lg:inline">Follow</span>
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Popover
          label="Microphone"
          side="top"
          trigger={
            <Button aria-label={micLabel} variant="ghost" className="max-w-[9rem] lg:max-w-[13rem]">
              <FontAwesomeIcon icon={faMicrophone} />
              <span className="truncate">{t.device || 'Choose a microphone…'}</span>
            </Button>
          }
        >
          <div className="w-72">
            <MicrophoneField
              value={t.device}
              onChange={t.changeDevice}
              devices={t.devices}
              error={t.devicesError}
              onRefresh={t.loadDevices}
              refreshing={t.devicesLoading}
            />
          </div>
        </Popover>

        <Popover
          label="Settings"
          side="top"
          align="end"
          trigger={
            <IconButton label="Settings">
              <FontAwesomeIcon icon={faGear} />
            </IconButton>
          }
        >
          <div className="flex w-64 flex-col gap-3">
            {engineOptions.length > 1 && (
              <div>
                <span className={LABEL_CLASS}>Engine</span>
                <ToggleGroup label="Engine" className="mt-1.5 flex-wrap gap-1.5" value={t.engine} onChange={t.changeEngine} options={engineOptions} />
              </div>
            )}
            <div>
              <span className={LABEL_CLASS}>{engineOptions.length > 1 ? 'Model' : `${ENGINE_LABELS[t.engine]} model`}</span>
              <ToggleGroup label="Model" className="mt-1.5 flex-wrap gap-1.5" value={t.model} onChange={t.changeModel} options={modelOptions} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Used everywhere the app listens.{' '}
              <Link to="/settings#teleprompter" className="underline">
                More in Settings
              </Link>
            </p>
          </div>
        </Popover>
      </div>
    </div>
  );
}
