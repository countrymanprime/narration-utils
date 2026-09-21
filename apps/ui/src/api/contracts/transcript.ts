import type { WhisperInstallState, WhisperModel } from './whisper';

export type Discrepancy = {
  id: string;
  kind: string;
  name: string;
  docText: string;
  audioText: string;
  projectTime: number;
  itemIndex: number;
  srcpos: number;
  chapter?: string;
  paragraph?: number;
  sourceLine?: number;
  scriptContext?: string;
  audioContext?: string;
  markerState?: 'pending' | 'existing' | 'exported';
  existingMarkerName?: string;
};

/**
 * What "Suggest from manuscript" found. `terms` are the names not yet accepted (compared
 * case-insensitively); `found` counts every name the Story Bible offered, so the page can
 * tell "nothing found" from "everything found is already accepted".
 */
export type HintSuggestions = { terms: string[]; found: number };

export type MarkerExport = { phase: 'idle' | 'exporting' | 'complete' | 'error'; message: string; added: number; skipped: number };

export type TranscriptStartResult =
  | { status: 'started' }
  | {
      status: 'asset_required';
      model: Omit<WhisperModel, 'downloadSize' | 'installState'>;
      installState: WhisperInstallState;
      downloadSize: number;
      diskSize: number;
      installPath: string;
    };

export type TranscriptState = {
  runId?: string;
  /** Present on completed snapshots from current desktop hosts. */
  trackName?: string;
  audioItemCount?: number;
  completedAt?: string;
  phase: 'idle' | 'preparing' | 'running' | 'inspecting' | 'need_chapter' | 'success' | 'cancelled' | 'error';
  percent: number;
  message: string;
  logs: string[];
  chapters: string[];
  rows: Discrepancy[];
  diff: string;
  summary: string;
  elapsed: number;
  markerExport: MarkerExport;
};

export interface TranscriptApi {
  transcriptStart(options: { model: string; chunk: string; workers: string; hints: string; chapterTitle?: string }): Promise<TranscriptStartResult>;
  transcriptCancel(): Promise<void>;
  transcriptReset(): Promise<void>;
  transcriptLastCompleted(): Promise<TranscriptState | undefined>;
  transcriptAddEquivalence(id: string): Promise<string>;
  transcriptJump(id: string): Promise<void>;
  transcriptExportMarkers(): Promise<void>;
  transcriptSuggestHints(): Promise<HintSuggestions>;
  transcriptHints(): Promise<string[]>;
  transcriptSaveHints(accepted: string[]): Promise<void>;
  subscribeTranscript(onUpdate: (state: TranscriptState) => void): () => void;
}
