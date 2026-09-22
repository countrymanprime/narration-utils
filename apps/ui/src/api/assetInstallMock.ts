import type { AssetInstallJob } from '../types';

/** How the mock's next install behaves. Unset, it runs to the end: half the bytes, the check, success. */
export type MockAssetSeed = 'downloading' | 'verifying' | 'download-fails';

const FAILURE =
  'The downloaded file did not match the approved one, so it was not installed. Try again; if it keeps happening, the file may have changed at its source.';

/**
 * A scripted install for the mock host: the same steps the real one reports (real bytes, the check, one end), one step for each time it is
 * asked how it is going, so a unit test or the visual suite sees `downloading`, `verifying` and `success` and not a job that is done before
 * it began. `downloading` holds at 40 percent and `verifying` at the check, for a screenshot; `download-fails` ends in a failure sentence.
 *
 * Starting again while one is running joins it, as the host does.
 */
export function createInstallMock<Extra extends object>(options: { total: number; noun: string; extra: Extra; seed?: MockAssetSeed; onInstalled: () => void }) {
  const { total, noun, extra, seed, onInstalled } = options;
  const capital = noun.charAt(0).toUpperCase() + noun.slice(1);
  let count = 0;
  let current: (AssetInstallJob & Extra) | undefined;

  const running = (job: AssetInstallJob | undefined) => job?.phase === 'downloading' || job?.phase === 'verifying';
  const download = (done: number): AssetInstallJob => ({
    id: current?.id ?? '',
    phase: 'downloading',
    message: `Downloading and verifying the approved ${noun}…`,
    percent: Math.floor((done / total) * 99),
    bytesDone: done,
    bytesTotal: total,
    error: '',
  });
  const verifying = (): AssetInstallJob => ({
    ...download(total),
    phase: 'verifying',
    message: `Checking the ${noun} against its approved checksum…`,
    percent: 99,
  });

  const advance = (job: AssetInstallJob & Extra): AssetInstallJob & Extra => {
    if (job.phase === 'downloading') {
      if (seed === 'downloading') return { ...job, ...download(Math.floor(total * 0.4)) };
      if (seed === 'download-fails' && job.bytesDone > 0) return { ...job, phase: 'error', message: FAILURE, error: FAILURE };
      if (seed === 'download-fails') return { ...job, ...download(Math.floor(total * 0.4)) };
      return job.bytesDone === 0 ? { ...job, ...download(Math.floor(total / 2)) } : { ...job, ...verifying() };
    }
    if (job.phase === 'verifying') {
      if (seed === 'verifying') return job;
      onInstalled();
      return { ...job, phase: 'success', message: `${capital} installed and verified.`, percent: 100, bytesDone: total, error: '' };
    }
    return job;
  };

  return {
    start: async (): Promise<AssetInstallJob & Extra> => {
      if (current && running(current)) return { ...current };
      current = { ...extra, ...download(0), id: `mock-${noun.replace(/\W+/g, '-')}-${++count}` };
      if (seed === 'verifying') current = { ...current, ...verifying() };
      return { ...current };
    },
    state: async (jobId: string): Promise<AssetInstallJob & Extra> => {
      if (!current || current.id !== jobId) throw new Error(`unknown ${noun} install job`);
      current = advance(current);
      return { ...current };
    },
    cancel: async (jobId: string): Promise<AssetInstallJob & Extra> => {
      if (!current || current.id !== jobId) throw new Error(`unknown ${noun} install job`);
      if (running(current)) current = { ...current, phase: 'cancelled', message: `${capital} download cancelled.` };
      return { ...current };
    },
  };
}
