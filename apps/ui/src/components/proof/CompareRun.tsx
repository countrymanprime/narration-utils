import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExport, faPlay, faRotateLeft, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import type { TranscriptState, TranscriptStartResult, WhisperInstallJob } from '../../types';
import { isTranscriptActive } from '../../state';
import { useApi } from '../../api/ApiContext';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { usePendingAction } from '../../hooks/usePendingAction';
import { dawCapabilityGate } from '../../dawAvailability';
import { useCapability } from '../../useCapability';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import { Button } from '../primitives/Button';
import { CapabilityGate, type CapabilityEntry } from '../primitives/CapabilityGate';
import { IconButton } from '../primitives/IconButton';
import { Panel } from '../primitives/Panel';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TagInput } from '../primitives/TagInput';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { hasHint, splitHintTerms, suggestionMessage } from './hints';
import { PROOFING_CHUNK_OPTIONS } from './options';
import type { Notify } from '../primitives/Toast';

/** The host rejects with its error text as a plain string; an Error carries it in `message`. */
const errorText = apiErrorMessage;

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
const LOG_VERBOSITY_OPTIONS = ['Quiet', 'Normal', 'Verbose'].map((mode) => ({ value: mode, label: mode }));
const CHUNK_LABELS = PROOFING_CHUNK_OPTIONS.map((option) => option.label);
const CHUNK_LIMIT_INDEX: Record<string, number> = { tiny: 3, small: 3, medium: 2, 'large-v3-turbo': 2, 'large-v3': 1 };
const CHUNK_LENGTH_TOOLTIP = [
  'Shorter chunks transcribe in parallel faster but can split a sentence across a boundary.',
  'Longer chunks on a big model risk running out of memory, so the range is capped by the model you pick.',
].join(' ');
const modelLabel = (value: string) => MODEL_OPTIONS.find((option) => option.value === value)?.label ?? value;

/** Whether "Start comparison" can run, and why not (stage-navigation-and-page-replacement.prd.md Phase 5): the run
 * needs a linked REAPER project file (PRD W16, as the Proofing page did) and the DAW port's `review` capability
 * (dawport.ReviewSession, ADR 0300), which the Proofing nav item used to gate before the page folded in here. */
function startCapability(dawFileLinked: boolean, review: CapabilityEntry): CapabilityEntry {
  if (!dawFileLinked) return { level: 'supported', available: false, message: 'Link a REAPER project (.rpp) file to start a comparison.' };
  const gate = dawCapabilityGate({ manuscript: false, dawFile: false }, review);
  return gate.disabled ? { ...review, available: false, message: gate.reason } : { ...review, available: true };
}

/**
 * The chapter view's compare run (stage-navigation-and-page-replacement.prd.md Phase 5): Transcript Compare's setup
 * (model, chunk length, workers, vocabulary hints), its live progress and the first-use Whisper download, moved here
 * from the retired Proofing page and run against this chapter. Its results are not a table of their own: each
 * discrepancy is a flag in the text and the Flags panel (compareFlags.ts), with its inline diff in the flag detail;
 * this section keeps the run's summary, Export markers and New comparison.
 */
export function CompareRun({
  chapterTitle,
  state,
  notify,
  dawFileLinked,
  lastCompleted,
  reviewingLast,
  onReviewLast,
  onCloseLast,
  foundHere,
}: {
  chapterTitle: string;
  /** The app-wide Transcript Compare state (one run at a time, from the host's transcript event). */
  state: TranscriptState;
  notify: Notify;
  /** PRD project-workspace-and-daw-link.prd.md, W16: starting a comparison and exporting markers need a linked DAW
   * project file; reviewing an already-completed comparison does not. */
  dawFileLinked: boolean;
  lastCompleted?: TranscriptState;
  /** True while the page shows the last completed comparison's results rather than a live run's. */
  reviewingLast: boolean;
  onReviewLast: () => void;
  onCloseLast: () => void;
  /** How many of the results' discrepancies belong to this chapter (the ones shown as flags). */
  foundHere: number;
}) {
  const api = useApi();
  const reviewCapability = useCapability('review');
  const [model, setModel] = useState('small');
  const [chunkIndex, setChunkIndex] = useState(1);
  const [workers, setWorkers] = useState('Auto');
  const [acceptedHints, setAcceptedHints] = useState<string[]>([]);
  const [pendingHints, setPendingHints] = useState<string[]>([]);
  // The suggestion request is asynchronous: read the lists as they are when it resolves, not as they were at the click.
  const hintsRef = useRef({ accepted: acceptedHints, pending: pendingHints });
  hintsRef.current = { accepted: acceptedHints, pending: pendingHints };
  const [logVerbosity, setLogVerbosity] = useState<'Quiet' | 'Normal' | 'Verbose'>('Normal');
  const [whisperPrompt, setWhisperPrompt] = useState<Extract<TranscriptStartResult, { status: 'asset_required' }>>();
  // The model download: the shared install-poll hook (D4). Success carries on with the comparison the narrator asked for.
  const whisperInstall = useAssetInstall<WhisperInstallJob>({
    start: () => {
      if (!whisperPrompt) return Promise.reject(new Error('Start a comparison first.'));
      return api.whisperInstall(whisperPrompt.model.id);
    },
    state: (jobId) => api.whisperInstallState(jobId),
    cancel: (jobId) => api.whisperInstallCancel(jobId),
    onSuccess: async () => {
      const title = pendingChapterTitle;
      setWhisperPrompt(undefined);
      notify('Whisper model installed.');
      await start(title);
    },
  });
  const [pendingChapterTitle, setPendingChapterTitle] = useState<string>();
  const running = isTranscriptActive(state.phase);
  // Cancel is answered by the next state event, which can be a moment away: the button says it was heard and a second press does nothing.
  const stopping = usePendingAction();
  const cancelComparison = () =>
    stopping.run('cancel', async () => {
      try {
        await api.transcriptCancel();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await api.transcriptHints();
        if (active) setAcceptedHints(saved);
      } catch (error) {
        // Non-blocking: the page stays usable. Adding a hint saves a fresh list over the unreadable file
        // (the host keeps the old one as vocab_hints.json.corrupt).
        if (active) notify(`The saved vocabulary hints could not be loaded: ${errorText(error)}. Hints you add now will replace them.`, 'error');
      }
    })();
    return () => {
      active = false;
    };
  }, [api, notify]);
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
      notify(describeApiError(error), 'error');
    }
  };
  const acceptHint = (term: string) => {
    setPendingHints((current) => current.filter((item) => item.toLowerCase() !== term.toLowerCase()));
    if (!hasHint(acceptedHints, term)) void saveHints([...acceptedHints, term]);
  };
  const removeHint = (term: string) => void saveHints(acceptedHints.filter((item) => item !== term));
  const addManualHint = (text: string) => {
    const terms = splitHintTerms(text);
    const next = terms.reduce((hints, term) => (hasHint(hints, term) ? hints : [...hints, term]), acceptedHints);
    if (next.length > acceptedHints.length) void saveHints(next);
  };
  const suggestHints = async () => {
    try {
      const { terms, found } = await api.transcriptSuggestHints();
      const fresh = terms.filter((term) => !hasHint(hintsRef.current.accepted, term));
      const added = fresh.filter((term) => !hasHint(hintsRef.current.pending, term));
      setPendingHints((current) => [...current, ...added.filter((term) => !hasHint(current, term))]);
      notify(suggestionMessage(found, fresh.length, added.length));
    } catch (error) {
      notify(errorText(error), 'error');
    }
  };

  // The chapter view names its own chapter, so the host never has to guess it from the track name.
  const start = async (title: string | undefined = chapterTitle) => {
    try {
      const result = await api.transcriptStart({
        model,
        chunk: String(CHUNK_OPTIONS[chunkIndex]),
        workers,
        hints: acceptedHints.join(', '),
        chapterTitle: title,
      });
      if (result.status === 'asset_required') {
        whisperInstall.reset();
        setWhisperPrompt(result);
        setPendingChapterTitle(title);
      }
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  };
  const closeWhisperPrompt = () => {
    setWhisperPrompt(undefined);
    whisperInstall.reset();
  };

  const showingResults = state.phase === 'success' || reviewingLast;
  const results = reviewingLast && lastCompleted ? lastCompleted : state;
  const canExportMarkers = !reviewingLast && dawFileLinked;
  const pendingMarkers = results.rows.filter((row) => (row.markerState ?? 'pending') === 'pending').length;
  const exporting = results.markerExport.phase === 'exporting';
  const closeResults = () => {
    if (reviewingLast) onCloseLast();
    else void api.transcriptReset().catch((error) => notify(describeApiError(error), 'error'));
  };

  const phase = showingResults ? 'results' : state.phase === 'need_chapter' ? 'chapter' : running ? 'running' : 'setup';
  return (
    <section aria-labelledby="compare-run-title" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
        <h2 id="compare-run-title" className="text-sm font-semibold">
          Compare the recording with the script
        </h2>
        <div className="flex items-center gap-1 text-xs">
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'setup' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'setup' ? 'var(--accent-soft)' : undefined }}
          >
            1 · Setup
          </span>
          <span style={{ color: 'var(--non-text)' }}>→</span>
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'running' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'running' ? 'var(--accent-soft)' : undefined }}
          >
            2 · Running
          </span>
          <span style={{ color: 'var(--non-text)' }}>→</span>
          <span
            className={`rounded px-2 py-1 font-['Barlow_Condensed',sans-serif] tracking-[0.08em] uppercase ${phase === 'results' ? 'font-semibold' : ''}`}
            style={{ background: phase === 'results' ? 'var(--accent-soft)' : undefined }}
          >
            3 · Results
          </span>
        </div>
      </div>
      {phase === 'setup' && (
        <div className="space-y-4 p-[1.1rem]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span style={{ color: 'var(--text-muted)' }}>Transcribes the selected REAPER audio with Whisper and compares it with {chapterTitle}.</span>
            {lastCompleted ? (
              <button className="underline" style={{ color: 'var(--text-muted)' }} onClick={onReviewLast}>
                Last narrated take: {lastCompleted.trackName || 'Selected REAPER audio'}
                {lastCompleted.audioItemCount ? ` · ${lastCompleted.audioItemCount} audio item${lastCompleted.audioItemCount === 1 ? '' : 's'}` : ''}
                {lastCompleted.completedAt ? ` · ${new Date(lastCompleted.completedAt).toLocaleString()}` : ''}
              </button>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>No narrated take yet</span>
            )}
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <span className="text-[0.82rem] font-medium text-[var(--text-muted)]">
                Whisper model
                <Tooltip text="Bigger models catch more misreads but run slower and use more memory per instance. Chunk length and worker count are capped automatically once you pick a model." />
              </span>
              <ToggleGroup
                label="Whisper model"
                className="mt-1.5 flex-wrap gap-1.5"
                value={model}
                onChange={selectModel}
                options={MODEL_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.caption }))}
              />
            </div>
            <div>
              <span className="text-[0.82rem] font-medium text-[var(--text-muted)]">
                Chunk length
                <Tooltip text={CHUNK_LENGTH_TOOLTIP} />
              </span>
              <ToggleGroup
                label="Chunk length"
                className="mt-1.5 flex-wrap gap-1.5"
                value={CHUNK_LABELS[chunkIndex]}
                onChange={(label) => setChunkIndex(CHUNK_LABELS.findIndex((item) => item === label))}
                options={CHUNK_LABELS.map((label, index) => ({
                  value: label,
                  label,
                  disabled: index > CHUNK_LIMIT_INDEX[model],
                  title: index > CHUNK_LIMIT_INDEX[model] ? `Not available for ${modelLabel(model)}` : undefined,
                }))}
              />
            </div>
            <div>
              <span className="text-[0.82rem] font-medium text-[var(--text-muted)]">
                Parallel workers
                <Tooltip text="Each worker loads its own full copy of the Whisper model, so memory use multiplies with worker count. Auto picks a safe count for this machine." />
              </span>
              <ToggleGroup
                label="Parallel workers"
                className="mt-1.5 flex-wrap gap-1.5"
                value={workers}
                onChange={setWorkers}
                options={['Auto', '1', '2', '4'].map((option) => {
                  const allowed = WORKER_LIMITS[model].includes(option);
                  return {
                    value: option,
                    label: option,
                    disabled: !allowed,
                    title: allowed ? undefined : `${modelLabel(model)} needs the full model in memory per worker — not available`,
                  };
                })}
              />
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[0.82rem] font-medium text-[var(--text-muted)]">
              Vocabulary hints
              <Tooltip text="Unusual names and invented words Whisper is likely to mis-hear. Accepted hints are remembered for this project - you won't need to re-suggest them every run." />
            </span>
            <TagInput
              label="Vocabulary hints"
              inputLabel="Add a vocabulary term"
              placeholder="Add a term…"
              tags={acceptedHints}
              suggestions={pendingHints}
              emptyText="No hints yet — add one, or suggest from the manuscript."
              onAdd={addManualHint}
              onRemove={removeHint}
              onAcceptSuggestion={acceptHint}
              actions={
                <TooltipTarget text="Suggest from manuscript">
                  <IconButton label="Suggest from manuscript" onClick={() => void suggestHints()}>
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                  </IconButton>
                </TooltipTarget>
              }
            />
          </div>
          <div className="flex items-center justify-end gap-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <CapabilityGate capability={startCapability(dawFileLinked, reviewCapability)}>
              <Button variant="primary" onClick={() => void start()}>
                <FontAwesomeIcon icon={faPlay} />
                Start comparison
              </Button>
            </CapabilityGate>
          </div>
        </div>
      )}
      {phase === 'chapter' && (
        <Panel title="Choose manuscript chapter">
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
      {phase === 'running' && (
        <div className="p-[1.1rem]">
          <div className="flex justify-between text-sm">
            <span>{state.message}</span>
            <span>
              {state.percent}% · {seconds(state.elapsed)}
            </span>
          </div>
          <div className="progressbar mt-3 h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div className="h-full bg-[var(--accent)] transition-[width] duration-[0.4s] ease-in-out" style={{ width: `${state.percent}%` }} />
          </div>
          <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                Live activity
              </span>
              <ToggleGroup
                label="Log detail"
                className="gap-1"
                value={logVerbosity}
                onChange={(mode) => setLogVerbosity(mode as typeof logVerbosity)}
                options={LOG_VERBOSITY_OPTIONS}
              />
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
                <div className="border-b border-[var(--border)] px-[0.45rem] py-1" style={{ color: 'var(--text-muted)' }}>
                  Waiting for notable events…
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {import.meta.env.MODE === 'mock' && (
              <Button variant="ghost" className="text-xs" onClick={() => void api.transcriptReset().catch((error) => notify(describeApiError(error), 'error'))}>
                Skip to results (demo)
              </Button>
            )}
            <Button variant="danger" pending={stopping.isPending('cancel')} onClick={() => void cancelComparison()}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase === 'results' && (
        <div className="space-y-2 p-[1.1rem] text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {results.trackName ? `${results.trackName}: ` : ''}
              {foundHere === 0
                ? `no discrepancies in ${chapterTitle}`
                : `${foundHere} discrepanc${foundHere === 1 ? 'y' : 'ies'} in ${chapterTitle}, each one a flag in the Flags panel`}
              {results.rows.length > foundHere ? ` (${results.rows.length - foundHere} more in other chapters)` : ''}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <TooltipTarget
                text={
                  !canExportMarkers
                    ? 'Marker export is available only for results from this active REAPER session'
                    : pendingMarkers === 0
                      ? 'No new markers are ready to export'
                      : `Export ${pendingMarkers} new marker${pendingMarkers === 1 ? '' : 's'} to REAPER`
                }
              >
                <Button
                  variant="primary"
                  className="text-xs"
                  disabled={!canExportMarkers || pendingMarkers === 0 || exporting}
                  onClick={async () => {
                    try {
                      await api.transcriptExportMarkers();
                      notify(`Exporting ${pendingMarkers} marker${pendingMarkers === 1 ? '' : 's'} to REAPER…`);
                    } catch (error) {
                      notify(describeApiError(error), 'error');
                    }
                  }}
                >
                  <FontAwesomeIcon icon={faFileExport} />
                  {exporting ? 'Exporting…' : `Export ${pendingMarkers} marker${pendingMarkers === 1 ? '' : 's'}`}
                </Button>
              </TooltipTarget>
              <TooltipTarget text="Return to setup for another comparison">
                <Button variant="ghost" className="text-xs" onClick={closeResults}>
                  <FontAwesomeIcon icon={faRotateLeft} />
                  New comparison
                </Button>
              </TooltipTarget>
            </div>
          </div>
          {results.markerExport.phase !== 'idle' && (
            <p
              className={`text-xs ${results.markerExport.phase === 'error' ? 'text-[var(--danger-text)]' : ''}`}
              style={{ color: results.markerExport.phase === 'error' ? undefined : 'var(--text-muted)' }}
            >
              {results.markerExport.message}
            </p>
          )}
        </div>
      )}
      {whisperPrompt && (
        <AssetInstallPrompt
          ask={{
            title: 'Download local Whisper model?',
            body: `The ${whisperPrompt.model.displayName} Whisper model is needed to transcribe this comparison. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
            confirmLabel: 'Download model',
          }}
          workTitle="Downloading Whisper model"
          install={whisperInstall}
          dismiss={closeWhisperPrompt}
        >
          <AssetFacts
            label="Model"
            name={whisperPrompt.model.displayName}
            version={whisperPrompt.model.version}
            publisher={whisperPrompt.model.publisher}
            license={whisperPrompt.model.license}
            licenseUrl={whisperPrompt.model.licenseUrl}
            modelCardUrl={whisperPrompt.model.modelCardUrl}
            provenanceUrl={whisperPrompt.model.provenanceUrl}
            downloadSize={whisperPrompt.downloadSize}
            diskSize={whisperPrompt.diskSize}
            installPath={whisperPrompt.installPath}
          />
        </AssetInstallPrompt>
      )}
    </section>
  );
}
