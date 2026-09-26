// The mock host (mockApi.ts): proofing.
import type { NarrationApi, TranscriptState } from '../../types';
import { WIRE_DISCREPANCIES, WIRE_LOGS, WIRE_TRANSCRIPT, wireClone } from '../mockFixtures';
import type { MockState } from './state';
import { type AssetsMock, MOCK_ASSET_ROOT } from './assets';

/** The proofing bindings: the comparison run, its markers and the vocabulary hints. */
export function createProofingMock(
  s: MockState,
  { whisperInstalled, mockWhisperIdentity, mockWhisperModel }: Pick<AssetsMock, 'whisperInstalled' | 'mockWhisperIdentity' | 'mockWhisperModel'>,
) {
  let hints: string[] = [];
  const vocabularyCandidates = Array.from(new Set(s.entities.flatMap((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)])));
  let transcript: TranscriptState = wireClone(WIRE_TRANSCRIPT);
  let lastCompleted: TranscriptState = {
    ...wireClone(WIRE_TRANSCRIPT),
    phase: 'success',
    percent: 100,
    elapsed: 42,
    message: 'Comparison complete.',
    summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
    logs: WIRE_LOGS.map((entry) => entry.text),
    rows: wireClone(WIRE_DISCREPANCIES),
    trackName: 'Chapter 1',
    audioItemCount: 3,
    completedAt: '2026-09-15T14:30:00Z',
    projectChangeCount: 41,
  };
  const subscribers = new Set<(state: TranscriptState) => void>();
  let runTimers: ReturnType<typeof setTimeout>[] = [];
  const publish = () => {
    subscribers.forEach((fn) => fn(wireClone(transcript)));
  };
  const stopRun = () => {
    runTimers.forEach(clearTimeout);
    runTimers = [];
  };
  const startRun = () => {
    stopRun();
    transcript = { ...wireClone(WIRE_TRANSCRIPT), phase: 'running', percent: 8, elapsed: 4, message: 'Transcribing chunk 1 of 7…', logs: [] };
    publish();
    WIRE_LOGS.forEach((entry, index) =>
      runTimers.push(
        setTimeout(
          () => {
            if (transcript.phase !== 'running') return;
            transcript = {
              ...transcript,
              percent: Math.min(90, 18 + index * 13),
              elapsed: Math.min(42, 9 + index * 6),
              message: `Transcribing chunk ${Math.min(7, index + 2)} of 7…`,
              logs: [...transcript.logs, entry.text],
            };
            publish();
          },
          380 * (index + 1),
        ),
      ),
    );
    runTimers.push(
      setTimeout(() => {
        if (transcript.phase !== 'running') return;
        transcript = {
          ...wireClone(WIRE_TRANSCRIPT),
          phase: 'success',
          percent: 100,
          elapsed: 42,
          message: 'Comparison complete.',
          summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
          logs: WIRE_LOGS.map((entry) => entry.text),
          rows: wireClone(WIRE_DISCREPANCIES),
        };
        lastCompleted = wireClone(transcript);
        publish();
        stopRun();
      }, 2_600),
    );
  };
  const bindings = {
    transcriptStart: async () =>
      whisperInstalled()
        ? (startRun(), { status: 'started' as const })
        : {
            status: 'asset_required' as const,
            model: mockWhisperIdentity,
            installState: 'not_installed' as const,
            downloadSize: mockWhisperModel.downloadSize,
            diskSize: mockWhisperModel.downloadSize,
            installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
          },
    transcriptCancel: async () => {
      stopRun();
      transcript = { ...transcript, phase: 'cancelled', message: 'Comparison cancelled' };
      publish();
    },
    transcriptReset: async () => {
      stopRun();
      transcript = wireClone(WIRE_TRANSCRIPT);
      publish();
    },
    transcriptLastCompleted: async () => wireClone(lastCompleted),
    transcriptAddEquivalence: async () => 'Added pronunciation equivalence.',
    transcriptJump: async () => {},
    transcriptExportMarkers: async () => {
      const exportable = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending');
      transcript = {
        ...transcript,
        markerExport: {
          phase: 'exporting',
          message: `Exporting ${exportable.length} marker${exportable.length === 1 ? '' : 's'} to REAPER…`,
          added: 0,
          skipped: 0,
        },
      };
      publish();
      setTimeout(() => {
        const added = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending').length;
        transcript = {
          ...transcript,
          rows: transcript.rows.map((row) => ((row.markerState ?? 'pending') === 'pending' ? { ...row, markerState: 'exported' } : row)),
          markerExport: {
            phase: 'complete',
            message: `Exported ${added} marker${added === 1 ? '' : 's'}; skipped ${transcript.rows.length - added} existing.`,
            added,
            skipped: transcript.rows.length - added,
          },
        };
        lastCompleted = wireClone(transcript);
        publish();
      }, 250);
    },
    transcriptSuggestHints: async () => ({
      terms: vocabularyCandidates.filter(
        (candidate) => !hints.some((accepted) => accepted.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0),
      ),
      found: vocabularyCandidates.length,
    }),
    transcriptHints: async () => [...hints],
    transcriptSaveHints: async (accepted) => {
      hints = [...accepted];
    },
    subscribeTranscript: (onUpdate) => {
      subscribers.add(onUpdate);
      onUpdate(wireClone(transcript));
      return () => subscribers.delete(onUpdate);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings, transcript: () => transcript };
}
