import { useEffect, useState } from 'react';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { useApi } from '../../api/ApiContext';
import { ChapterSuggestionHint, preselectedChapter } from './ChapterSuggestionHint';
import { ReadAlongView } from './ReadAlongView';
import { ACTIVE_PHASES, errorText, useTeleprompterSession } from './useTeleprompterSession';
import type { ChapterSuggestion, ManuscriptChapter } from '../../types';

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

export function TeleprompterPage() {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [chosenChapter, setChosenChapter] = useState('');
  const [suggestion, setSuggestion] = useState<ChapterSuggestion>();
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void Promise.all([
      api.manuscriptChapters(),
      api.readerState().catch(() => undefined),
      // The REAPER suggestion (ADR 0113) is only a hint: no .rpp in the project, or none chosen yet, is the normal case
      // for a narrator not using REAPER, so a failure means no hint rather than an error on the page.
      api.chapterSuggestion().catch(() => undefined),
      api.teleprompterState().catch(() => undefined),
    ])
      .then(([all, reader, suggested, host]) => {
        if (!live) return;
        const narration = all.filter((item) => (item.contentKind ?? 'narration') === 'narration');
        setChapters(narration);
        setSuggestion(suggested);
        const last = narration.find((item) => item.id === reader?.activeChapter || item.title === reader?.activeChapter);
        // A confident suggestion names the chapter being recorded, so it wins over the last chapter read - but never
        // over a session already running, whose chapter the reader is showing.
        const sessionRunning = host && ACTIVE_PHASES.includes(host.phase);
        const recording = sessionRunning ? undefined : preselectedChapter(suggested, narration);
        setChosenChapter((current) => current || recording || (last ?? narration[0])?.id || '');
      })
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api]);

  // A session in progress (or just finished) decides which chapter is shown.
  const chapterId = chosenChapter;
  const t = useTeleprompterSession({ chapterId, chapter: chapters?.find((item) => item.id === chapterId) });

  const selectChapter = (id: string) => {
    setChosenChapter(id);
    t.reset();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Heading title="Teleprompter">Read a chapter aloud and follow along - the highlight moves with your voice.</Heading>
      {chapters?.length === 0 && (
        <Panel title="This manuscript has no chapters to read">
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            The teleprompter reads narration chapters. Import a manuscript with at least one narration chapter first.
          </p>
        </Panel>
      )}
      {chapters && chapters.length > 0 && (
        <ReadAlongView
          session={t}
          extraSetupFields={
            <div>
              <label className={LABEL_CLASS} htmlFor="teleprompter-chapter">
                Chapter
              </label>
              <Select
                id="teleprompter-chapter"
                className="mt-1"
                fullWidth
                value={chapterId}
                onChange={selectChapter}
                options={chapters.map((item) => ({ value: item.id, label: item.subtitle ? `${item.title}: ${item.subtitle}` : item.title }))}
              />
              <ChapterSuggestionHint suggestion={suggestion} chapters={chapters} value={chapterId} onChoose={selectChapter} />
            </div>
          }
        />
      )}
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
