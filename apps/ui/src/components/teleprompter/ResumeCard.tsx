import { useEffect, useState } from 'react';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { ResumeOffer, ResumeSentence, type ResumePoint } from './ResumeOffer';
import { useResumeLocate } from './useResumeLocate';
import { WhisperModelPrompt } from './WhisperModelPrompt';

type Props = {
  chapterId: string;
  /** The session's Whisper model, which the lookup transcribes the recording's tail with. */
  model: string;
  /** Sets where the next Start begins (`useTeleprompterSession.setStartWord`); null is the top. */
  onStartWord: (word: number | null) => void;
};

// What the narrator chose from the offer. `resume` keeps the point so the summary can show its sentence.
type Choice = { kind: 'offer' } | { kind: 'resume'; point: ResumePoint } | { kind: 'top' } | { kind: 'pick' };

/**
 * The read-aloud dialog's resume card (teleprompter-manuscript-integration.prd.md Phase 10): where the chapter's recording
 * ends, found from its tail audio (`TeleprompterLocate`, ADR 0111), offered as "Resume from here" with the sentence it
 * matched, beside "Start from the top" and "Pick a word". It never starts reading by itself: a choice only sets where Start
 * begins. When the chapter's track is not certain it asks the narrator to pick one, and it never guesses between tracks.
 */
export function ResumeCard({ chapterId, model, onStartWord }: Props) {
  const lookup = useResumeLocate(chapterId, model);
  const [choice, setChoice] = useState<Choice>({ kind: 'offer' });
  // The card is shown only between sessions and asks again each time it appears, so a start word chosen before the last
  // session is not carried into the next one: Start begins at the top until the narrator chooses again.
  useEffect(() => onStartWord(null), [onStartWord]);

  const choose = (next: Choice) => {
    setChoice(next);
    onStartWord(next.kind === 'resume' ? next.point.word : null);
  };
  const readTrack = (trackGuid: string) => {
    choose({ kind: 'offer' });
    lookup.locate(trackGuid);
  };

  return (
    <Panel title="Where you stopped">
      <div className="mt-2 space-y-3 text-sm">
        {choice.kind === 'offer' ? (
          <ResumeOffer
            state={lookup.state}
            onResume={(point) => choose({ kind: 'resume', point })}
            onTop={() => choose({ kind: 'top' })}
            onPick={() => choose({ kind: 'pick' })}
            onReadTrack={readTrack}
            onRetry={lookup.retry}
            onAskForModel={lookup.askForModel}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <ChoiceSummary choice={choice} />
            </div>
            <Button variant="ghost" onClick={() => choose({ kind: 'offer' })}>
              Change
            </Button>
          </div>
        )}
      </div>
      {lookup.prompt && (
        <WhisperModelPrompt
          prompt={lookup.prompt}
          purpose="listens to the end of your recording to find where you stopped"
          install={lookup.modelInstall}
          dismiss={lookup.closeModelPrompt}
        />
      )}
    </Panel>
  );
}

function ChoiceSummary({ choice }: { choice: Exclude<Choice, { kind: 'offer' }> }) {
  if (choice.kind === 'top') return <>Reading starts from the top.</>;
  if (choice.kind === 'pick') return <>Start reading, then click the word you want to go to (&ldquo;Start here&rdquo;).</>;
  return (
    <>
      Start reading picks up at word {choice.point.word.toLocaleString()}
      {choice.point.sentence ? ', in:' : '.'}
      {choice.point.sentence && (
        <span className="mt-2 block">
          <ResumeSentence sentence={choice.point.sentence} word={choice.point.word} />
        </span>
      )}
    </>
  );
}
