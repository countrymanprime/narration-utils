import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { ManuscriptChapter, RetailSampleAnswer } from '../../types';
import { formatMinutesSeconds } from '../../state';
import { Button } from '../primitives/Button';
import { Select } from '../primitives/Select';
import type { Notify } from '../primitives/Toast';

const isNarrationChapter = (chapter: ManuscriptChapter) => (chapter.contentKind ?? 'narration') === 'narration';
const lineOptions = (chapter?: ManuscriptChapter) =>
  (chapter?.paragraphIds ?? []).map((_, index) => ({ value: String(index + 1), label: `Line ${index + 1}` }));

type End = { chapterId: string; line: string };

// The Select primitive names its control but shows no label, so the label is shown above it, as Settings > Credits' Kind is.
function LabelledSelect(props: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="text-[0.82rem] font-medium text-[var(--text-muted)]">
      <span aria-hidden="true">{props.label}</span>
      <Select {...props} fullWidth />
    </div>
  );
}

// The host's messages start in lower case (Go convention); the panel shows them as sentences.
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Settings > Credits > Retail sample (audiobook-credits-templates.prd.md Phase 5, Open Question C10, ADR 0152): the
 * narrator picks where the sample starts and ends, anywhere in the book, by chapter and the line numbers the Manuscript
 * reader shows. The host measures it and refuses a range over 5 minutes; it is a marker only and adds no time to the
 * estimate.
 */
export function RetailSamplePanel({ notify }: { notify: Notify }) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [answer, setAnswer] = useState<RetailSampleAnswer>();
  const [start, setStart] = useState<End>({ chapterId: '', line: '1' });
  const [end, setEnd] = useState<End>({ chapterId: '', line: '1' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextChapters, nextAnswer] = await Promise.all([api.manuscriptChapters(), api.creditsRetailSample()]);
      const narration = nextChapters.filter(isNarrationChapter);
      setChapters(narration);
      setAnswer(nextAnswer);
      const first = narration[0]?.id ?? '';
      const sample = nextAnswer.sample;
      setStart(sample ? { chapterId: sample.startChapterId, line: String(sample.startLine) } : { chapterId: first, line: '1' });
      setEnd(sample ? { chapterId: sample.endChapterId, line: String(sample.endLine) } : { chapterId: first, line: '1' });
      setError('');
    } catch (loadError) {
      setError(apiErrorMessage(loadError));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map(chapters.map((chapter) => [chapter.id, chapter])), [chapters]);
  const paragraphId = (at: End) => byId.get(at.chapterId)?.paragraphIds?.[Number(at.line) - 1]?.id ?? '';
  const titleOf = (chapterId: string) => byId.get(chapterId)?.title ?? chapterId;
  const chapterOptions = chapters.map((chapter) => ({ value: chapter.id, label: chapter.title }));

  const save = async (startId: string, endId: string, done: string) => {
    setBusy(true);
    try {
      setAnswer(await api.saveCreditsRetailSample(startId, endId));
      setError('');
      notify(done);
    } catch (saveError) {
      setError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const sample = answer?.sample;
  return (
    <section aria-labelledby="credits-sample-heading" className="space-y-3">
      <h3 id="credits-sample-heading" className="font-medium">
        Retail sample
      </h3>
      <p style={{ color: 'var(--text-muted)' }}>
        Pick up to 5 minutes from anywhere in the book. The sample is marked in the Manuscript view; it adds no time to the estimate.
      </p>
      <p aria-live="polite">
        {sample
          ? `${titleOf(sample.startChapterId)}, line ${sample.startLine} to ${titleOf(sample.endChapterId)}, line ${sample.endLine}: ${sample.words.toLocaleString()} words, about ${formatMinutesSeconds(sample.seconds)}.`
          : answer?.problem
            ? `The saved sample cannot be shown: ${answer.problem}.`
            : 'No retail sample picked yet.'}
      </p>
      {chapters.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <LabelledSelect
            label="Sample starts in"
            value={start.chapterId}
            onChange={(chapterId) => setStart({ chapterId, line: '1' })}
            options={chapterOptions}
          />
          <LabelledSelect
            label="Start line"
            value={start.line}
            onChange={(line) => setStart({ ...start, line })}
            options={lineOptions(byId.get(start.chapterId))}
          />
          <LabelledSelect label="Sample ends in" value={end.chapterId} onChange={(chapterId) => setEnd({ chapterId, line: '1' })} options={chapterOptions} />
          <LabelledSelect label="End line" value={end.line} onChange={(line) => setEnd({ ...end, line })} options={lineOptions(byId.get(end.chapterId))} />
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--danger-text)' }}>
          {sentence(error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="button"
          disabled={busy || chapters.length === 0}
          pending={busy}
          onClick={() => void save(paragraphId(start), paragraphId(end), 'Retail sample saved.')}
        >
          Save sample
        </Button>
        <Button variant="ghost" type="button" disabled={busy || (!sample && !answer?.problem)} onClick={() => void save('', '', 'Retail sample cleared.')}>
          Clear sample
        </Button>
      </div>
    </section>
  );
}
