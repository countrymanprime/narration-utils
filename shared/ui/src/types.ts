export type Scope = 'global' | 'project';
export type SettingField = { key: string; label: string; kind: 'text' | 'choice' | 'color'; choices: string[]; value: string; source: string; projectOverride: boolean };
export type GuideEntity = { id: string; category: string; name: string; say: string; ipa: string; count: string; locks: string; description: string; traits: string; chapter: string; evidence: string };
export type Discrepancy = { id: string; kind: string; name: string; docText: string; audioText: string; projectTime: number; itemIndex: number; srcpos: number };
export type TranscriptState = { runId?: string; phase: 'idle' | 'preparing' | 'running' | 'need_chapter' | 'success' | 'cancelled' | 'error'; percent: number; message: string; logs: string[]; chapters: string[]; rows: Discrepancy[]; diff: string; summary: string; elapsed: number };
export type Bootstrap = { apiVersion: number; diagnosticId: string; projectFolder: string; projectName: string; manuscriptPath: string; runtime: Record<string, string>; settings: Record<string, SettingField[]>; roadmap: { available: { title: string; summary: string }[]; milestones: { number: number; title: string; summary: string }[]; deferred: string[] }; transcript: TranscriptState };
export type HostReady = { apiVersion: number; methods: string[]; diagnosticId: string };

export interface NarrationApi {
  ready(): Promise<HostReady>;
  bootstrap(): Promise<Bootstrap>;
  poll(revision: number): Promise<{ revision: number; transcript: TranscriptState }>;
  selectManuscript(): Promise<{ path: string }>;
  saveSettings(tool: string, scope: Scope, values: Record<string, string | null>): Promise<Bootstrap>;
  guideBuild(): Promise<string>;
  guideIndex(): Promise<GuideEntity[]>;
  guideEdit(id: string, values: Record<string, string>, locks: string[]): Promise<void>;
  guideExport(): Promise<string>;
  guidePreview(id: string): Promise<string>;
  transcriptStart(options: { model: string; chunk: string; workers: string; hints: string; chapterTitle?: string }): Promise<void>;
  transcriptCancel(): Promise<void>;
  transcriptAddEquivalence(id: string): Promise<string>;
  transcriptJump(id: string): Promise<void>;
  transcriptSuggestHints(): Promise<string>;
  reportClientDiagnostic(kind: string, message: string): Promise<void>;
}

declare global { interface Window { pywebview?: { api: NarrationApi } } }
