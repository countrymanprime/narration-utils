import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faArrowRightArrowLeft, faCircleCheck, faCircleNotch, faClockRotateLeft, faLocationCrosshairs } from '@fortawesome/free-solid-svg-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../primitives/Button';
import { useResumeLocate, type LocateState } from './useResumeLocate';
import { WhisperModelPrompt } from './WhisperModelPrompt';
import type { ChapterTrackMatch, TeleprompterLocateResult, TeleprompterReading, TeleprompterResumePlace } from '../../types';

type Sentence = NonNullable<NonNullable<Located['located']>['sentence']>;
type Located = Exclude<TeleprompterLocateResult, { status: 'asset_required' }>;

const MUTED = { color: 'var(--text-muted)' };
const FROM_THE_TOP = 'reading starts from the top.';

/** A plain, underlined text-link action (read-aloud-resume-from-daw.prd.md Phase 3 mockups: Change, Start from the top,
 * Pick a word and Continue there are links beside the compact notices, not pill buttons). */
function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="underline" style={{ color: 'var(--accent)' }} onClick={onClick}>
      {children}
    </button>
  );
}

const TRACK_PROBLEM_REASON: Record<ChapterTrackMatch['warnings'][number], string> = {
  'confirmed-track-missing': 'missing from the project',
  'confirmed-track-renamed': 'renamed since it was linked',
  'confirmed-links-conflict': 'linked from more than one chapter',
};

type Props = {
  chapterId: string;
  /** The session's Whisper model, which the lookup transcribes the recording's tail with. */
  model: string;
  /** True once a session is running: the prompt settles (and stays hidden) the moment one starts. */
  active: boolean;
  /**
   * Sets where the next Start begins (`useTeleprompterSession.setStartWord`); null is the top. `label` is the control
   * bar's start-point chip text (read-aloud-control-bar.prd.md Phase 3), a short quote starting at the chosen word;
   * absent when the choice is "from the top" (word is null).
   */
  onStartWord: (word: number | null, label?: string) => void;
};

/** The start-point chip's text: a short quote beginning at the resume word, truncated with an ellipsis. */
const CHIP_WORD_LIMIT = 6;
function chipLabel(sentence: Sentence, word: number): string | undefined {
  const words = sentence.text.split(/\s+/).filter(Boolean);
  const at = word - sentence.start;
  if (words.length !== sentence.end - sentence.start || at < 0 || at >= words.length) return undefined;
  const tail = words.slice(at);
  const truncated = tail.length > CHIP_WORD_LIMIT;
  return `…${tail.slice(0, CHIP_WORD_LIMIT).join(' ')}${truncated ? '…' : ''}`;
}

/**
 * The matched sentence as a quote, with the resume word in bold when it falls inside it. `sentence.text` is the sentence's
 * script words joined by spaces (locate.py), so its word `word - start` is the resume word; a text that does not split
 * into `end - start` words is shown without the emphasis rather than with it on the wrong word.
 */
function ResumeSentence({ sentence, word }: { sentence: Sentence; word: number }) {
  const words = sentence.text.split(/\s+/).filter(Boolean);
  const at = word - sentence.start;
  const marked = words.length === sentence.end - sentence.start && at >= 0 && at < words.length;
  return (
    <blockquote className="border-l-2 border-[var(--accent)] pl-3 font-serif text-base italic">
      &ldquo;
      {marked ? (
        <>
          {at > 0 && `${words.slice(0, at).join(' ')} `}
          <strong className="not-italic">{words[at]}</strong>
          {at + 1 < words.length && ` ${words.slice(at + 1).join(' ')}`}
        </>
      ) : (
        sentence.text
      )}
      &rdquo;
    </blockquote>
  );
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

function formatWhen(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function savedLabel(savedAt: string): string {
  const when = formatWhen(savedAt);
  return when ? `as of the project's last save, ${when}` : "as of the project's last save";
}

/** One source's quote (read-aloud-resume-from-daw.prd.md Phase 3): the full sentence holding its word, with that word in
 * bold, matching `ResumeSentence`'s emphasis but inline rather than in a blockquote (the agreement notice, the disagree
 * choice and the prompter-only notice all quote inline). */
function PlaceQuote({ place }: { place: TeleprompterResumePlace }) {
  if (!place.sentence) return <span className="italic">&lsquo;…&rsquo;</span>;
  const { sentence, word } = place;
  const words = sentence.text.split(/\s+/).filter(Boolean);
  const at = word - sentence.start;
  const marked = words.length === sentence.end - sentence.start && at >= 0 && at < words.length;
  return (
    <span className="italic">
      &lsquo;
      {marked ? (
        <>
          {at > 0 && `${words.slice(0, at).join(' ')} `}
          <strong className="not-italic">{words[at]}</strong>
          {at + 1 < words.length && ` ${words.slice(at + 1).join(' ')}`}
        </>
      ) : (
        sentence.text
      )}
      &rsquo;
    </span>
  );
}

/** A compact notice's icon, text and links, wrapping at narrow widths (Q12): icon and text stay together on one line
 * that can grow, the links stay together beside them at `sm` and up, and drop to their own line below it. */
function NoticeHeader({ icon, iconColor, children, links }: { icon: IconDefinition; iconColor: string; children: ReactNode; links: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
      <div className="flex items-start gap-2">
        <FontAwesomeIcon icon={icon} className="mt-0.5 sm:mt-0" style={{ color: iconColor }} />
        <p className="min-w-0 sm:flex-1">{children}</p>
      </div>
      <div className="flex flex-none items-center gap-2 pl-6 text-sm sm:pl-0">{links}</div>
    </div>
  );
}

/** The agreement notice (Proposed Solution, RD3, RD4): Start reading is already preset to `daw`'s word (see the effect in
 * `ResumePrompt`) without settling the prompt, so the narrator sees why and can still Change (the same two-way choice as
 * `disagree`) or Start from the top. */
function AgreeNotice({
  daw,
  onChoose,
  onChange,
}: {
  daw: TeleprompterResumePlace;
  onChoose: (word: number | null, label?: string) => void;
  onChange: () => void;
}) {
  const label = daw.sentence && chipLabel(daw.sentence, daw.word);
  return (
    <NoticeHeader
      icon={faLocationCrosshairs}
      iconColor="var(--accent)"
      links={
        <>
          <TextLink onClick={onChange}>Change</TextLink>
          <span aria-hidden="true">·</span>
          <TextLink onClick={() => onChoose(null)}>Start from the top</TextLink>
        </>
      }
    >
      Continuing at {label ? <span className="italic">&lsquo;{label}&rsquo;</span> : <PlaceQuote place={daw} />} — REAPER and your last reading agree
    </NoticeHeader>
  );
}

/** The compact two-way choice (Proposed Solution, RD1-RD3): REAPER and the last reading disagree, or Change revealed it from
 * an agreement; the narrator picks one, each a button naming its source, when it was and its word (one-based), plus Start
 * from the top and Pick a word. */
function DisagreeChoice({
  daw,
  prompter,
  match,
  lastReading,
  onChoose,
}: {
  daw: TeleprompterResumePlace;
  prompter: TeleprompterResumePlace;
  match: ChapterTrackMatch;
  lastReading: TeleprompterReading | null;
  onChoose: (word: number | null, label?: string) => void;
}) {
  const dawWhen = daw.source === 'saved' ? savedLabel(match.savedAt) : 'in REAPER now';
  const prompterWhen = (lastReading && formatWhen(lastReading.endedAt)) || '';
  const pick = (place: TeleprompterResumePlace) => onChoose(place.word, place.sentence ? chipLabel(place.sentence, place.word) : undefined);
  const card = (label: string, when: string, place: TeleprompterResumePlace) => (
    <button
      type="button"
      onClick={() => pick(place)}
      className="min-w-0 rounded-md border p-2 text-left transition hover:border-[var(--accent)]"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="font-semibold tracking-wide uppercase">{label}</span>
        <span>
          {when} · word {place.number.toLocaleString()}
        </span>
      </div>
      <PlaceQuote place={place} />
    </button>
  );
  return (
    <div className="w-full space-y-2">
      <NoticeHeader
        icon={faArrowRightArrowLeft}
        iconColor="var(--accent)"
        links={
          <>
            <TextLink onClick={() => onChoose(null)}>Start from the top</TextLink>
            <span aria-hidden="true">·</span>
            <TextLink onClick={() => onChoose(null)}>Pick a word</TextLink>
          </>
        }
      >
        REAPER and your last reading are in different places. Start where?
      </NoticeHeader>
      <div className="grid gap-2 sm:grid-cols-2">
        {card('REAPER', dawWhen, daw)}
        {card('Last reading', prompterWhen, prompter)}
      </div>
    </div>
  );
}

/** The prompter-only notice (RD8): no track, no recording, or no confident match, but the prompter remembers where it last
 * stopped in this chapter. Offered, never taken silently - reading is not recording. */
function PrompterOnlyNotice({ prompter, onChoose }: { prompter: TeleprompterResumePlace; onChoose: (word: number | null, label?: string) => void }) {
  return (
    <NoticeHeader
      icon={faClockRotateLeft}
      iconColor="var(--accent)"
      links={
        <>
          <TextLink onClick={() => onChoose(prompter.word, prompter.sentence ? chipLabel(prompter.sentence, prompter.word) : undefined)}>
            Continue there
          </TextLink>
          <span aria-hidden="true">·</span>
          <TextLink onClick={() => onChoose(null)}>Start from the top</TextLink>
        </>
      }
    >
      Your last reading stopped at <PlaceQuote place={prompter} /> (nothing recorded on this chapter's track). Continue there?
    </NoticeHeader>
  );
}

/** One line naming a confirmed track's problem (renamed, missing, or linked twice), with a link to fix it on the Tracks page
 * instead of showing (or asking to change) the link here (read-aloud-resume-from-daw.prd.md Phase 1, "What We're NOT
 * Building": track linking stays Chapter Track Link Control's job). */
function TrackProblem({ match, trackName }: { match: ChapterTrackMatch; trackName?: string }) {
  if (match.warnings.length === 0) return null;
  return (
    <p style={MUTED}>
      Track{trackName ? `: ${trackName}` : ''} ({TRACK_PROBLEM_REASON[match.warnings[0]]}) —{' '}
      <Link to="/tracks" className="underline">
        check the link
      </Link>
    </p>
  );
}

function Actions({ children, buttons }: { children: ReactNode; buttons: ReactNode }) {
  return (
    <>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
      <div className="flex flex-none flex-wrap items-center gap-2">{buttons}</div>
    </>
  );
}

/** The body of the resume prompt while nothing has been chosen yet: one line and its next steps per lookup state. */
function PromptBody({
  state,
  onChoose,
  onRetry,
  onAskForModel,
}: {
  state: LocateState;
  onChoose: (word: number | null, label?: string) => void;
  onRetry: () => void;
  onAskForModel: () => void;
}) {
  if (state.kind === 'loading')
    return (
      <p role="status" className="flex items-center gap-2">
        <FontAwesomeIcon icon={faCircleNotch} className="motion-safe:animate-spin" style={{ color: 'var(--text-muted)' }} />
        Checking where REAPER and your last reading are… You can press Play now to start from the top.
      </p>
    );
  if (state.kind === 'failed')
    return (
      <Actions
        buttons={
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        <p role="alert">{state.message} Reading starts from the top unless you try again.</p>
      </Actions>
    );
  const { result } = state;
  if (result.status === 'asset_required')
    return (
      <Actions buttons={<Button onClick={onAskForModel}>Download model…</Button>}>
        <p>
          Finding where you stopped listens to the end of your recording with the {result.model.displayName} Whisper model, which is not downloaded yet. Until
          then reading starts from the top.
        </p>
      </Actions>
    );
  return <LocatedBody result={result} onChoose={onChoose} />;
}

/** Wraps `AgreeNotice`, revealing the same two-way choice `disagree` uses when the narrator presses Change - the
 * agreed-to preset stays in place (only Start from the top or a card click replaces it) until they pick one. */
function AgreeOrChanged({
  daw,
  prompter,
  match,
  lastReading,
  onChoose,
}: {
  daw: TeleprompterResumePlace;
  prompter: TeleprompterResumePlace;
  match: ChapterTrackMatch;
  lastReading: TeleprompterReading | null;
  onChoose: (word: number | null, label?: string) => void;
}) {
  const [changed, setChanged] = useState(false);
  if (changed) return <DisagreeChoice daw={daw} prompter={prompter} match={match} lastReading={lastReading} onChoose={onChoose} />;
  return <AgreeNotice daw={daw} onChoose={onChoose} onChange={() => setChanged(true)} />;
}

function LocatedBody({ result, onChoose }: { result: Located; onChoose: (word: number | null, label?: string) => void }) {
  const { match, track, located, verdict, lastReading } = result;
  const trackName = track?.name;

  // Only one source has a place (RD8): offered in the same compact form regardless of why the other is missing (no
  // track, no recording, an unconfident guess) - this takes priority over every status-specific message below.
  if (verdict.kind === 'prompter_only' && verdict.prompter) return <PrompterOnlyNotice prompter={verdict.prompter} onChoose={onChoose} />;

  if (result.status === 'no_track') {
    const project = fileName(match.projectFile);
    const text =
      match.status === 'ambiguous'
        ? `More than one track in ${project} could hold this chapter, so ${FROM_THE_TOP}`
        : match.status === 'uncertain' && match.candidates[0]
          ? `The closest track in ${project}, ${match.candidates[0].trackName}, is not a sure match, so ${FROM_THE_TOP}`
          : `No track in ${project} matches this chapter, so ${FROM_THE_TOP}`;
    return (
      <Actions
        buttons={
          <Button variant="ghost" onClick={() => onChoose(null)}>
            Pick a word
          </Button>
        }
      >
        <p>{text}</p>
        <p style={MUTED}>
          <Link to="/tracks" className="underline">
            Link a track
          </Link>{' '}
          on the Tracks page.
        </p>
      </Actions>
    );
  }

  const point = located?.word != null ? { word: located.word, sentence: located.sentence } : null;

  // The host's reconciliation (read-aloud-resume-from-daw.prd.md Phase 3, teleprompter.Reconcile) replaces the Phase 1
  // UI-side "complete" computation (word >= tokens): render its verdict, never recompute it.
  if (verdict.kind === 'agree' && verdict.daw && verdict.prompter)
    return <AgreeOrChanged daw={verdict.daw} prompter={verdict.prompter} match={match} lastReading={lastReading} onChoose={onChoose} />;
  if (verdict.kind === 'disagree' && verdict.daw && verdict.prompter)
    return <DisagreeChoice daw={verdict.daw} prompter={verdict.prompter} match={match} lastReading={lastReading} onChoose={onChoose} />;

  if (verdict.kind === 'complete' && point)
    return (
      <div className="w-full space-y-1">
        <NoticeHeader icon={faCircleCheck} iconColor="var(--ok-text)" links={<TextLink onClick={() => onChoose(null)}>Pick a word</TextLink>}>
          This chapter is recorded to the end. Play reads from the top.
        </NoticeHeader>
        <TrackProblem match={match} trackName={trackName} />
      </div>
    );

  if ((result.status === 'found' || result.status === 'low_confidence') && point && located)
    return (
      <Actions
        buttons={
          <>
            <Button
              variant={located.confident ? 'primary' : 'ghost'}
              onClick={() => onChoose(point.word, point.sentence ? chipLabel(point.sentence, point.word) : undefined)}
            >
              Resume from here
            </Button>
            <Button variant="ghost" onClick={() => onChoose(null)}>
              Start from the top
            </Button>
            <Button variant="ghost" onClick={() => onChoose(null)}>
              Pick a word
            </Button>
          </>
        }
      >
        <p style={MUTED}>
          {trackName} track · {savedLabel(match.savedAt)}
        </p>
        <TrackProblem match={match} trackName={trackName} />
        <p>
          {located.confident
            ? 'Continuing where your recording ends:'
            : `This is a guess: the end of your recording could also fit elsewhere in the chapter (${Math.round(located.confidence * 100)}% sure). Check the sentence before resuming:`}
        </p>
        {point.sentence && <ResumeSentence sentence={point.sentence} word={point.word} />}
      </Actions>
    );

  return (
    <Actions
      buttons={
        result.status === 'not_found' ? (
          <Button variant="ghost" onClick={() => onChoose(null)}>
            Pick a word
          </Button>
        ) : null
      }
    >
      <p style={MUTED}>
        {trackName} track · {savedLabel(match.savedAt)}
      </p>
      <TrackProblem match={match} trackName={trackName} />
      <p>{unreadableText(result)}</p>
      {result.status === 'not_found' && located?.heardText && <p style={MUTED}>Heard: &ldquo;{located.heardText}&rdquo;</p>}
    </Actions>
  );
}

function unreadableText(result: Located): string {
  const file = result.recordedEnd ? fileName(result.recordedEnd.sourceFile) : '';
  switch (result.status) {
    case 'not_found': {
      const seconds = result.tail ? Math.round(result.tail.to - result.tail.from) : 0;
      return `The last ${seconds} seconds of your recording did not match this chapter's text, so ${FROM_THE_TOP}`;
    }
    case 'no_recording':
      return `This track has no recorded audio yet, so ${FROM_THE_TOP}`;
    case 'source_missing':
      return `The last item's audio file is missing (${file}), so where you stopped cannot be found and ${FROM_THE_TOP}`;
    case 'source_unsupported':
      return `The last item's source (${file}) cannot be read as audio, so ${FROM_THE_TOP}`;
    default:
      return `Where you stopped could not be found, so ${FROM_THE_TOP}`;
  }
}

/**
 * The read-aloud dialog's resume prompt (read-aloud-resume-from-daw.prd.md Phase 1, amending
 * teleprompter-manuscript-integration.prd.md Phase 10 and superseding ADR 0112 decisions 5 and 6): a compact one-line
 * notice, or a compact choice with the matched sentence, for where the chapter's recording ends (`TeleprompterLocate`,
 * ADR 0111). It never starts reading by itself: a choice only sets where Start begins.
 *
 * It settles - and stays gone - the moment the narrator makes any choice or a session starts, for as long as this dialog
 * stays open: it does not come back after a session ends, so a finished session's next Start begins at the top with no
 * prompt to clear (`ReadAloudDialog` resets `startWord` to null on that transition). Closing and reopening the dialog
 * remounts this component and asks again.
 */
export function ResumePrompt({ chapterId, model, active, onStartWord }: Props) {
  const lookup = useResumeLocate(chapterId, model);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (active) setSettled(true);
  }, [active]);

  // Agreement presets Start without settling the notice (RD3, RD4): the narrator sees why and can still Change or Start
  // from the top. Only once per dialog open (this component's own lifetime), so it never fights a later Change or a
  // narrator's own pick with a repeat preset.
  const preset = useRef(false);
  useEffect(() => {
    if (lookup.state.kind !== 'answered') return;
    const { result } = lookup.state;
    if (result.status === 'asset_required' || result.verdict.kind !== 'agree' || result.verdict.start === null || preset.current) return;
    preset.current = true;
    const daw = result.verdict.daw;
    onStartWord(result.verdict.start, daw?.sentence ? chipLabel(daw.sentence, result.verdict.start) : undefined);
  }, [lookup.state, onStartWord]);

  if (settled || active) return null;

  const choose = (word: number | null, label?: string) => {
    onStartWord(word, label);
    setSettled(true);
  };

  return (
    <div
      role="region"
      aria-label="Where you stopped"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
    >
      <PromptBody state={lookup.state} onChoose={choose} onRetry={lookup.retry} onAskForModel={lookup.askForModel} />
      {lookup.prompt && (
        <WhisperModelPrompt
          prompt={lookup.prompt}
          purpose="listens to the end of your recording to find where you stopped"
          install={lookup.modelInstall}
          dismiss={lookup.closeModelPrompt}
        />
      )}
    </div>
  );
}
