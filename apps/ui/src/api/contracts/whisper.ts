export type WhisperInstallState = 'installed' | 'not_installed' | 'verification_failed';

export type WhisperModel = {
  id: string;
  provider: string;
  displayName: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  attribution: string;
  downloadSize: number;
  installState: WhisperInstallState;
};

export type WhisperCatalog = {
  catalogVersion: number;
  model: { id: string; effectiveSource: string };
  models: WhisperModel[];
};

export type WhisperInstallJob = {
  id: string | null;
  modelId: string;
  phase: 'running' | 'success' | 'cancelled' | 'error';
  message: string;
};

export interface WhisperApi {
  whisperCatalog(): Promise<WhisperCatalog>;
  whisperInstall(modelId: string): Promise<WhisperInstallJob>;
  whisperInstallState(jobId: string): Promise<WhisperInstallJob>;
  whisperInstallCancel(jobId: string): Promise<WhisperInstallJob>;
  whisperRemove(modelId: string): Promise<void>;
}
