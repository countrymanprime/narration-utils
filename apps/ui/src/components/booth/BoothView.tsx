import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownLeftAndUpRightToCenter } from '@fortawesome/free-solid-svg-icons';
import { useId, type ReactNode } from 'react';
import type { GuideEntity } from '../../types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button } from '../primitives/Button';
import { FocusShell } from '../primitives/FocusShell';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { Kbd } from '../primitives/Kbd';
import { LevelMeter } from '../primitives/LevelMeter';
import { speakerColorToken } from '../primitives/speakerColor';
import { StatusBadge, type StatusTone } from '../primitives/StatusBadge';
import { TooltipTarget } from '../primitives/Tooltip';
import { ReadingControlBar } from './ReadingControlBar';
import { ReadAlongView } from './ReadAlongView';
import { useInputLevel } from './useInputLevel';
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
  /** The Record-in-REAPER toggle's state (booth-actions-enablement.prd.md Phase 2), owned by `BoothSession`: the
   * command bar's toggle and the status bar's "REC · P&R" badge read the same one. */
  recording: RecordInReaperState;
  /** The resume prompt's chosen start point, shown as the command bar's clearable chip while idle. */
  startPoint?: { label: string; onClear: () => void };
  marks?: Map<string, ReaderMark[]>;
  onOpenMark?: (mark: ReaderMark) => void;
  header?: ReactNode;
  /** The pre-session setup (stage-navigation-and-page-replacement.prd.md Phase 4: the chapter picker, the REAPER
   * suggestion and the credits warning), shown above the text only while no session runs. */
  setup?: ReactNode;
  /** The `ReaderRail` element `BoothSession` builds: `FocusShell` gives it its own landmark. */
  rail: ReactNode;
  /** The Story Bible entries this chapter mentions, in the order they first appear (the same list the rail's Story
   * bible tab shows); the characters among them are the "Voices in scene" section (Phase 3). Absent in credits mode,
   * which has no chapter text to mark and so no section. */
  speakers?: GuideEntity[];
  /** Opens a speaker's Story Bible entry in the rail, the same as activating its mark in the text. */
  onOpenSpeaker?: (entity: GuideEntity) => void;
  /** Companion mode (ADR 0401), entered from the header (stage navigation Q9). */
  onCompanion?: () => void;
  /** Exit booth (the header button, or Escape: `BoothSession` asks first while a session listens). */
  onExit: () => void;
};

/** The booth's status line (mock 03's top bar): recording/reading state, the chapter, word progress and the live input
 * level. The microphone, engine and model choices and the REAPER toggle are the command bar's (`ReadingControlBar`),
 * so the status line only reads them. */
function BoothStatus({
  session: t,
  chapterTitle,
  recording,
  onCompanion,
  onExit,
}: Pick<Props, 'session' | 'chapterTitle' | 'recording' | 'onCompanion' | 'onExit'>) {
  // A running session relays its own levels; before one starts the command bar's microphone popover runs the meter.
  const { level } = useInputLevel(t.device, { active: t.active, enabled: false });
  const listening = t.active && !t.paused;
  const tone: StatusTone = recording.recording ? 'danger' : listening ? 'info' : 'neutral';
  const label = recording.recording ? 'REC · P&R' : listening ? 'Reading' : t.active ? 'Paused' : 'Ready';
  return (
    <>
      <StatusBadge tone={tone} label={label} />
      {chapterTitle && <span className="min-w-0 truncate font-semibold">{chapterTitle}</span>}
      {t.session.script && (
        <span className="hidden font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap sm:inline" style={{ color: 'var(--text-muted)' }}>
          {t.session.cursor.toLocaleString()} of {t.session.script.tokens.toLocaleString()} words
        </span>
      )}
      {/* Decorative: the command bar's microphone popover has the labelled meter. */}
      <span className="flex flex-none items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="max-sm:sr-only">Input</span>
        <LevelMeter label="Input level" peak={level?.peak ?? null} rms={level?.rms ?? null} decorative size="compact" className="w-8 sm:w-16" />
      </span>
      <div className="ml-auto flex flex-none items-center gap-2">
        {onCompanion && (
          <TooltipTarget text="Pin a narrow companion panel beside your DAW">
            <Button variant="ghost" aria-label="Companion" className="px-2.5 py-1 text-xs" onClick={onCompanion}>
              <FontAwesomeIcon icon={faDownLeftAndUpRightToCenter} />
              <span className="max-sm:hidden">Companion</span>
            </Button>
          </TooltipTarget>
        )}
        <Button variant="ghost" aria-label="Exit booth" className="px-2.5 py-1 text-xs" onClick={onExit}>
          <span className="max-sm:hidden">Exit booth</span> <Kbd keys={['Esc']} />
        </Button>
      </div>
    </>
  );
}

const SECTION_LABEL = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

/**
 * The rail's "Voices in scene" section (booth-mode-and-companion-panel.prd.md Phase 3): the chapter's Story Bible
 * characters as speaker tags, each opening its entry in the rail's Story bible tab. Each tag draws in its own
 * per-speaker colour (D85 #6, ADR 0366) via `Highlight`'s `colorToken` override, keyed by the same canonical name the
 * Script reader's `SpeakerTag` hashes (manuscript/ParagraphView.tsx), so a speaker's colour matches on both pages -
 * still the `Highlight` primitive and its Character kind/behaviour, only the colour source changed. The
 * per-character voice reference clip the booth mock plays here is Character Continuity Review's work (PRD D3): until
 * it lands, the section says so honestly (Open Question 6) instead of leaving a gap, so the layout does not shift
 * when real clips arrive in this same slot.
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
                colorToken={speakerColorToken(entity.canonical_name)}
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

/**
 * The Booth page's surface (stage-navigation-and-page-replacement.prd.md Phase 4, mock 03), built on `FocusShell`: the
 * status line, the chapter text (with the pre-session setup above it while idle), the rail and, as the command bar, the
 * same `ReadingControlBar` the read-aloud dialog used - Play/Pause (Space), Stop, Follow, the microphone, Record in
 * REAPER and the engine and model - so nothing the dialog offered is lost in the one surface that replaces it. It
 * renders one `BoothSession`'s session; it owns none of its own.
 */
export function BoothView({
  session: t,
  follow,
  chapterId,
  chapterTitle,
  recording,
  startPoint,
  marks,
  onOpenMark,
  header,
  setup,
  rail,
  speakers,
  onOpenSpeaker,
  onCompanion,
  onExit,
}: Props) {
  // From `md` the rail is FocusShell's own column (mock 03); below it an 18rem column would crush the text, so the same
  // rail follows the text instead, in the one scrolling region (WCAG 1.4.10 reflow, ADR 0061).
  const railBeside = useMediaQuery('(min-width: 48rem)', true);
  const railContent = speakers ? (
    <>
      <BoothSpeakers speakers={speakers} onOpenSpeaker={onOpenSpeaker} />
      {rail}
    </>
  ) : (
    rail
  );
  return (
    <FocusShell
      status={<BoothStatus session={t} chapterTitle={chapterTitle} recording={recording} onCompanion={onCompanion} onExit={onExit} />}
      rail={railBeside ? railContent : undefined}
      // A route inside AppShell, whose own `<main>` holds this page: a second one would duplicate the landmark.
      asMain={false}
      commandsLabel="Booth commands"
      commands={
        <ReadingControlBar session={t} follow={follow} startPoint={startPoint} chapterId={chapterId} chapterTitle={chapterTitle} recording={recording} />
      }
    >
      {!t.active && setup}
      <ReadAlongView session={t} follow={follow} header={header} marks={marks} onOpenMark={onOpenMark} hideKey />
      {!railBeside && (
        <aside aria-label="Rail" className="mx-auto mt-4 w-full max-w-3xl">
          {railContent}
        </aside>
      )}
    </FocusShell>
  );
}
