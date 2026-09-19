import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPlay, faWandMagicSparkles, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { Discrepancy, TranscriptState, TranscriptStartResult, WhisperInstallJob } from '../../types';
import { isTranscriptActive } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Pill } from '../primitives/Pill';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { Results } from './Results';
import { PROOFING_CHUNK_OPTIONS } from './options';

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
const CHUNK_OPTIONS: number[] = PROOFING_CHUNK_OPTIONS.map((option) => option.seconds);
const CHUNK_LABELS = PROOFING_CHUNK_OPTIONS.map((option) => option.label);
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
  const [whisperPrompt, setWhisperPrompt] = useState<Extract<TranscriptStartResult, { status: 'asset_required' }>>();
  const [whisperJob, setWhisperJob] = useState<WhisperInstallJob>();
  const [pendingChapterTitle, setPendingChapterTitle] = useState<string>();
  const running = isTranscriptActive(state.phase);

  useEffect(() => {
    (async () => {
      try {
        setAcceptedHints(await api.transcriptHints());
      } catch {
        /* no manuscript selected yet */
      }
    })();
  }, [api]);
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
  }, [api]);
  useEffect(() => {
    void api
      .transcriptLastCompleted()
      .then(setLastCompleted)
      .catch(() => {});
  }, [api]);

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
      const result = await api.transcriptStart({ model, chunk: String(CHUNK_OPTIONS[chunkIndex]), workers, hints: acceptedHints.join(', '), chapterTitle });
      if (result.status === 'asset_required') {
        setWhisperJob(undefined);
        setWhisperPrompt(result);
        setPendingChapterTitle(chapterTitle);
      }
    } catch (error) {
      notify(String(error));
    }
  };
  const installWhisperModel = async () => {
    if (!whisperPrompt || whisperJob?.phase === 'running') return;
    try {
      let job = await api.whisperInstall(whisperPrompt.model.id);
      setWhisperJob(job);
      while (job.id && job.phase === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        job = await api.whisperInstallState(job.id);
        setWhisperJob(job);
      }
      if (job.phase === 'success') {
        const chapterTitle = pendingChapterTitle;
        setWhisperPrompt(undefined);
        setWhisperJob(undefined);
        notify('Whisper model installed.');
        await start(chapterTitle);
      } else if (job.phase !== 'cancelled') notify(job.message);
    } catch (error) {
      notify(String(error));
    }
  };
  const cancelWhisperModelInstall = async () => {
    if (whisperJob?.id && whisperJob.phase === 'running') {
      try {
        setWhisperJob(await api.whisperInstallCancel(whisperJob.id));
      } catch (error) {
        notify(String(error));
      }
      return;
    }
    setWhisperPrompt(undefined);
    setWhisperJob(undefined);
  };

  const phase = state.phase === 'success' ? 'results' : state.phase === 'need_chapter' ? 'chapter' : running ? 'running' : 'setup';
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Heading title="Proofing" />
        <div className="flex items-center gap-1 text-xs">
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'setup' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'setup' ? 'var(--accent-soft)' : undefined }}
          >
            1 · Setup
          </span>
          <span style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'running' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'running' ? 'var(--accent-soft)' : undefined }}
          >
            2 · Running
          </span>
          <span style={{ color: 'var(--text-faint)' }}>→</span>
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'results' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'results' ? 'var(--accent-soft)' : undefined }}
          >
            3 · Results
          </span>
        </div>
      </div>
      {phase === 'setup' && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
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
                Last narrated take: {lastCompleted.trackName || 'Selected REAPER audio'}
                {lastCompleted.audioItemCount ? ` · ${lastCompleted.audioItemCount} audio item${lastCompleted.audioItemCount === 1 ? '' : 's'}` : ''}
                {lastCompleted.completedAt ? ` · ${new Date(lastCompleted.completedAt).toLocaleString()}` : ''}
              </button>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No narrated take yet
              </span>
            )}
          </div>
          <div className="space-y-4 p-[1.1rem]">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label className="text-[0.82rem] font-medium text-[var(--text-muted)]">
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
                <label className="text-[0.82rem] font-medium text-[var(--text-muted)]">
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
                <label className="text-[0.82rem] font-medium text-[var(--text-muted)]">
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
            <div>
              <label className="mb-1.5 block text-[0.82rem] font-medium text-[var(--text-muted)]">
                Vocabulary hints
                <Tooltip text="Unusual names and invented words Whisper is likely to mis-hear. Accepted hints are remembered for this project - you won't need to re-suggest them every run." />
              </label>
              <div className="flex min-h-11 flex-wrap gap-2 rounded-md p-2" style={{ border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                {acceptedHints.map((term) => (
                  <span
                    key={term}
                    className="inline-flex items-center gap-[0.35rem] rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-[0.55rem] py-[0.3rem] font-['IBM_Plex_Mono',monospace] text-[0.8rem] text-[var(--accent-strong)]"
                  >
                    {term}
                    <button aria-label={`Remove ${term}`} onClick={() => removeHint(term)}>
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </span>
                ))}
                {pendingHints.map((term) => (
                  <TooltipTarget key={term} text="Suggested — click to accept">
                    <button
                      className="inline-flex items-center gap-[0.35rem] rounded-full border border-dashed border-[var(--border)] bg-transparent px-[0.55rem] py-[0.3rem] font-['IBM_Plex_Mono',monospace] text-[0.8rem] text-[var(--text-muted)]"
                      onClick={() => acceptHint(term)}
                    >
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
                  className="min-h-[var(--control-height)] w-48 rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
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
                <Button variant="ghost" onClick={addManualHint}>
                  Add
                </Button>
                <Button variant="ghost" onClick={() => void suggestHints()}>
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  Suggest from manuscript
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <Button variant="ghost" onClick={goHome}>
                <FontAwesomeIcon icon={faArrowLeft} />
                Back to Home
              </Button>
              <Button variant="primary" onClick={() => void start()}>
                <FontAwesomeIcon icon={faPlay} />
                Start comparison
              </Button>
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
              <Button variant="ghost" key={chapter} onClick={() => void start(chapter)}>
                {chapter}
              </Button>
            ))}
          </div>
        </Panel>
      )}
      {running && (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
            <h2 className="font-['Barlow_Condensed',sans-serif] text-lg tracking-[0.08em] uppercase">Running</h2>
            <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
              {seconds(state.elapsed)} elapsed
            </span>
          </div>
          <div className="p-[1.1rem]">
            <div className="flex justify-between text-sm">
              <span>{state.phase === 'success' ? state.summary : state.message}</span>
              <span>
                {state.percent}% · {seconds(state.elapsed)}
              </span>
            </div>
            <div className="progressbar mt-3 h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div className="h-full bg-[var(--accent)] transition-[width] duration-[0.4s] ease-in-out" style={{ width: `${state.percent}%` }} />
            </div>
            <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
                  Live activity
                </span>
                <span className="flex gap-1 text-[.65rem] normal-case">
                  {(['Quiet', 'Normal', 'Verbose'] as const).map((mode) => (
                    <Pill key={mode} label={mode} active={logVerbosity === mode} onClick={() => setLogVerbosity(mode)} />
                  ))}
                </span>
              </div>
              <div className="h-36 overflow-y-auto border border-[var(--border)] bg-[var(--surface-2)] font-['IBM_Plex_Mono',ui-monospace,monospace]">
                {(logVerbosity === 'Verbose'
                  ? state.logs
                  : logVerbosity === 'Quiet'
                    ? state.logs.filter((line) => /complete|error|cancel/i.test(line))
                    : state.logs.filter((line) => /Exported|Loaded|Whisper|Chunk|complete|error|match|cancel/i.test(line))
                ).map((line) => (
                  <div key={line} className="border-b border-[var(--border)] px-[0.45rem] py-1">
                    {line}
                  </div>
                ))}
                {state.logs.length === 0 && (
                  <div className="border-b border-[var(--border)] px-[0.45rem] py-1" style={{ color: 'var(--text-faint)' }}>
                    Waiting for notable events…
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              {import.meta.env.MODE === 'mock' && (
                <Button variant="ghost" className="text-xs" onClick={() => void api.transcriptReset()}>
                  Skip to results (demo)
                </Button>
              )}
              <Button variant="danger" onClick={() => void api.transcriptCancel()}>
                Cancel
              </Button>
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
      {whisperPrompt && (
        <ConfirmDialog
          title={whisperJob?.phase === 'running' ? 'Downloading Whisper model' : 'Download local Whisper model?'}
          body={
            whisperJob?.phase === 'running'
              ? whisperJob.message
              : `The ${whisperPrompt.model.displayName} Whisper model is needed to transcribe this comparison. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`
          }
          confirmLabel={whisperJob?.phase === 'running' ? 'Downloading…' : 'Download model'}
          confirm={() => void installWhisperModel()}
          cancel={() => void cancelWhisperModelInstall()}
        >
          <dl className="mt-3 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div>
              <dt className="inline font-medium">Model: </dt>
              <dd className="inline">{whisperPrompt.model.displayName}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Download: </dt>
              <dd className="inline">
                {Math.ceil(whisperPrompt.downloadSize / (1024 * 1024))} MB · {whisperPrompt.model.publisher}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium">License: </dt>
              <dd className="inline">
                <a className="link" href={whisperPrompt.model.licenseUrl} target="_blank" rel="noreferrer">
                  {whisperPrompt.model.license}
                </a>
              </dd>
            </div>
          </dl>
        </ConfirmDialog>
      )}
    </div>
  );
}
