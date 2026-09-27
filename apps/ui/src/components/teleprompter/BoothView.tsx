import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone } from '@fortawesome/free-solid-svg-icons';
import { useId, useState, type ReactNode } from 'react';
import type { GuideEntity } from '../../types';
import { Button } from '../primitives/Button';
import { FocusShell } from '../primitives/FocusShell';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { Kbd } from '../primitives/Kbd';
import { LevelMeter } from '../primitives/LevelMeter';
import { Popover } from '../primitives/Popover';
import { StatusBadge, type StatusTone } from '../primitives/StatusBadge';
import { Toolbar, ToolbarButton } from '../primitives/Toolbar';
import { useCommand } from '../../input/useCommand';
import { MicrophoneField } from './MicrophoneField';
import { REAPER_STATUS_TEXT } from './ReadingControlBar';
import { ReadAlongView } from './ReadAlongView';
import { useInputLevel } from './useInputLevel';
import { useReadAloudReaperState } from './useReadAloudReaperState';
import type { RecordInReaperState } from './useRecordInReaper';
import type { FollowCursor } from './useFollowCursor';
import type { ReaderMark } from './readerModel';
import type { TeleprompterSession } from './useTeleprompterSession';

type Props = {
  session: TeleprompterSession;
  follow: FollowCursor;
  /** Absent in credits mode (no chapter track, mirroring `ReadingControlBar`'s own `chapterId?`). */
  chapterId?: string;
  chapterTitle?: string;
  /** The Record-in-REAPER toggle's state (booth-actions-enablement.prd.md Phase 2), owned by `ReadAloudDialog` like the
   * normal dialog: booth mode shows what it reports (the "REC · P&R" badge below) but does not yet duplicate its own
   * toggle button into the `Toolbar` - `CapabilityGate` clones its child's props for the unavailable case, which does
   * not reach through `ToolbarButton`'s own `render` composition to the control underneath. The toggle itself stays
   * reachable from the normal Read Aloud dialog until that composition is solved. */
  recording: RecordInReaperState;
  marks?: Map<string, ReaderMark[]>;
  onOpenMark?: (mark: ReaderMark) => void;
  header?: ReactNode;
  /** The same `ReaderRail` element the normal dialog builds for its `aside` (booth-mode-and-companion-panel.prd.md
   * Phase 1): `FocusShell` gives it its own landmark instead of `ReadAlongView`'s grid. */
  rail: ReactNode;
  /** The Story Bible entries this chapter mentions, in the order they first appear (the same list the rail's Story
   * bible tab shows); the characters among them are the "Voices in scene" section (Phase 3). Absent in credits mode,
   * which has no chapter text to mark and so no section. */
  speakers?: GuideEntity[];
  /** Opens a speaker's Story Bible entry in the rail, the same as activating its mark in the text. */
  onOpenSpeaker?: (entity: GuideEntity) => void;
};

/** The booth's status line (Phase 1): recording/reading state, the chapter, word progress, the microphone (device
 * picker plus a live level, the same pair `ReadingControlBar`'s own mic button opens - booth mode has no other way to
 * change device, so this is not optional here the way it might look like a duplicate elsewhere) and, chapter mode
 * only, the same REAPER wording the normal dialog's indicator uses. */
function BoothStatus({ session: t, chapterId, chapterTitle, recording }: Pick<Props, 'session' | 'chapterId' | 'chapterTitle' | 'recording'>) {
  const [micOpen, setMicOpen] = useState(false);
  const { level, error: levelError } = useInputLevel(t.device, { active: t.active, enabled: micOpen || t.active });
  const { state: reaperState } = useReadAloudReaperState(chapterId);
  const listening = t.active && !t.paused;
  const tone: StatusTone = recording.recording ? 'danger' : listening ? 'info' : 'neutral';
  const label = recording.recording ? 'REC · P&R' : listening ? 'Reading' : t.active ? 'Paused' : 'Ready';
  const micLabel = `Microphone: ${t.device || 'not chosen'}`;
  return (
    <>
      <StatusBadge tone={tone} label={label} />
      {/* The room meter (booth-mode-and-companion-panel.prd.md Phase 4): a second, decorative `LevelMeter` fed by the
       * same mic-level channel `useInputLevel` already subscribes above, not a separate room-mic measurement (none
       * exists) - it lets the narrator glance at level without opening the microphone popover. Room-tone-matches-last-
       * session (Open Question 4) is deferred; this is the meter alone. */}
      <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        Room
        <LevelMeter label="Room level" peak={level?.peak ?? null} rms={level?.rms ?? null} decorative size="compact" className="w-10" />
      </span>
      {chapterTitle && <span className="font-semibold">{chapterTitle}</span>}
      {t.session.script && (
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
          {t.session.cursor.toLocaleString()} of {t.session.script.tokens.toLocaleString()} words
        </span>
      )}
      <Popover
        label="Microphone"
        side="bottom"
        open={micOpen}
        onOpenChange={setMicOpen}
        trigger={
          <Button aria-label={micLabel} variant="ghost" className="max-w-[9rem] lg:max-w-[13rem]">
            <FontAwesomeIcon icon={faMicrophone} />
            <span className="truncate">{t.device || 'Choose a microphone…'}</span>
            <LevelMeter label="Input level" peak={level?.peak ?? null} rms={level?.rms ?? null} decorative size="compact" className="w-8 flex-none" />
          </Button>
        }
      >
        <div className="w-72 space-y-2">
          <MicrophoneField
            value={t.device}
            onChange={t.changeDevice}
            devices={t.devices}
            error={t.devicesError}
            onRefresh={t.loadDevices}
            refreshing={t.devicesLoading}
          />
          <LevelMeter label="Input level" peak={level?.peak ?? null} rms={level?.rms ?? null} size="booth" />
          {levelError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--danger-text)' }}>
              {levelError}
            </p>
          )}
        </div>
      </Popover>
      {chapterId && reaperState && <StatusBadge tone="neutral" label={`REAPER · ${REAPER_STATUS_TEXT[reaperState.status]}`} />}
      <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
        Exit booth <Kbd keys={['Esc']} />
      </span>
    </>
  );
}

const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

/**
 * The rail's "Voices in scene" section (booth-mode-and-companion-panel.prd.md Phase 3): the chapter's Story Bible
 * characters as speaker tags in the existing `Highlight` character colour (no new primitive or colour), each opening
 * its entry in the rail's Story bible tab. The per-character voice reference clip the booth mock plays here is
 * Character Continuity Review's work (PRD D3): until it lands, the section says so honestly (Open Question 6) instead
 * of leaving a gap, so the layout does not shift when real clips arrive in this same slot.
 */
function BoothSpeakers({ speakers, onOpenSpeaker }: { speakers: GuideEntity[]; onOpenSpeaker?: (entity: GuideEntity) => void }) {
  const headingId = useId();
  const characters = speakers.filter((entity) => highlightKind(entity.category) === 'Character');
  return (
    <section aria-labelledby={headingId} className="mb-4 space-y-2">
      <h2 id={headingId} className={SECTION_LABEL}>
        Voices in scene
      </h2>
      {characters.length > 0 ? (
        <ul className="flex flex-wrap gap-x-2 gap-y-1.5 text-sm">
          {characters.map((entity) => (
            <li key={entity.id}>
              <Highlight
                kind="Character"
                label={onOpenSpeaker ? `${entity.canonical_name}: open in the Story bible` : undefined}
                onActivate={onOpenSpeaker && (() => onOpenSpeaker(entity))}
              >
                {entity.canonical_name}
              </Highlight>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No Story Bible characters are mentioned in this chapter.
        </p>
      )}
      <StatusBadge tone="neutral" label="Reference clips coming soon" />
    </section>
  );
}

const TOOLBAR_BUTTON_CLASS = 'flex-col gap-1 px-3 py-1.5 text-[0.7rem] normal-case';

/**
 * The full-screen booth layout (booth-mode-and-companion-panel.prd.md Phase 1 and 2), built on `FocusShell`: the same
 * session, status, rail and text the normal Read Aloud dialog already tracks, re-skinned rather than forked
 * (`ReadAloudDialog` mounts this in place of `ReadAlongView`'s own aside layout when its `mode` is `"booth"`, so there
 * is exactly one `useTeleprompterSession` instance whichever surface is open). The `commands` region is a `Toolbar` of
 * the same Play/Pause, Stop and Follow handlers `ReadingControlBar` calls (Open Question 7: reuse, no new command
 * ids), `Kbd`-labelled where a real gesture exists (`reading.toggle`, Space) - the two components deliberately
 * duplicate this small amount of Play/Pause/Stop logic rather than share a hook, since `ReadingControlBar.tsx` is a
 * file other in-flight PRDs also read from (the PRD's own Phase details note on Phase 5) and this is the smaller
 * surface to keep stable.
 */
export function BoothView({ session: t, follow, chapterId, chapterTitle, recording, marks, onOpenMark, header, rail, speakers, onOpenSpeaker }: Props) {
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
  // Space toggles Play/Pause while this booth scope is active, the same command id and scope `ReadingControlBar`
  // registers in the normal dialog (ADR 0361 decision 4) - only one of the two is ever mounted at a time (Risks table).
  useCommand('reading.toggle', () => {
    if (!playPauseDisabled) onPlayPause();
  });

  return (
    <FocusShell
      status={<BoothStatus session={t} chapterId={chapterId} chapterTitle={chapterTitle} recording={recording} />}
      rail={
        speakers ? (
          <>
            <BoothSpeakers speakers={speakers} onOpenSpeaker={onOpenSpeaker} />
            {rail}
          </>
        ) : (
          rail
        )
      }
      // Always mounted inside `ReadAloudDialog`'s `Dialog size="full"` (never yet the standalone route ADR 0094 also
      // allows): AppShell's own page `<main>` stays in the accessibility tree behind it (booth-mode-and-companion-panel.prd.md
      // Phase 1's real, first-encountered `landmark-no-duplicate-main`/`landmark-unique` axe finding), so this shell must
      // not add a second one.
      asMain={false}
      commands={
        <Toolbar label="Booth commands">
          <ToolbarButton
            render={
              <Button aria-label={playPauseLabel} aria-pressed={listening} onClick={onPlayPause} disabled={playPauseDisabled} className={TOOLBAR_BUTTON_CLASS}>
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
      }
    >
      <ReadAlongView session={t} follow={follow} header={header} marks={marks} onOpenMark={onOpenMark} hideKey />
    </FocusShell>
  );
}
