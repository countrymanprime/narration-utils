import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPlay, faWandMagicSparkles, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { Discrepancy, TranscriptState } from '../../types';
import { isTranscriptActive } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Pill } from '../primitives/Pill';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { Results } from './Results';

const seconds = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(value % 60)
    .toString()
    .padStart(2, '0')}`;

type ModelOption = { value: string; label: string; caption: string };
const MODEL_OPTIONS: ModelOption[] = [
  { value: 'tiny', label: 'Tiny', caption: 'Fastest · rough accuracy · ~1 GB RAM' },
  { value: 'small', label: 'Small', caption: 'Balanced speed and accuracy · ~2 GB RAM' },
  { value: 'medium', label: 'Medium', caption: 'More accurate, slower · ~5 GB RAM' },
  { value: 'large-v3-turbo', label: 'Turbo', caption: "Distilled from Large - close to its accuracy, closer to Medium's speed · ~6 GB RAM" },
  { value: 'large-v3', label: 'Large', caption: 'Best accuracy, slowest · ~10 GB RAM' },
];
// Each worker loads a separate full copy of the model, so bigger models allow fewer.
const WORKER_LIMITS: Record<string, string[]> = {
  tiny: ['Auto', '1', '2', '4'],
  small: ['Auto', '1', '2', '4'],
  medium: ['Auto', '1', '2'],
  'large-v3-turbo': ['Auto', '1', '2'],
  'large-v3': ['1'],
};
const CHUNK_OPTIONS = [30, 60, 300, 600];
const CHUNK_LABELS = ['30s', '1m', '5m', '10m'];
const CHUNK_LIMIT_INDEX: Record<string, number> = { tiny: 3, small: 3, medium: 2, 'large-v3-turbo': 2, 'large-v3': 1 };
const CHUNK_LENGTH_TOOLTIP = [
  'Shorter chunks transcribe in parallel faster but can split a sentence across a boundary.',
  'Longer chunks on a big model risk running out of memory, so the range is capped by the model you pick.',
].join(' ');
const modelLabel = (value: string) => MODEL_OPTIONS.find((option) => option.value === value)?.label ?? value;

export function Transcript({
  state,
  notify,
  goToManuscript,
  goHome,
}: {
  state: TranscriptState;
  notify: (text: string) => void;
  goToManuscript: (chapter: string, paragraph: number) => void;
  goHome: () => void;
}) {
  const api = useApi();
  const [model, setModel] = useState('small');
  const [chunkIndex, setChunkIndex] = useState(1);
  const [workers, setWorkers] = useState('Auto');
  const [acceptedHints, setAcceptedHints] = useState<string[]>([]);
  const [pendingHints, setPendingHints] = useState<string[]>([]);
  const [manualHint, setManualHint] = useState('');
  const [logVerbosity, setLogVerbosity] = useState<'Quiet' | 'Normal' | 'Verbose'>('Normal');
  const [selected, setSelected] = useState<Discrepancy>();
  const [lastCompleted, setLastCompleted] = useState<TranscriptState>();
  const [reviewingLast, setReviewingLast] = useState(false);
  const running = isTranscriptActive(state.phase);

  useEffect(() => {
    (async () => {
      try {
        setAcceptedHints(await api.transcriptHints());
      } catch {
        /* no manuscript selected yet */
      }
    })();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const settings = await api.settingsForScope('project');
        const fields = settings.TranscriptCompare || [];
        const modelSetting = fields.find((field) => field.key === 'model_size');
        const chunkSetting = fields.find((field) => field.key === 'chunk_seconds');
        if (modelSetting?.effectiveValue) setModel(modelSetting.effectiveValue);
        const index = CHUNK_OPTIONS.indexOf(Number(chunkSetting?.effectiveValue));
        if (index >= 0) setChunkIndex(index);
      } catch {
        /* defaults remain usable */
      }
    })();
  }, []);
  useEffect(() => {
    void api
      .transcriptLastCompleted()
      .then(setLastCompleted)
      .catch(() => {});
  }, []);

  const selectModel = (value: string) => {
    setModel(value);
    if (!WORKER_LIMITS[value].includes(workers)) {
      const previous = workers;
      setWorkers(WORKER_LIMITS[value][0]);
      notify(`Workers adjusted to ${WORKER_LIMITS[value][0]} — ${modelLabel(value)} doesn't support ${previous}.`);
    }
    const maxIndex = CHUNK_LIMIT_INDEX[value];
    if (chunkIndex > maxIndex) {
      const previous = CHUNK_LABELS[chunkIndex];
      setChunkIndex(maxIndex);
      notify(`Chunk length adjusted to ${CHUNK_LABELS[maxIndex]} — ${modelLabel(value)} doesn't support ${previous}.`);
    }
  };

  const saveHints = async (next: string[]) => {
    setAcceptedHints(next);
    try {
      await api.transcriptSaveHints(next);
    } catch (error) {
      notify(String(error));
    }
  };
  const acceptHint = (term: string) => {
    setPendingHints((current) => current.filter((item) => item !== term));
    if (!acceptedHints.includes(term)) void saveHints([...acceptedHints, term]);
  };
  const removeHint = (term: string) => void saveHints(acceptedHints.filter((item) => item !== term));
  const addManualHint = () => {
    const value = manualHint.trim();
    if (!value) return;
    setManualHint('');
    if (!acceptedHints.includes(value)) void saveHints([...acceptedHints, value]);
  };
  const suggestHints = async () => {
    try {
      const suggested = (await api.transcriptSuggestHints())
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      const fresh = suggested.filter((term) => !acceptedHints.includes(term));
      setPendingHints((current) => Array.from(new Set([...current, ...fresh])));
      notify(
        fresh.length > 0
          ? `Found ${fresh.length} new suggestion${fresh.length === 1 ? '' : 's'}.`
          : 'No new suggestions — everything found is already accepted.',
      );
    } catch (error) {
      notify(String(error));
    }
  };

  const start = async (chapterTitle?: string) => {
    try {
      await api.transcriptStart({ model, chunk: String(CHUNK_OPTIONS[chunkIndex]), workers, hints: acceptedHints.join(', '), chapterTitle });
    } catch (error) {
      notify(String(error));
    }
  };

  const phase = state.phase === 'success' ? 'results' : state.phase === 'need_chapter' ? 'chapter' : running ? 'running' : 'setup';
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Heading title="Proofing" />
        <div className="flex items-center gap-1 text-xs">
          <span
            className={`f-label rounded px-2 py-1 ${phase === 'setup' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'setup' ? 'var(--accent-soft)' : undefined }}
          >
            1 · Setup
          </span>
          <span style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className={`f-label rounded px-2 py-1 ${phase === 'running' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'running' ? 'var(--accent-soft)' : undefined }}
          >
            2 · Running
          </span>
          <span style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className={`f-label rounded px-2 py-1 ${phase === 'results' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'results' ? 'var(--accent-soft)' : undefined }}
          >
            3 · Results
          </span>
        </div>
      </div>
      {phase === 'setup' && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="text-sm font-semibold">Setup</h2>
            {lastCompleted ? (
              <button
                className="text-xs underline"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => {
                  setSelected(undefined);
                  setReviewingLast(true);
                }}
              >
                Last narrated take: Track 3 — “Ch.1 take 4”
              </button>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Last narrated take: Track 3 — “Ch.1 take 4”
              </span>
            )}
          </div>
          <div className="panel-body space-y-4">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label className="label">
                  Whisper model
                  <Tooltip text="Bigger models catch more misreads but run slower and use more memory per instance. Chunk length and worker count are capped automatically once you pick a model." />
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {MODEL_OPTIONS.map((option) => (
                    <Pill
                      key={option.value}
                      label={option.label}
                      active={model === option.value}
                      title={option.caption}
                      onClick={() => selectModel(option.value)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="label">
                  Chunk length
                  <Tooltip text={CHUNK_LENGTH_TOOLTIP} />
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CHUNK_LABELS.map((label, index) => (
                    <Pill
                      key={label}
                      label={label}
                      active={chunkIndex === index}
                      disabled={index > CHUNK_LIMIT_INDEX[model]}
                      title={index > CHUNK_LIMIT_INDEX[model] ? `Not available for ${modelLabel(model)}` : undefined}
                      onClick={() => setChunkIndex(index)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="label">
                  Parallel workers
                  <Tooltip text="Each worker loads its own full copy of the Whisper model, so memory use multiplies with worker count. Auto picks a safe count for this machine." />
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {['Auto', '1', '2', '4'].map((option) => {
                    const allowed = WORKER_LIMITS[model].includes(option);
                    return (
                      <Pill
                        key={option}
                        label={option}
                        active={workers === option}
                        disabled={!allowed}
                        title={allowed ? undefined : `${modelLabel(model)} needs the full model in memory per worker — not available`}
                        onClick={() => setWorkers(option)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5">
              <label className="label mb-1.5 block">
                Vocabulary hints
                <Tooltip text="Unusual names and invented words Whisper is likely to mis-hear. Accepted hints are remembered for this project - you won't need to re-suggest them every run." />
              </label>
              <div className="flex min-h-11 flex-wrap gap-2 rounded-md p-2" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                {acceptedHints.map((term) => (
                  <span key={term} className="chip accepted">
                    {term}
                    <button aria-label={`Remove ${term}`} onClick={() => removeHint(term)}>
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </span>
                ))}
                {pendingHints.map((term) => (
                  <TooltipTarget key={term} text="Suggested — click to accept">
                    <button className="chip pending" onClick={() => acceptHint(term)}>
                      + {term}
                    </button>
                  </TooltipTarget>
                ))}
                {acceptedHints.length === 0 && pendingHints.length === 0 && (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    No hints yet — add one, or suggest from the manuscript.
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="input w-48"
                  value={manualHint}
                  placeholder="Add a term…"
                  onChange={(event) => setManualHint(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addManualHint();
                    }
                  }}
                />
                <button className="btn btn-ghost" onClick={addManualHint}>
                  Add
                </button>
                <button className="btn btn-ghost" onClick={() => void suggestHints()}>
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  Suggest from manuscript
                </button>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between gap-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <button className="btn btn-ghost" onClick={goHome}>
                <FontAwesomeIcon icon={faArrowLeft} />
                Back to Home
              </button>
              <button className="btn btn-primary" onClick={() => void start()}>
                <FontAwesomeIcon icon={faPlay} />
                Start comparison
              </button>
            </div>
          </div>
        </section>
      )}
      {phase === 'chapter' && (
        <Panel>
          <h2 className="font-medium">Choose manuscript chapter</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            The track name did not confidently match a chapter.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.chapters.map((chapter) => (
              <button className="btn btn-ghost" key={chapter} onClick={() => void start(chapter)}>
                {chapter}
              </button>
            ))}
          </div>
        </Panel>
      )}
      {running && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="f-label text-lg">Running</h2>
            <span className="f-mono text-xs" style={{ color: 'var(--text-muted)' }}>
              {seconds(state.elapsed)} elapsed
            </span>
          </div>
          <div className="panel-body">
            <div className="flex justify-between text-sm">
              <span>{state.phase === 'success' ? state.summary : state.message}</span>
              <span>
                {state.percent}% · {seconds(state.elapsed)}
              </span>
            </div>
            <div className="progressbar mt-3">
              <div style={{ width: `${state.percent}%` }} />
            </div>
            <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="section-label">Live activity</span>
                <span className="flex gap-1 text-[.65rem] normal-case">
                  {(['Quiet', 'Normal', 'Verbose'] as const).map((mode) => (
                    <button key={mode} className={`swatch-toggle ${logVerbosity === mode ? 'active' : ''}`} onClick={() => setLogVerbosity(mode)}>
                      {mode}
                    </button>
                  ))}
                </span>
              </div>
              <div className="run-log f-mono">
                {(logVerbosity === 'Verbose'
                  ? state.logs
                  : logVerbosity === 'Quiet'
                    ? state.logs.filter((line) => /complete|error|cancel/i.test(line))
                    : state.logs.filter((line) => /Exported|Loaded|Whisper|Chunk|complete|error|match|cancel/i.test(line))
                ).map((line) => (
                  <div key={line} className="run-log-entry">
                    {line}
                  </div>
                ))}
                {state.logs.length === 0 && (
                  <div className="run-log-entry" style={{ color: 'var(--text-faint)' }}>
                    Waiting for notable events…
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              {import.meta.env.MODE === 'mock' && (
                <button className="btn btn-ghost text-xs" onClick={() => void api.transcriptReset()}>
                  Skip to results (demo)
                </button>
              )}
              <button className="btn btn-danger" onClick={() => void api.transcriptCancel()}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}
      {(state.phase === 'success' || reviewingLast) && (
        <Results
          state={reviewingLast && lastCompleted ? lastCompleted : state}
          selected={selected}
          select={setSelected}
          notify={notify}
          reset={() => {
            setSelected(undefined);
            setReviewingLast(false);
            if (!reviewingLast) void api.transcriptReset();
          }}
          canExportMarkers={!reviewingLast}
          goToManuscript={(row) => goToManuscript(row.chapter || '', row.paragraph || 0)}
        />
      )}
    </div>
  );
}
