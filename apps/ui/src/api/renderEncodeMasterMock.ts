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
  PackageItem,
  PackageJob,
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

/**
 * `picked` is the export picker's allowlist (mirrors ADR 0156's own discipline); `encoded` is the last export's own
 * encoded paths, package's own allowlist (mirrors the host's own "was it encoded this session" check).
 */
export function createRenderEncodeMasterMock(
  publish: (event: JobEnded) => void,
  seed?: MockExportSeed,
  profile: () => DeliveryProfile = () => MOCK_ACX,
): RenderEncodeMasterApi {
  const hold = seed === 'hold';
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

  const bookRuleLabel = (ruleId: string): string => profile().rules.find((rule) => rule.id === ruleId)?.label ?? ruleId;

  const checklistFor = (items: PackageItem[]): PackageJob['checklist'] =>
    profile()
      .rules.filter((rule) => rule.scope === 'book')
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
      const checklist = checklistFor(req.items);
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
          message: `The package could not be built: ${missing.map((item) => `${bookRuleLabel(item.ruleId)} (${item.detail})`).join('; ')}`,
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
  };
}
