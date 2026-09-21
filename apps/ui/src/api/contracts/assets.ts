/**
 * Where an asset install is. Every optional download (a voice, a Whisper model, and the models that follow) speaks this one vocabulary:
 * `downloading` while bytes arrive, `verifying` while the files are checked against the approved size and SHA-256, then one of the three ends.
 */
export type AssetJobPhase = 'downloading' | 'verifying' | 'success' | 'cancelled' | 'error';

/**
 * An install job as the host reports it. `percent` is real bytes over real bytes (ADR 0015) and never more than 99 until the install succeeded;
 * `error` is a sentence for the narrator, empty unless `phase` is `error`.
 */
export type AssetInstallJob = {
  id: string;
  phase: AssetJobPhase;
  message: string;
  percent: number;
  bytesDone: number;
  bytesTotal: number;
  error: string;
};

/** True while the install is still working, that is until it succeeded, failed or was cancelled. */
export const isInstallRunning = (job: Pick<AssetInstallJob, 'phase'>): boolean => job.phase === 'downloading' || job.phase === 'verifying';
