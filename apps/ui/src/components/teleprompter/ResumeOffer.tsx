import { useState, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import type { LocateState } from './useResumeLocate';
import type { ChapterTrackMatch, TeleprompterLocateResult } from '../../types';

type Sentence = NonNullable<NonNullable<Located['located']>['sentence']>;

/** A resume word the narrator can confirm, and the sentence the tail's last words were placed in. */
export type ResumePoint = { word: number; sentence: Sentence | null };

type Located = Exclude<TeleprompterLocateResult, { status: 'asset_required' }>;

type Props = {
  state: LocateState;
  onResume: (point: ResumePoint) => void;
  onTop: () => void;
  onPick: () => void;
  onReadTrack: (trackGuid: string) => void;
  onRetry: () => void;
  onAskForModel: () => void;
};

const MUTED = { color: 'var(--text-muted)' };
const FROM_THE_TOP = 'so reading starts from the top.';

const SOURCE_LABEL: Record<NonNullable<ChapterTrackMatch['track']>['source'], string> = {
  confirmed: 'linked to this chapter',
  'track-name': 'matched by its name',
  'region-name': 'matched by a region name',
};

const WARNING_TEXT: Record<ChapterTrackMatch['warnings'][number], string> = {
  'confirmed-track-missing': 'The track linked to this chapter is no longer in the project.',
  'confirmed-track-renamed': 'The track linked to this chapter has been renamed since it was linked.',
  'confirmed-links-conflict': 'More than one track is linked to this chapter.',
};

/**
 * The matched sentence as a quote, with the resume word in bold when it falls inside it. `sentence.text` is the sentence's
 * script words joined by spaces (locate.py), so its word `word - start` is the resume word; a text that does not split
 * into `end - start` words is shown without the emphasis rather than with it on the wrong word.
 */
export function ResumeSentence({ sentence, word }: { sentence: Sentence; word: number }) {
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

/** The body of the resume card while the narrator has not chosen yet: one message and its next steps per lookup state. */
export function ResumeOffer({ state, onResume, onTop, onPick, onReadTrack, onRetry, onAskForModel }: Props) {
  if (state.kind === 'loading') return <p role="status">Finding where your recording of this chapter ends…</p>;
  if (state.kind === 'failed') {
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
  }
  const { result } = state;
  if (result.status === 'asset_required') {
    return (
      <Actions buttons={<Button onClick={onAskForModel}>Download model…</Button>}>
        <p>
          Finding where you stopped listens to the end of your recording with the {result.model.displayName} Whisper model, which is not downloaded yet. Until
          then reading starts from the top.
        </p>
      </Actions>
    );
  }
  return <LocatedOffer result={result} onResume={onResume} onTop={onTop} onPick={onPick} onReadTrack={onReadTrack} />;
}

function LocatedOffer({ result, onResume, onTop, onPick, onReadTrack }: { result: Located } & Pick<Props, 'onResume' | 'onTop' | 'onPick' | 'onReadTrack'>) {
  const [choosingTrack, setChoosingTrack] = useState(false);
  const { match, track, located } = result;
  if (result.status === 'no_track') return <NoTrack match={match} onReadTrack={onReadTrack} />;
  const trackName = track?.name ?? '';
  const picker = choosingTrack ? (
    <TrackPicker match={match} current={track?.guid} onReadTrack={onReadTrack} />
  ) : (
    <Button variant="ghost" onClick={() => setChoosingTrack(true)}>
      Another track
    </Button>
  );
  const bySource = match.track?.trackGuid === track?.guid && match.track ? SOURCE_LABEL[match.track.source] : 'your pick';
  const header = (
    <p style={MUTED}>
      {trackName} track, {bySource} · {savedLabel(match.savedAt)}
    </p>
  );
  const warnings = match.warnings.map((warning) => <p key={warning}>{WARNING_TEXT[warning]}</p>);
  const point: ResumePoint | null = located?.word != null ? { word: located.word, sentence: located.sentence } : null;

  if ((result.status === 'found' || result.status === 'low_confidence') && point && located) {
    const sure = `${Math.round(located.confidence * 100)}% sure`;
    return (
      <Actions
        buttons={
          <>
            <Button variant={located.confident ? 'primary' : 'ghost'} onClick={() => onResume(point)}>
              Resume from here
            </Button>
            <Button variant="ghost" onClick={onTop}>
              Start from the top
            </Button>
            <Button variant="ghost" onClick={onPick}>
              Pick a word
            </Button>
            {picker}
          </>
        }
      >
        {header}
        {warnings}
        <p>
          {located.confident
            ? `Resume at word ${point.word.toLocaleString()} of ${located.tokens.toLocaleString()} (${sure}), where your recording ends:`
            : `This is a guess: the end of your recording could also fit elsewhere in the chapter (${sure}). Check the sentence before resuming.`}
        </p>
        {point.sentence && <ResumeSentence sentence={point.sentence} word={point.word} />}
      </Actions>
    );
  }
  return (
    <Actions
      buttons={
        <>
          {result.status === 'not_found' && (
            <Button variant="ghost" onClick={onPick}>
              Pick a word
            </Button>
          )}
          {picker}
        </>
      }
    >
      {header}
      {warnings}
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
      return `The last ${seconds} seconds of your recording did not match this chapter's text, ${FROM_THE_TOP}`;
    }
    case 'no_recording':
      return `This track has no recorded audio yet, ${FROM_THE_TOP}`;
    case 'source_missing':
      return `The last item's audio file is missing (${file}), so where you stopped cannot be found and reading starts from the top.`;
    case 'source_unsupported':
      return `The last item's source (${file}) cannot be read as audio, ${FROM_THE_TOP}`;
    default:
      return `Where you stopped could not be found, ${FROM_THE_TOP}`;
  }
}

function NoTrack({ match, onReadTrack }: { match: ChapterTrackMatch; onReadTrack: (trackGuid: string) => void }) {
  const project = fileName(match.projectFile);
  const text =
    match.status === 'ambiguous'
      ? `More than one track in ${project} could hold this chapter. Choose the one it is recorded on; until then reading starts from the top.`
      : match.status === 'uncertain' && match.candidates[0]
        ? `The closest track in ${project}, ${match.candidates[0].trackName}, is not a sure match. Choose the track this chapter is recorded on; until then reading starts from the top.`
        : `No track in ${project} matches this chapter, ${FROM_THE_TOP} If it is recorded on a track with another name, choose it.`;
  return (
    <>
      <p>{text}</p>
      <TrackPicker match={match} onReadTrack={onReadTrack} />
    </>
  );
}

/** Every track of the project, the matcher's candidates first (best first), so the narrator can say which one holds the chapter. */
function TrackPicker({ match, current, onReadTrack }: { match: ChapterTrackMatch; current?: string; onReadTrack: (trackGuid: string) => void }) {
  const candidates = new Set(match.candidates.map((candidate) => candidate.trackGuid));
  const options = [
    ...match.candidates.map((candidate) => ({ value: candidate.trackGuid, label: `${candidate.trackName} (possible match)` })),
    ...match.tracks.filter((track) => !candidates.has(track.guid)).map((track) => ({ value: track.guid, label: track.name })),
  ].filter((option) => option.value !== current);
  const [chosen, setChosen] = useState(options[0]?.value ?? '');
  if (options.length === 0) return <p style={MUTED}>The project has no other track.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="Track" value={chosen} onChange={setChosen} options={options} />
      <Button variant="ghost" onClick={() => onReadTrack(chosen)} disabled={!chosen}>
        Read this track
      </Button>
    </div>
  );
}

function Actions({ children, buttons }: { children: ReactNode; buttons: ReactNode }) {
  return (
    <>
      <div className="space-y-2">{children}</div>
      <div className="flex flex-wrap items-center gap-2">{buttons}</div>
    </>
  );
}
