import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../primitives/Button';
import { useResumeLocate, type LocateState } from './useResumeLocate';
import { WhisperModelPrompt } from './WhisperModelPrompt';
import type { ChapterTrackMatch, TeleprompterLocateResult } from '../../types';

type Sentence = NonNullable<NonNullable<Located['located']>['sentence']>;
type Located = Exclude<TeleprompterLocateResult, { status: 'asset_required' }>;

const MUTED = { color: 'var(--text-muted)' };
const FROM_THE_TOP = 'reading starts from the top.';

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

function savedLabel(savedAt: string): string {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime())
    ? "as of the project's last save"
    : `as of the project's last save, ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
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
  if (state.kind === 'loading') return <p role="status">Finding where your recording of this chapter ends…</p>;
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

function LocatedBody({ result, onChoose }: { result: Located; onChoose: (word: number | null, label?: string) => void }) {
  const { match, track, located } = result;
  const trackName = track?.name;
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
  const complete = located?.confident && point != null && point.word >= located.tokens;

  if (complete && point)
    return (
      <Actions
        buttons={
          <Button variant="ghost" onClick={() => onChoose(null)}>
            Pick a word
          </Button>
        }
      >
        <p>This chapter is recorded to the end. Play reads from the top.</p>
        <TrackProblem match={match} trackName={trackName} />
      </Actions>
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
