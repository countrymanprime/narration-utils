// The browser mock's Master & QC export flow (render-encode-master.prd.md Phase 5), answering the way
// apps/desktop/export_job.go and package_job.go do: the same refusals (nothing picked, a path the picker did not
// choose, one already running, packaging a path that was not encoded this session), a running export that finishes
// one file per poll (standing in for the bytes the host reads), and a package whose checklist is built from the
// project's own delivery profile's book rules the way packager.Assemble reads them (D67: mock-first, tests and the
// demo build share this file; the real host swaps in internal/encodeport, internal/mastering and internal/packager).
import type {
  DeliveryProfile,
  ExportItem,
  ExportJob,
  ExportRequest,
  JobEnded,
  MeasurePickResult,
  MultiPackageJob,
  MultiPackageRequest,
  MultiPackageResult,
  PackageItem,
  PackageJob,
  PackagePreview,
  PackagePreviewFile,
  PackageRequest,
  RenderEncodeMasterApi,
} from '../types';
import { MOCK_ACX } from './deliveryProfilesMock';
import { wireClone } from './mockFixtures';

/** What the mock's picker chooses: two chapters, opening and closing credits, and a retail sample. */
export const MOCK_EXPORT_PATHS = [
  'C:/Users/Narrator/Renders/Alice/00 Opening credits.wav',
  'C:/Users/Narrator/Renders/Alice/Chapter 01.wav',
  'C:/Users/Narrator/Renders/Alice/Chapter 02.wav',
  'C:/Users/Narrator/Renders/Alice/00 Closing credits.wav',
  'C:/Users/Narrator/Renders/Alice/Retail sample.wav',
];

/** The export items ExportPickFiles' paths become once the narrator assigns each a role in the picker dialog. */
export const MOCK_EXPORT_ITEMS: ExportItem[] = [
  { kind: 'credits_opening', title: '', path: MOCK_EXPORT_PATHS[0] },
  { kind: 'chapter', title: '01 Down the Rabbit-Hole', path: MOCK_EXPORT_PATHS[1] },
  { kind: 'chapter', title: '02 The Pool of Tears', path: MOCK_EXPORT_PATHS[2] },
  { kind: 'credits_closing', title: '', path: MOCK_EXPORT_PATHS[3] },
  { kind: 'retail_sample', title: '', path: MOCK_EXPORT_PATHS[4] },
];

export type MockExportSeed = 'hold';

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const extOf = (path: string): string => path.slice(path.lastIndexOf('.'));
const files = (count: number): string => (count === 1 ? '1 file' : `${count} files`);

function mockMastering(): NonNullable<ExportJob['files'][number]['mastering']> {
  return {
    targets: { rms: -20.5, rmsMin: -23, rmsMax: -18, peakMax: -3, ceiling: -3 },
    highPassHz: 80,
    gainDb: 2.3,
    beforeRmsDbfs: -22.8,
    afterRmsDbfs: -20.5,
    afterPeakDbfs: -3.4,
  };
}

/** The label a checkbox or tab gives a profile: its platform for a built-in, its own name for a custom profile -
 * the same rule MasterQcPage.tsx's own `platformName` applies to the single-select platform tabs. */
const platformNameFor = (profile: DeliveryProfile): string => (profile.builtIn ? profile.platform : profile.name);

/** requiredFormatMock mirrors apps/desktop/multi_package_job.go's own requiredFormat: the capture group of the
 * first file-scope rule whose metric matches "<format>_format", or "mp3" when no such rule exists. */
function requiredFormatMock(profile: DeliveryProfile): string {
  for (const rule of profile.rules) {
    if (rule.scope !== 'file') continue;
    const match = /^(\w+)_format$/.exec(rule.metric);
    if (match) return match[1];
  }
  return 'mp3';
}

/** sanitizeFolderNameMock mirrors apps/desktop/multi_package_job.go's own sanitizeFolderName (the characters Windows
 * refuses in a path segment; the mock leaves out the control-character half of that set, since fixture and narrator
 * input here is never anything but printable text). */
function sanitizeFolderNameMock(name: string): string {
  const replaced = name.trim().replace(/[<>:"/\\|?*]/g, '_');
  // A run of only dots ("", ".", "..", ...) would join as a no-op or a parent-directory escape rather than a real
  // subfolder name (mirrors apps/desktop/multi_package_job.go's own fix: a custom profile's name has no character
  // restriction beyond its length).
  return /^\.*$/.test(replaced) ? 'package' : replaced;
}

/** The manuscript chapters the preview names files from: only what it reads of a chapter. */
export type PreviewChapter = { title: string; subtitle?: string; contentKind?: string };

/** The refusal internal/packager's chapterFileName gives a title a file name cannot hold, or '' when it can. */
function titleProblem(number: number, title: string): string {
  const trimmed = title.trim();
  if (trimmed === '') return `chapter ${number} has no title`;
  if (/[<>:"/\\|?*]/.test(trimmed)) return `chapter ${number}'s title "${trimmed}" cannot be used in a file name (it holds one of <>:"/\\|?*)`;
  // eslint-disable-next-line no-control-regex -- a file name cannot hold a control character
  if (/[\u0000-\u001f]/.test(trimmed)) return `chapter ${number}'s title cannot hold control characters`;
  return '';
}

/** mockPackagePreview mirrors apps/desktop/package_preview.go: the opening credits, one file per narration chapter (named by its
 * subtitle when it has one), the closing credits and the retail sample, leaving out a book rule the profile turned off. */
function mockPackagePreview(profile: DeliveryProfile, chapters: readonly PreviewChapter[]): PackagePreview {
  const format = requiredFormatMock(profile);
  const answer: PackagePreview = { profile: profile.id, platform: profile.platform, format, files: [], problem: '' };
  const narration = chapters.filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration');
  if (narration.length === 0) return { ...answer, problem: chapters.length === 0 ? 'import a manuscript first' : 'the manuscript has no narration chapters' };
  const wants = (metric: string) => profile.rules.some((rule) => rule.scope === 'book' && rule.metric === metric && !rule.off);
  const ext = `.${format}`;
  const files: PackagePreviewFile[] = [];
  const credits = wants('credits_files');
  if (credits) files.push({ kind: 'credits_opening', title: '', name: `Credits, Opening${ext}`, problem: '' });
  narration.forEach((chapter, index) => {
    const title = chapter.subtitle || chapter.title;
    const problem = titleProblem(index + 1, title);
    files.push({ kind: 'chapter', title, name: problem ? '' : `${String(index + 1).padStart(2, '0')} - ${title.trim()}${ext}`, problem });
  });
  if (credits) files.push({ kind: 'credits_closing', title: '', name: `Credits, Closing${ext}`, problem: '' });
  if (wants('retail_sample_seconds')) files.push({ kind: 'retail_sample', title: '', name: `Retail Sample${ext}`, problem: '' });
  return { ...answer, files };
}

function packageNameForFormat(item: PackageItem, index: number, format: string): string {
  const ext = `.${format}`;
  switch (item.kind) {
    case 'credits_opening':
      return `Credits, Opening${ext}`;
    case 'credits_closing':
      return `Credits, Closing${ext}`;
    case 'retail_sample':
      return `Retail Sample${ext}`;
    default:
      return `${String(index + 1).padStart(2, '0')} - ${item.title}${ext}`;
  }
}

/**
 * `picked` is the export picker's allowlist (mirrors ADR 0156's own discipline); `encoded` is the last export's own
 * encoded paths, package's own allowlist (mirrors the host's own "was it encoded this session" check).
 *
 * `profiles` is every profile a multi-platform selection may pick from (Phase 6, D67: the same list
 * deliveryProfilesMock.ts's own `all()` already exposes for the single-profile tabs), defaulting to ACX alone.
 * `multiPackageSeed` freezes the multi-platform job at "running" on its own (separately from `seed`, which would
 * also freeze the export job itself mid-run, leaving no completed files to build packages from).
 */
export function createRenderEncodeMasterMock(
  publish: (event: JobEnded) => void,
  seed?: MockExportSeed,
  profile: () => DeliveryProfile = () => MOCK_ACX,
  profiles: () => DeliveryProfile[] = () => [MOCK_ACX],
  multiPackageSeed?: MockExportSeed,
  chapters: () => readonly PreviewChapter[] = () => [],
): RenderEncodeMasterApi {
  const hold = seed === 'hold';
  const multiHold = multiPackageSeed === 'hold';
  const picked = new Set<string>();
  const encoded = new Set<string>();
  let exportJob: ExportJob = {
    id: null,
    kind: 'render_export',
    phase: 'idle',
    message: 'Choose the files to master and encode.',
    percent: 0,
    master: false,
    format: 'mp3',
    logs: [],
    elapsed: 0,
    files: [],
  };
  let packageJob: PackageJob = {
    id: null,
    kind: 'render_package',
    phase: 'idle',
    message: 'Export files, then build a package.',
    profile: '',
    outputDir: '',
    files: [],
    checklist: [],
    elapsed: 0,
  };
  let multiPackageJob: MultiPackageJob = {
    id: null,
    kind: 'render_package_multi',
    phase: 'idle',
    message: 'Export files, then choose the platforms to build for.',
    results: [],
    elapsed: 0,
  };

  const endExport = (phase: 'success' | 'cancelled' | 'error', message: string) => {
    exportJob = { ...exportJob, phase, message, logs: [...exportJob.logs, message], percent: phase === 'success' ? 100 : exportJob.percent };
    publish({ id: exportJob.id ?? '', kind: 'render_export', outcome: phase, message, durationMs: Math.round(exportJob.elapsed * 1000) });
  };

  // Each poll finishes one more file: masters it (if asked) then "encodes" it, standing in for the host's own
  // per-file progress.
  const advanceExport = () => {
    if (exportJob.phase !== 'running' || hold) return;
    const index = exportJob.files.findIndex((file) => file.status !== 'done' && file.status !== 'failed' && file.status !== 'cancelled');
    if (index < 0) return;
    const item = exportJob.files[index];
    const masteredPath = exportJob.master
      ? `C:/Users/Narrator/Wonderland/narration-utils/render-encode-master/mastered/${index + 1}${extOf(item.path)}`
      : undefined;
    const encodedPath = `C:/Users/Narrator/Wonderland/narration-utils/render-encode-master/encoded/${index + 1}.${exportJob.format}`;
    encoded.add(encodedPath);
    exportJob = {
      ...exportJob,
      files: exportJob.files.map((file, i) =>
        i === index ? { ...file, status: 'done', masteredPath, encodedPath, mastering: exportJob.master ? mockMastering() : undefined } : file,
      ),
      percent: Math.min(99, Math.round((100 * (index + 1)) / exportJob.files.length)),
      elapsed: exportJob.elapsed + 3,
      logs: [...exportJob.logs, `Prepared ${item.title || baseName(item.path)}.`],
    };
    if (index + 1 >= exportJob.files.length) endExport('success', `Prepared ${files(exportJob.files.length)}.`);
  };

  const bookRuleLabel = (forProfile: DeliveryProfile, ruleId: string): string => forProfile.rules.find((rule) => rule.id === ruleId)?.label ?? ruleId;

  const checklistFor = (forProfile: DeliveryProfile, items: PackageItem[]): PackageJob['checklist'] =>
    forProfile.rules
      .filter((rule) => rule.scope === 'book')
      .map((rule) => {
        if (rule.off) return { ruleId: rule.id, label: rule.label, status: 'off', detail: 'Turned off in this profile: not required.' };
        switch (rule.metric) {
          case 'credits_files': {
            const has = items.some((i) => i.kind === 'credits_opening') && items.some((i) => i.kind === 'credits_closing');
            return {
              ruleId: rule.id,
              label: rule.label,
              status: has ? 'included' : 'missing',
              detail: has ? 'Opening and closing credits included as separate files.' : 'Needs separate opening and closing credits files.',
            };
          }
          case 'retail_sample_seconds': {
            const has = items.some((i) => i.kind === 'retail_sample');
            return {
              ruleId: rule.id,
              label: rule.label,
              status: has ? 'included' : 'missing',
              detail: has ? 'A retail sample is included.' : 'Needs a retail sample file.',
            };
          }
          case 'one_section_per_file': {
            const count = items.filter((i) => i.kind === 'chapter').length;
            return { ruleId: rule.id, label: rule.label, status: 'included', detail: `Each of the ${count} chapters is its own file.` };
          }
          default:
            return {
              ruleId: rule.id,
              label: rule.label,
              status: 'not_applicable',
              detail: 'Not a packaging rule: judged by measurement, not by what files are present.',
            };
        }
      });

  const packageNameFor = (item: PackageItem, index: number): string => {
    const ext = '.mp3';
    switch (item.kind) {
      case 'credits_opening':
        return `Credits, Opening${ext}`;
      case 'credits_closing':
        return `Credits, Closing${ext}`;
      case 'retail_sample':
        return `Retail Sample${ext}`;
      default:
        return `${String(index + 1).padStart(2, '0')} - ${item.title}${ext}`;
    }
  };

  return {
    exportPickFiles: async (): Promise<MeasurePickResult> => {
      MOCK_EXPORT_PATHS.forEach((path) => picked.add(path));
      return { paths: [...MOCK_EXPORT_PATHS] };
    },
    exportStart: async (req: ExportRequest): Promise<ExportJob> => {
      if (req.items.length === 0) throw new Error('choose at least one file to export');
      const unpicked = req.items.find((item) => !picked.has(item.path));
      if (unpicked !== undefined) throw new Error(`"${unpicked.path}" was not chosen in the file picker; choose the files to export again`);
      const untitled = req.items.find((item) => item.kind === 'chapter' && item.title === '');
      if (untitled !== undefined) throw new Error(`"${untitled.path}" has no chapter title`);
      if (exportJob.phase === 'running') throw new Error('an export is already running');
      const message = `Preparing ${files(req.items.length)}.`;
      exportJob = {
        id: 'export-1',
        kind: 'render_export',
        phase: 'running',
        message,
        percent: 0,
        master: req.master,
        format: req.format || 'mp3',
        logs: [message],
        elapsed: 0,
        files: req.items.map((item) => ({ kind: item.kind, title: item.title, path: item.path, status: 'pending' })),
      };
      if (hold)
        exportJob = {
          ...exportJob,
          percent: 40,
          elapsed: 6,
          files: exportJob.files.map((f, i) => (i === 0 ? { ...f, status: req.master ? 'mastering' : 'encoding' } : f)),
        };
      return wireClone(exportJob);
    },
    exportState: async (): Promise<ExportJob> => {
      advanceExport();
      return wireClone(exportJob);
    },
    exportCancel: async (): Promise<ExportJob> => {
      if (exportJob.phase === 'running') {
        const done = exportJob.files.filter((file) => file.status === 'done').length;
        exportJob = { ...exportJob, files: exportJob.files.map((file) => (file.status === 'done' ? file : { ...file, status: 'cancelled' })) };
        endExport('cancelled', `Export cancelled. ${done} of ${exportJob.files.length} files were prepared.`);
      }
      return wireClone(exportJob);
    },
    packageStart: async (req: PackageRequest): Promise<PackageJob> => {
      const unencoded = req.items.find((item) => !encoded.has(item.path));
      if (unencoded !== undefined) throw new Error(`"${unencoded.path}" was not encoded in this session; export it again`);
      if (req.items.length === 0) throw new Error('choose at least one exported chapter to package');
      if (req.profileId !== profile().id) throw new Error(`there is no delivery profile "${req.profileId}"`);
      if (packageJob.phase === 'running') throw new Error('a package is already being built');
      const checklist = checklistFor(profile(), req.items);
      const missing = checklist.filter((item) => item.status === 'missing');
      packageJob = {
        id: 'package-1',
        kind: 'render_package',
        phase: 'running',
        message: `Building the ${profile().name} package.`,
        profile: profile().id,
        outputDir: 'C:\\Users\\Narrator\\Desktop\\Wonderland ACX',
        files: [],
        checklist,
        elapsed: 1.2,
      };
      if (missing.length > 0) {
        packageJob = {
          ...packageJob,
          phase: 'error',
          message: `The package could not be built: ${missing.map((item) => `${bookRuleLabel(profile(), item.ruleId)} (${item.detail})`).join('; ')}`,
        };
        publish({ id: packageJob.id ?? '', kind: 'render_package', outcome: 'error', message: packageJob.message, durationMs: 900 });
        return wireClone(packageJob);
      }
      const outputFiles = req.items.map((item, index) => ({
        kind: item.kind,
        name: packageNameFor(item, index),
        destPath: `${packageJob.outputDir}\\${packageNameFor(item, index)}`,
        tagged: false,
      }));
      if (!hold) {
        packageJob = { ...packageJob, phase: 'success', files: outputFiles, message: `Built the ${profile().id} package with ${outputFiles.length} files.` };
        publish({ id: packageJob.id ?? '', kind: 'render_package', outcome: 'success', message: packageJob.message, durationMs: 1200 });
      }
      return wireClone(packageJob);
    },
    packageState: async (): Promise<PackageJob> => wireClone(packageJob),
    packageCancel: async (): Promise<PackageJob> => {
      if (packageJob.phase === 'running') {
        packageJob = { ...packageJob, phase: 'cancelled', message: 'Packaging cancelled.' };
        publish({ id: packageJob.id ?? '', kind: 'render_package', outcome: 'cancelled', message: packageJob.message, durationMs: 500 });
      }
      return wireClone(packageJob);
    },
    packagePreview: async (profileId: string): Promise<PackagePreview> => {
      const found = profiles().find((candidate) => candidate.id === profileId);
      if (!found) throw new Error(`there is no delivery profile "${profileId}"`);
      return wireClone(mockPackagePreview(found, chapters()));
    },
    packageStartMulti: async (req: MultiPackageRequest): Promise<MultiPackageJob> => {
      if (req.selections.length === 0) throw new Error('choose at least one platform to build for');
      const resolved = req.selections.map((selection) => {
        const found = profiles().find((candidate) => candidate.id === selection.profileId);
        if (!found) throw new Error(`there is no delivery profile "${selection.profileId}"`);
        return found;
      });
      const unencoded = req.items.find((item) => !encoded.has(item.path));
      if (unencoded !== undefined) throw new Error(`"${unencoded.path}" was not encoded in this session; export it again`);
      if (req.items.length === 0) throw new Error('choose at least one exported chapter to package');
      if (packageJob.phase === 'running') throw new Error('a package is already being built');
      if (multiPackageJob.phase === 'running') throw new Error('a multi-platform package is already being built');

      const rootDir = 'C:\\Users\\Narrator\\Desktop\\Wonderland';
      const currentFormat = exportJob.format || 'mp3';
      // itemsByFormat memoizes the mock's own "re-encode", exactly as the host's own reencodeItems does: a format
      // matching the export job's own current format reuses req.items untouched; any other format is turned into
      // its own fake encoded item set once, shared by every selection that needs it.
      const itemsByFormat = new Map<string, PackageItem[]>([[currentFormat, req.items]]);
      const itemsFor = (format: string): PackageItem[] => {
        const cached = itemsByFormat.get(format);
        if (cached) return cached;
        const reencoded = req.items.map((item) => ({
          ...item,
          path: `C:/Users/Narrator/Wonderland/narration-utils/render-encode-master/encoded-${format}/${item.kind}.${format}`,
        }));
        itemsByFormat.set(format, reencoded);
        return reencoded;
      };

      const results: MultiPackageResult[] = resolved.map((forProfile) => {
        const format = requiredFormatMock(forProfile);
        const items = itemsFor(format);
        const checklist = checklistFor(forProfile, items);
        const missing = checklist.filter((item) => item.status === 'missing');
        const outputDir = `${rootDir}\\${sanitizeFolderNameMock(platformNameFor(forProfile))}`;
        if (missing.length > 0) {
          return {
            profile: forProfile.id,
            platform: platformNameFor(forProfile),
            phase: 'error',
            message: `The package could not be built: ${missing.map((item) => `${bookRuleLabel(forProfile, item.ruleId)} (${item.detail})`).join('; ')}`,
            outputDir: '',
            files: [],
            checklist,
            error: missing.map((item) => `${bookRuleLabel(forProfile, item.ruleId)} (${item.detail})`).join('; '),
          };
        }
        const files = items.map((item, index) => ({
          kind: item.kind,
          name: packageNameForFormat(item, index, format),
          destPath: `${outputDir}\\${packageNameForFormat(item, index, format)}`,
          tagged: false,
        }));
        return {
          profile: forProfile.id,
          platform: platformNameFor(forProfile),
          phase: 'success',
          message: `Built ${files.length} files.`,
          outputDir,
          files,
          checklist,
        };
      });

      const message = multiHold
        ? `Building the ${platformNameFor(resolved[0])} package (1 of ${resolved.length}).`
        : `Built ${results.filter((r) => r.phase === 'success').length} packages.`;
      multiPackageJob = {
        id: 'package-multi-1',
        kind: 'render_package_multi',
        phase: multiHold ? 'running' : results.some((r) => r.phase === 'error') ? 'error' : 'success',
        message,
        results: multiHold ? results.map((r, i) => (i === 0 ? { ...r, phase: 'running' } : { ...r, phase: 'pending', files: [], checklist: [] })) : results,
        elapsed: multiHold ? 3 : 6,
      };
      if (!multiHold) {
        publish({
          id: multiPackageJob.id ?? '',
          kind: 'render_package_multi',
          outcome: multiPackageJob.phase === 'error' ? 'error' : 'success',
          message: multiPackageJob.message,
          durationMs: Math.round(multiPackageJob.elapsed * 1000),
        });
      }
      return wireClone(multiPackageJob);
    },
    packageMultiState: async (): Promise<MultiPackageJob> => wireClone(multiPackageJob),
    packageMultiCancel: async (): Promise<MultiPackageJob> => {
      if (multiPackageJob.phase === 'running') {
        const done = multiPackageJob.results.filter((r) => r.phase === 'success').length;
        multiPackageJob = { ...multiPackageJob, phase: 'cancelled', message: `Cancelled. ${done} of ${multiPackageJob.results.length} packages were built.` };
        publish({
          id: multiPackageJob.id ?? '',
          kind: 'render_package_multi',
          outcome: 'cancelled',
          message: multiPackageJob.message,
          durationMs: Math.round(multiPackageJob.elapsed * 1000),
        });
      }
      return wireClone(multiPackageJob);
    },
  };
}
