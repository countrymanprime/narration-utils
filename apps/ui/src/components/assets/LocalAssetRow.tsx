import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { AssetItem } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { ProgressBar } from '../primitives/ProgressBar';
import type { Notify } from '../primitives/Toast';
import { bytesProgress, formatSize } from './AssetFacts';

/** What removing an asset means for the narrator, by kind: what stays and what will ask to download it again. */
const AFTER_REMOVAL: Record<string, string> = {
  tts: 'Your settings and project preview WAVs remain; requesting a new preview will ask to download the voice again.',
  whisper: 'Starting a comparison with this model selected will ask to download it again.',
  spacy: 'Your settings and Story Bibles remain; the next Story Bible build will ask to download it again, or build with rules only.',
};
const AFTER_REMOVAL_FALLBACK = 'Your settings and projects remain; whatever needs it will ask to download it again.';

/** The day of an ISO time (UTC), so the words do not change with the locale or the time zone. */
const day = (iso: string): string => `${iso.slice(0, 10)} UTC`;

const NEEDS_REPAIR_NOTE =
  'Some of its files are missing or no longer match the approved ones, so the app will not use it. Repair downloads it again and checks it.';

/** What a Verify found, in a sentence. */
const VERIFY_RESULT: Record<AssetItem['installState'], string> = {
  installed: 'Verified: every file matches the approved checksum.',
  verification_failed: 'Verification found files that no longer match the approved ones.',
  not_installed: 'Nothing is installed any more: the files are gone.',
};

type RowState = 'starting' | 'downloading' | 'verifying' | 'installed' | 'needs_repair' | 'not_installed';

/**
 * One asset of Settings > Local assets: what it is, its sizes and links, whether it is on this computer, and what can be done about it.
 * The row owns its download (the same `useAssetInstall` loop every first-use question uses, so the bytes are real and a second start joins the
 * one running) and its Verify and Remove. A download that was already running when the page opened is followed through `activeJobId`.
 * Nothing here fails silently: a failed download, verification or removal is written in the row.
 *
 * `onChanged` reloads the list, and resolves once the new list is on screen.
 */
export function LocalAssetRow({ item, onChanged, notify }: { item: AssetItem; onChanged: () => Promise<void>; notify: Notify }) {
  const api = useApi();
  // One action at a time for the row's Verify and Remove (ADR 0075); a download is its own job and cannot start while either runs.
  const actions = usePendingAction();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [actionFailure, setActionFailure] = useState('');
  const [verifyNote, setVerifyNote] = useState('');
  // The id of a download that was running when the page opened: the first start follows it, and every later one asks for a new install (the host
  // joins a running one, so asking never starts a second).
  const followedJob = useRef('');
  const install = useAssetInstall({
    start: () => {
      const jobId = followedJob.current;
      followedJob.current = '';
      return jobId ? api.assetsInstallState(jobId) : api.assetsInstall(item.kind, item.id);
    },
    state: (jobId) => api.assetsInstallState(jobId),
    cancel: (jobId) => api.assetsInstallCancel(jobId),
    onSuccess: onChanged,
  });
  const { job, running, starting, cancelFailure, begin } = install;
  const following = item.activeJobId;
  const ownFailure = install.failure;
  // Follow only a row that has no job of its own: one that started its own download sees the list report that same job, and must not
  // follow it again (a refused `begin` would leave the id behind for the next Download to pick up). A failed follow is not retried on its own.
  useEffect(() => {
    if (!following || starting || running || job || ownFailure) return;
    followedJob.current = following;
    void begin();
  }, [following, starting, running, job, ownFailure, begin]);
  // Once the list shows the install, its job is history: forgetting it means a later Verify that finds damage is what the row shows.
  const { reset } = install;
  useEffect(() => {
    if (job?.phase === 'success' && item.installState === 'installed') reset();
  }, [job?.phase, item.installState, reset]);
  // The button of the first slot, so focus can go back to it when the Remove that had it is gone.
  const firstButton = useRef<HTMLButtonElement>(null);

  const name = item.displayName;
  // What the row's buttons and messages call the asset: the kind too, because a name alone ("Small") does not say what it is to a screen reader.
  const subject = `${item.kindLabel} ${name}`;
  // A download that ended in success is installed until the list says so, so the row never shows Download for the length of the reload.
  const installedNow = job?.phase === 'success' || item.installState === 'installed';
  const state: RowState = starting
    ? 'starting'
    : running
      ? job?.phase === 'verifying'
        ? 'verifying'
        : 'downloading'
      : installedNow
        ? 'installed'
        : item.installState === 'verification_failed'
          ? 'needs_repair'
          : 'not_installed';
  const failure = running ? '' : install.failure || actionFailure || (job?.phase === 'error' ? job.error || job.message : '');
  const detail = job ? bytesProgress(job) : undefined;

  const startDownload = () => {
    setActionFailure('');
    setVerifyNote('');
    void begin();
  };
  const verify = () =>
    void actions.run('verify', async () => {
      setActionFailure('');
      setVerifyNote('');
      try {
        const result = await api.assetsVerify(item.kind, item.id);
        setVerifyNote(VERIFY_RESULT[result.installState]);
        await onChanged();
      } catch (error) {
        setActionFailure(`Could not verify ${subject}: ${apiErrorMessage(error)}`);
      }
    });
  const remove = () =>
    void actions.run('remove', async () => {
      setActionFailure('');
      try {
        await api.assetsRemove(item.kind, item.id);
        install.reset();
        setVerifyNote('');
        notify(`${subject} removed from this computer.`);
        // The confirm stays open and busy until the new list is in, so the row never shows Remove again for an asset that is gone.
        await onChanged();
        setConfirmingRemove(false);
        // The Remove that had focus is gone with the asset: the row's next action is where focus goes (the confirm returns it to the page otherwise).
        window.requestAnimationFrame(() => firstButton.current?.focus());
      } catch (error) {
        setConfirmingRemove(false);
        setActionFailure(`Could not remove ${subject}: ${apiErrorMessage(error)}`);
      }
    });

  const cancelled = job?.phase === 'cancelled' ? job.message : '';
  const notice =
    state === 'starting'
      ? 'Starting the download…'
      : state === 'downloading' || state === 'verifying'
        ? (job?.message ?? '')
        : state === 'needs_repair'
          ? [cancelled, verifyNote, NEEDS_REPAIR_NOTE].filter(Boolean).join(' ')
          : [cancelled, verifyNote].filter(Boolean).join(' ');
  const stateText: Record<RowState, string> = {
    starting: 'Starting',
    downloading: 'Downloading',
    verifying: 'Verifying',
    installed: 'Installed',
    needs_repair: 'Needs repair',
    not_installed: 'Not installed',
  };

  return (
    <li className="rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="font-medium [overflow-wrap:anywhere]">{name}</h3>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {item.kindLabel} · version <span className="break-all">{item.version}</span>
          </div>
        </div>
        <span className="text-xs font-semibold" style={{ color: state === 'needs_repair' ? 'var(--warn-text)' : 'var(--text)' }}>
          {stateText[state]}
        </span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div>
          <dt className="inline font-medium">Publisher: </dt>
          <dd className="inline">{item.publisher}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Download: </dt>
          <dd className="inline">{formatSize(item.downloadSize)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">On disk: </dt>
          <dd className="inline">{formatSize(item.diskSize)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">License: </dt>
          <dd className="inline">
            <a className="link" href={item.licenseUrl} target="_blank" rel="noreferrer">
              {item.license}
            </a>
          </dd>
        </div>
        {item.installedAt && (
          <div>
            <dt className="inline font-medium">Installed: </dt>
            <dd className="inline">{day(item.installedAt)}</dd>
          </div>
        )}
        {item.verifiedAt && (
          <div>
            <dt className="inline font-medium">Last verified: </dt>
            <dd className="inline">{day(item.verifiedAt)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <a className="link" href={item.modelCardUrl} target="_blank" rel="noreferrer">
          Model card
        </a>
        {' · '}
        <a className="link" href={item.provenanceUrl} target="_blank" rel="noreferrer">
          Provenance
        </a>
      </p>
      {(state === 'starting' || state === 'downloading' || state === 'verifying') && (
        <div className="mt-3">
          {/* The bar carries the numbers for a screen reader (they move on every poll); the sentence beside it is the live region below. */}
          <ProgressBar label={`Download progress for ${subject}`} value={job ? job.percent : null} running valueText={detail} />
          {detail && (
            <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              {detail} · {job?.percent ?? 0}%
            </div>
          )}
        </div>
      )}
      {/* One live region for the row, present before it has anything to say: progress and results are polite, a failure below interrupts. */}
      <div role="status" className={notice ? 'mt-2 text-xs' : 'text-xs'}>
        {notice}
      </div>
      {(failure || cancelFailure) && (
        <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--danger-text)' }}>
          {failure || `The download could not be stopped: ${cancelFailure}`}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'starting' || state === 'verifying' ? (
          <Button ref={firstButton} variant="ghost" pending aria-label={`${state === 'starting' ? 'Starting the download of' : 'Verifying'} ${subject}`}>
            {state === 'starting' ? 'Starting' : 'Verifying'}
          </Button>
        ) : state === 'downloading' ? (
          <Button ref={firstButton} variant="ghost" aria-label={`Cancel the download of ${subject}`} onClick={() => void install.cancel()}>
            Cancel
          </Button>
        ) : state === 'installed' ? (
          <Button
            ref={firstButton}
            variant="ghost"
            aria-label={`Verify ${subject}`}
            pending={actions.isPending('verify')}
            disabled={actions.isBlockedFor('verify')}
            onClick={verify}
          >
            Verify
          </Button>
        ) : (
          <Button ref={firstButton} aria-label={`${state === 'needs_repair' ? 'Repair' : 'Download'} ${subject}`} onClick={startDownload}>
            {state === 'needs_repair' ? 'Repair' : 'Download'}
          </Button>
        )}
        {(state === 'installed' || state === 'needs_repair') && (
          <Button variant="danger" aria-label={`Remove ${subject}`} disabled={actions.isBlockedFor('remove')} onClick={() => setConfirmingRemove(true)}>
            Remove
          </Button>
        )}
      </div>
      {confirmingRemove && (
        <ConfirmDialog
          title={`Remove ${subject}?`}
          body={`Remove ${subject} from this computer? This frees ${formatSize(item.diskSize)}. ${AFTER_REMOVAL[item.kind] ?? AFTER_REMOVAL_FALLBACK}`}
          confirmLabel="Remove"
          confirmVariant="danger"
          pending={actions.isPending('remove')}
          confirm={remove}
          cancel={() => setConfirmingRemove(false)}
        />
      )}
    </li>
  );
}
