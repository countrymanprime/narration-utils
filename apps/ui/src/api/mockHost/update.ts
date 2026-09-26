// The mock host (mockApi.ts): the app update.
import type { NarrationApi } from '../../types';
import type { UpdateJob, UpdateStatus } from '../contracts/update';
import { wireClone } from '../mockFixtures';
import type { MockApiSeed } from './state';

/** The version the mock host reports as its own; the update states (`MockUpdateSeed`) offer a newer one. */
const MOCK_APP_VERSION = '0.2.6';
const MOCK_DEVELOPMENT_VERSION = '0.0.0-dev';
const MOCK_CHECKED_AT = '2026-09-21T12:00:00Z';

/** Which update state the mock host boots in: `available` found a newer release, `found` is the same and the host also says so at once, as a background check does, `downloading` is the same with a download that stops at 40% (to look at the dialog) and `download-fails` one that ends in an error, `failed` could not reach GitHub, `current` checked and is up to date, `development` is a build with no release to compare with. Without one, nothing has been checked yet. */
export type MockUpdateSeed =
  'available' | 'found' | 'downloading' | 'download-fails' | 'ready' | 'install-blocked' | 'install-refused' | 'failed' | 'current' | 'development';

function seedUpdateStatus(seed: MockUpdateSeed | undefined): UpdateStatus {
  const status: UpdateStatus = {
    version: MOCK_APP_VERSION,
    development: false,
    platform: 'windows-x64',
    channel: 'candidates',
    canInstall: true,
    installBlockedReason: '',
    downloaded: null,
    lastChecked: '',
    failure: '',
    available: null,
  };
  switch (seed) {
    case 'install-blocked':
      return {
        ...seedUpdateStatus('available'),
        canInstall: false,
        installBlockedReason:
          'Narration Utils is installed where it is not allowed to replace itself. Download the update and replace the program yourself, or ask whoever manages this computer.',
      };
    case 'available':
    case 'found':
    case 'downloading':
    case 'download-fails':
    case 'ready':
    case 'install-refused':
      return {
        ...status,
        lastChecked: MOCK_CHECKED_AT,
        available: {
          version: '0.2.7',
          tag: 'v0.2.7-rc',
          candidate: true,
          notesUrl: 'https://github.com/countrymanprime/narration-utils/releases/tag/v0.2.7-rc',
          size: 419_895_808,
          publishedAt: '2026-09-20T10:00:00Z',
          replaces: true,
        },
      };
    case 'failed':
      return { ...status, failure: 'Could not reach GitHub to check for updates.' };
    case 'current':
      return { ...status, lastChecked: MOCK_CHECKED_AT };
    case 'development':
      return {
        ...status,
        version: MOCK_DEVELOPMENT_VERSION,
        development: true,
        canInstall: false,
        installBlockedReason: 'A development build does not update itself.',
      };
    default:
      return status;
  }
}

/** The update bindings: what the mock host says about a newer release, and its download and install. */
export function createUpdateMock(initial: MockApiSeed) {
  let updateStatus = seedUpdateStatus(initial.update);
  let updateJob: UpdateJob | undefined =
    initial.update === 'ready' || initial.update === 'install-refused'
      ? {
          id: 'mock-update',
          version: '0.2.7',
          phase: 'ready',
          message: 'Version 0.2.7 is downloaded and checked.',
          percent: 100,
          bytesDone: 419_895_808,
          bytesTotal: 419_895_808,
          error: '',
        }
      : undefined;
  let updateJobTimer: ReturnType<typeof setInterval> | undefined;
  const mockUpdateStatus = (): UpdateStatus => ({
    ...updateStatus,
    downloaded: updateJob?.phase === 'ready' && updateStatus.available ? { jobId: updateJob.id, version: updateJob.version } : null,
  });
  const bindings = {
    updateStatus: async () => wireClone(mockUpdateStatus()),
    updateCheck: async () => {
      // A check that works records the time; one that cannot reach GitHub says so again.
      if (!updateStatus.failure && !updateStatus.development) updateStatus = { ...updateStatus, lastChecked: MOCK_CHECKED_AT };
      return wireClone(mockUpdateStatus());
    },
    updateDownload: async () => {
      const available = updateStatus.available;
      if (!available) throw new Error('There is no newer release to download.');
      const total = available.size;
      updateJob = {
        id: 'mock-update',
        version: available.version,
        phase: 'downloading',
        message: `Downloading Narration Utils ${available.version}…`,
        percent: 0,
        bytesDone: 0,
        bytesTotal: total,
        error: '',
      };
      if (initial.update === 'downloading') {
        // Stays here, so the dialog can be looked at: real bytes over real bytes, a little under half.
        updateJob = { ...updateJob, percent: 40, bytesDone: Math.floor(total * 0.4) };
        return wireClone(updateJob);
      }
      clearInterval(updateJobTimer);
      updateJobTimer = setInterval(() => {
        const current = updateJob;
        if (!current || current.phase === 'cancelled') return clearInterval(updateJobTimer);
        if (current.phase === 'downloading') {
          const bytesDone = Math.min(total, current.bytesDone + Math.ceil(total / 5));
          if (initial.update === 'download-fails' && bytesDone >= total * 0.4) {
            const failure = 'The checksum in the release and GitHub’s own record of the file disagree, so the update was not used.';
            updateJob = { ...current, phase: 'error', bytesDone, percent: Math.floor((bytesDone / total) * 100), message: failure, error: failure };
            return clearInterval(updateJobTimer);
          }
          updateJob =
            bytesDone >= total
              ? { ...current, bytesDone, percent: 100, phase: 'verifying', message: 'Checking the download against the release’s checksum…' }
              : { ...current, bytesDone, percent: Math.floor((bytesDone / total) * 100) };
        } else if (current.phase === 'verifying') {
          updateJob = { ...current, phase: 'unpacking', message: 'Unpacking the program…' };
        } else if (current.phase === 'unpacking') {
          updateJob = { ...current, phase: 'ready', message: `Version ${current.version} is downloaded and checked.` };
          clearInterval(updateJobTimer);
        }
      }, 300);
      return wireClone(updateJob);
    },
    updateInstall: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId || updateJob.phase !== 'ready') throw new Error('The update is not downloaded yet.');
      if (initial.update === 'install-refused') {
        throw new Error(
          'Narration Utils is busy, so the update was not installed. Finish or stop what is running (an import, a Story Bible build, a download, a comparison or a teleprompter session), then try again.',
        );
      }
      updateJob = { ...updateJob, phase: 'installing', message: `Installing version ${updateJob.version}. Narration Utils restarts in a moment.` };
      return wireClone(updateJob);
    },
    updateShowDownload: async () => undefined,
    updateJobState: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId) throw new Error('unknown update job');
      return wireClone(updateJob);
    },
    updateJobCancel: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId) throw new Error('unknown update job');
      clearInterval(updateJobTimer);
      updateJob = { ...updateJob, phase: 'cancelled', message: 'The update download was cancelled.' };
      return wireClone(updateJob);
    },
    updateOpenNotes: async () => undefined,
    subscribeUpdate: (onStatus) => {
      if (initial.update !== 'found') return () => {};
      const timer = setTimeout(() => onStatus(wireClone(updateStatus)), 0);
      return () => clearTimeout(timer);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings, version: () => updateStatus.version };
}
