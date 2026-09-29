// The Master & QC export flow (render-encode-master.prd.md Phase 5): the narrator picks rendered chapter (and
// credits, and retail sample) WAV files, optionally masters them (internal/mastering, Phase 3), encodes them
// (internal/encodeport, Phases 1-2) and assembles one delivery profile's package (internal/packager, Phase 4).
// Mastering and encoding run together as one job (ExportStart/State/Cancel), matching the narrator's one "Master &
// encode" action; packaging is its own job (PackageStart/State/Cancel) over an export's own encoded files.

import type { MeasurePickResult } from './measure';

/** Where one item lands in the eventual package (packager.Kind); "chapter" may repeat, the others at most once. */
export type PackageItemKind = 'chapter' | 'credits_opening' | 'credits_closing' | 'retail_sample';

/** One rendered WAV to master and encode: its place in the package, and (for a chapter) its title. */
export type ExportItem = { kind: PackageItemKind; title: string; path: string };

/** What ExportStart is asked to master (optionally) and encode. */
export type ExportRequest = { items: ExportItem[]; master: boolean; format: string };

/** The mastering chain's own report (internal/mastering.Result), narrowed to what the page shows per file. */
export type MasteringSummary = {
  targets: { rms: number; rmsMin: number | null; rmsMax: number | null; peakMax: number; ceiling: number };
  highPassHz: number;
  gainDb: number;
  beforeRmsDbfs: number | null;
  afterRmsDbfs: number | null;
  afterPeakDbfs: number | null;
};

export type ExportFileStatus = 'pending' | 'mastering' | 'encoding' | 'done' | 'failed' | 'cancelled';

/** One item's progress through the export job. `masteredPath`/`encodedPath` are the new files it wrote. */
export type ExportFileResult = {
  kind: PackageItemKind;
  title: string;
  path: string;
  status: ExportFileStatus;
  masteredPath?: string;
  encodedPath?: string;
  mastering?: MasteringSummary;
  error?: string;
};

/** The export job (ExportStart/State/Cancel), in the shape of the host's other jobs. */
export type ExportJob = {
  id: string | null;
  kind: 'render_export';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  message: string;
  percent: number;
  master: boolean;
  format: string;
  logs: string[];
  elapsed: number;
  error?: string;
  files: ExportFileResult[];
};

/** One already-encoded file (an ExportJob file's own `encodedPath`) ready to package. */
export type PackageItem = { kind: PackageItemKind; title: string; path: string };

/** One file the delivery package will create, listed before anything is built (internal/packager.PlannedFile). `name` is empty
 * when `problem` says why the chapter's title cannot be used in a file name. */
export type PackagePreviewFile = { kind: PackageItemKind; title: string; name: string; problem: string };

/** The package a delivery profile would build for this project (PackagePreview): the format its files are encoded in and every
 * file with the name it will have. `files` is empty, with `problem` saying why, when there is no manuscript to name chapters from. */
export type PackagePreview = { profile: string; platform: string; format: string; files: PackagePreviewFile[]; problem: string };

/** What PackageStart is asked to assemble: one profile's book checklist and the encoded items ready. */
export type PackageRequest = { profileId: string; profileVersion: string; items: PackageItem[] };

/** One file the package job wrote (internal/packager.ManifestFile). */
export type PackageManifestFile = { kind: PackageItemKind; name: string; destPath: string; tagged: boolean };

/** One book-scope rule's result against the package (internal/packager.ChecklistItem). */
export type PackageChecklistStatus = 'included' | 'missing' | 'off' | 'not_applicable';
export type PackageChecklistItem = { ruleId: string; label: string; status: PackageChecklistStatus; detail: string };

/** The package job (PackageStart/State/Cancel), in the shape of the host's other jobs. Closing the folder picker
 * without choosing one leaves the job at its prior (often idle) state rather than erroring. */
export type PackageJob = {
  id: string | null;
  kind: 'render_package';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  message: string;
  profile: string;
  outputDir: string;
  files: PackageManifestFile[];
  checklist: PackageChecklistItem[];
  elapsed: number;
  error?: string;
};

/** One platform the narrator checked to build a package for, in the multi-platform export panel's own selection
 * (render-encode-master.prd.md Phase 6: several profiles, one action, built on Phase 5's own export/package split). */
export type ProfileSelection = { profileId: string; profileVersion: string };

/** What PackageStartMulti is asked to build: every selected platform, and the same encoded items a single
 * PackageStart would be sent (an export job's own EncodedPaths for its current format). */
export type MultiPackageRequest = { selections: ProfileSelection[]; items: PackageItem[] };

/** One selected profile's own place in a multi-platform run. `phase` has no "cancelled": a cancel is a whole-job
 * event (`MultiPackageJob.phase` reports it), and a profile a cancel never reached simply stays "pending". */
export type MultiPackagePhase = 'pending' | 'running' | 'success' | 'error';
export type MultiPackageResult = {
  profile: string;
  platform: string;
  phase: MultiPackagePhase;
  message: string;
  outputDir: string;
  files: PackageManifestFile[];
  checklist: PackageChecklistItem[];
  error?: string;
};

/** The multi-platform package job (PackageStartMulti/State/Cancel), in the shape of the host's other jobs: one
 * mastered/encoded source produces a package for every selected profile, reusing already-encoded files for any
 * profile whose required format matches the export job's own current format, and encoding once (never once per
 * profile) for any other required format. */
export type MultiPackageJob = {
  id: string | null;
  kind: 'render_package_multi';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  message: string;
  results: MultiPackageResult[];
  elapsed: number;
  error?: string;
};

export interface RenderEncodeMasterApi {
  /** Opens the picker for the files to master and encode. Only paths chosen here can be exported. */
  exportPickFiles(): Promise<MeasurePickResult>;
  /** Masters (when requested) and encodes the picked files as a job; rejects a path that was not picked, an empty
   * request, or a second export while one runs. */
  exportStart(req: ExportRequest): Promise<ExportJob>;
  /** The export job: idle, running with real progress, or how it ended with every file's result. */
  exportState(): Promise<ExportJob>;
  /** Stops a running export; files already prepared keep their results. Answers the job. */
  exportCancel(): Promise<ExportJob>;
  /** Opens the folder picker, then assembles the chosen profile's package from an export's own encoded files as a
   * job; rejects a path that was not encoded in this session, no items, an unknown profile, or a second package
   * build while one runs. */
  packageStart(req: PackageRequest): Promise<PackageJob>;
  /** The package job: idle, running, or how it ended with the manifest and checklist it built. */
  packageState(): Promise<PackageJob>;
  /** Stops a running package build. Answers the job. */
  packageCancel(): Promise<PackageJob>;
  /** The files a profile's package will create for this project, each with the name and format it will have, named by the same
   * code the package build writes with. Builds nothing; rejects an unknown profile. */
  packagePreview(profileId: string, profileVersion: string): Promise<PackagePreview>;
  /** Resolves every selected profile, works out each one's required encode format, reuses the export job's own
   * encoded files for any selection matching its format, asks for one root output folder, then builds each
   * profile's package in its own subfolder, in order, as a job; rejects an empty selection, an unknown profile, a
   * path that was not encoded in this session, or a second package build (single or multi-platform) or export while
   * one runs. */
  packageStartMulti(req: MultiPackageRequest): Promise<MultiPackageJob>;
  /** The multi-platform package job: idle, running with each selected profile's own phase, or how it ended with
   * every profile's own result. */
  packageMultiState(): Promise<MultiPackageJob>;
  /** Stops a running multi-platform build before its next profile starts. Answers the job. */
  packageMultiCancel(): Promise<MultiPackageJob>;
}
