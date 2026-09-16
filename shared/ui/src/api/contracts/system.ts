import type { TranscriptState } from './transcript';

export type Scope = 'global' | 'project';
export type ScopedSettingField = {
  key: string;
  label: string;
  kind: 'text' | 'choice' | 'color';
  choices: string[];
  value: string;
  isSet: boolean;
  effectiveValue: string;
  effectiveSource: string;
};
export type Bootstrap = {
  apiVersion: number;
  diagnosticId: string;
  projectFolder: string;
  projectName: string;
  daw: string;
  manuscript: { id: string; format: string; sourceName: string; importedAt: string } | null;
  legacyManuscriptAvailable: boolean;
  runtime: Record<string, string>;
  transcript: TranscriptState;
};
export type HostReady = { apiVersion: number; diagnosticId: string };

export interface SystemApi {
  ready(): Promise<HostReady>;
  bootstrap(): Promise<Bootstrap>;
  poll(revision: number): Promise<{ revision: number; transcript: TranscriptState }>;
  saveSettings(tool: string, scope: Scope, values: Record<string, string | null>): Promise<Bootstrap>;
  settingsForScope(scope: Scope): Promise<Record<string, ScopedSettingField[]>>;
  reportClientDiagnostic(kind: string, message: string): Promise<void>;
}
