import { Button } from '../primitives/Button';
import type { ChapterSuggestion, ManuscriptChapter } from '../../types';

const MUTED = { color: 'var(--text-muted)' };
const CONFIDENT: ReadonlyArray<ChapterSuggestion['status']> = ['confirmed', 'matched'];

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Is a suggestion confident enough to preselect (ADR 0113)? Only a confirmed link or a confident name match is. */
export function preselectedChapter(suggestion: ChapterSuggestion | undefined, chapters: ManuscriptChapter[]): string | undefined {
  const id = suggestion && CONFIDENT.includes(suggestion.status) ? suggestion.chapter?.chapterId : undefined;
  return chapters.some((chapter) => chapter.id === id) ? id : undefined;
}

/** "REAPER's armed track Chapter 2 in Alice.rpp": which saved track(s) the suggestion was read from. */
function trackPhrase(suggestion: ChapterSuggestion): string {
  const state = suggestion.basis === 'armed' ? 'armed' : 'selected';
  const project = fileName(suggestion.projectFile);
  return suggestion.track ? `REAPER's ${state} track, “${suggestion.track.name}” in ${project},` : `REAPER's ${state} tracks in ${project},`;
}

type Props = {
  suggestion: ChapterSuggestion | undefined;
  /** The chapters the picker offers (narration only): a suggestion outside them is never shown. */
  chapters: ManuscriptChapter[];
  value: string;
  onChoose: (chapterId: string) => void;
};

/**
 * The chapter picker's REAPER hint (teleprompter-engines-and-input-devices PRD Phase 11, ADR 0113): says which chapter
 * the saved project's armed (else selected) track is for. A confident suggestion is preselected by the page and only
 * explained here, or offered back once the narrator picks another chapter; an unsure one (uncertain or ambiguous) is
 * only ever offered as choices, never chosen. Nothing shows when there is no suggestion.
 */
export function ChapterSuggestionHint({ suggestion, chapters, value, onChoose }: Props) {
  if (!suggestion || suggestion.basis === 'none') return null;
  const inPicker = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const confident = preselectedChapter(suggestion, chapters);
  const saved = 'as of its last save';

  if (confident) {
    const chapter = inPicker.get(confident)!;
    const verb = suggestion.track ? 'is' : 'are';
    if (confident === value) {
      const why = suggestion.status === 'confirmed' ? `${verb} linked to this chapter` : `${verb} named for this chapter`;
      return (
        <p className="mt-1.5 text-[0.8rem]" style={MUTED}>
          Chosen from {trackPhrase(suggestion)} which {why} ({saved}).
        </p>
      );
    }
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.8rem]" style={MUTED}>
        <span>
          {trackPhrase(suggestion)} {saved}, {verb} for {chapter.title}.
        </span>
        <Button variant="ghost" className="px-2.5 py-1" onClick={() => onChoose(confident)}>
          Use {chapter.title}
        </Button>
      </div>
    );
  }

  const offered = suggestion.candidates.filter((candidate) => inPicker.has(candidate.chapterId) && candidate.chapterId !== value);
  if (offered.length === 0) return null;
  const lead = suggestion.status === 'ambiguous' ? 'could be for more than one chapter' : 'may be for';
  return (
    <div className="mt-1.5 space-y-1.5 text-[0.8rem]" style={MUTED}>
      <p>
        {trackPhrase(suggestion)} {saved}, {lead}
        {suggestion.status === 'ambiguous' ? '. Choose one if it is the chapter you are recording:' : ':'}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Chapters suggested by REAPER">
        {offered.map((candidate) => (
          <Button key={candidate.chapterId} variant="ghost" className="px-2.5 py-1" onClick={() => onChoose(candidate.chapterId)}>
            {inPicker.get(candidate.chapterId)!.title}
          </Button>
        ))}
      </div>
    </div>
  );
}
