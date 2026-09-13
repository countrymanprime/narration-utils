import type { Discrepancy, NarrationApi, TranscriptState } from './types';

export const REQUIRED_API_METHODS: (keyof NarrationApi)[] = ['ready', 'bootstrap', 'poll', 'selectManuscript', 'saveSettings', 'guideBuild', 'guideIndex', 'guideEdit', 'guideExport', 'guidePreview', 'transcriptStart', 'transcriptCancel', 'transcriptAddEquivalence', 'transcriptJump', 'transcriptSuggestHints', 'reportClientDiagnostic'];
export const hasCompleteApi = (candidate: unknown): candidate is NarrationApi => Boolean(candidate) && REQUIRED_API_METHODS.every((name) => typeof (candidate as Record<string, unknown>)[name] === 'function');
export const hasReadyApi = (candidate: unknown): candidate is Pick<NarrationApi, 'ready'> => Boolean(candidate) && typeof (candidate as Record<string, unknown>).ready === 'function';
export const hasCompleteMethodList = (methods: readonly string[]): boolean => REQUIRED_API_METHODS.every((name) => methods.includes(name));

export const isTranscriptActive = (phase: TranscriptState['phase']) => phase === 'preparing' || phase === 'running';
export const selectDiscrepancy = (rows: Discrepancy[], id?: string): Discrepancy | undefined => rows.find((row) => row.id === id) ?? rows[0];
export const canAddEquivalence = (row?: Discrepancy): boolean => Boolean(row && row.kind === 'MISREAD' && row.docText && row.audioText && !row.docText.includes(' ') && !row.audioText.includes(' '));
