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
  /** The kind of asset (`tts`, `whisper`) and the asset itself: the same two words the generic bindings take. */
  kind: string;
  assetId: string;
  phase: AssetJobPhase;
  message: string;
  percent: number;
  bytesDone: number;
  bytesTotal: number;
  error: string;
};

/** True while the install is still working, that is until it succeeded, failed or was cancelled. */
export const isInstallRunning = (job: Pick<AssetInstallJob, 'phase'>): boolean => job.phase === 'downloading' || job.phase === 'verifying';

/** Whether an asset is on this computer, and in what shape. `verification_failed` is "needs repair". */
export type AssetInstallState = 'installed' | 'not_installed' | 'verification_failed';

/**
 * One approved asset in the list of everything that can be downloaded. Nothing is read from the asset to build it: `installedAt` and
 * `verifiedAt` come from its manifest, and `activeJobId` is the download running for it now, so a page opened while one runs can follow it.
 */
export type AssetItem = {
  kind: string;
  /** The kind in words a narrator reads: "Preview voice", "Whisper model". */
  kindLabel: string;
  id: string;
  displayName: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  attribution: string;
  downloadSize: number;
  /** What it takes on the disk once installed: the download, or what it unpacks to. */
  diskSize: number;
  installState: AssetInstallState;
  /** Where it is (or will be) installed. */
  path: string;
  /** ISO 8601; empty when it is not installed or was installed before manifests recorded it. */
  installedAt: string;
  verifiedAt: string;
  /** The id of the running download of this asset, or empty. */
  activeJobId: string;
};

export type AssetCatalog = {
  /** The per-user cache folder every asset is kept under. */
  cacheRoot: string;
  /** Bytes the installed assets take, from the catalog sizes. */
  totalInstalledBytes: number;
  assets: AssetItem[];
};

export type AssetVerifyResult = { kind: string; id: string; installState: AssetInstallState };

export interface AssetsApi {
  assetsList(): Promise<AssetCatalog>;
  /** Installs the asset, or repairs it when it is damaged. A second call while it downloads joins the running job. The narrator asked for it. */
  assetsInstall(kind: string, id: string): Promise<AssetInstallJob>;
  assetsInstallState(jobId: string): Promise<AssetInstallJob>;
  assetsInstallCancel(jobId: string): Promise<AssetInstallJob>;
  /** Reads every byte of the asset (it can take seconds for a large model) and says whether it is installed, damaged or absent. */
  assetsVerify(kind: string, id: string): Promise<AssetVerifyResult>;
  /** Deletes the asset and nothing else. Refused while it downloads. */
  assetsRemove(kind: string, id: string): Promise<void>;
}
