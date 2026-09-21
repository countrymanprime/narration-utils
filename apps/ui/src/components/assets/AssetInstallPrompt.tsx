import type { ReactNode } from 'react';
import type { AssetInstall } from '../../hooks/useAssetInstall';
import type { AssetInstallJob, WorkJob } from '../../types';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { WorkDialog } from '../primitives/WorkDialog';
import { bytesProgress } from './AssetFacts';

const WORK_PHASE: Record<AssetInstallJob['phase'], WorkJob['phase']> = {
  downloading: 'running',
  verifying: 'running',
  success: 'success',
  cancelled: 'cancelled',
  error: 'error',
};

function workJob(install: AssetInstall): WorkJob {
  const { job, failure, cancelFailure, log, seconds } = install;
  if (failure) return { id: null, kind: 'asset_install', phase: 'error', message: failure, percent: 0, logs: log, elapsed: seconds, error: failure };
  if (!job) return { id: null, kind: 'asset_install', phase: 'preparing', message: 'Starting the download…', percent: 0, logs: log, elapsed: seconds };
  return {
    id: job.id,
    kind: 'asset_install',
    phase: WORK_PHASE[job.phase],
    message: cancelFailure ? `The download could not be stopped: ${cancelFailure}` : job.message,
    detail: bytesProgress(job),
    percent: job.percent,
    logs: log,
    elapsed: seconds,
    error: job.phase === 'error' ? job.error || job.message : undefined,
  };
}

/**
 * The first-use question for an optional download and, once the narrator says yes, its progress: one prompt for every asset (a voice, a
 * Whisper model, and the models that follow), driven by `useAssetInstall`. The question is a confirm that says what will be downloaded
 * (`children` carries the caller's facts about the asset); the progress is the shared work dialog with the real bytes, a Cancel while bytes
 * arrive, and no Cancel while the files are being checked (ADR 0057). A failure stays on screen until the narrator closes it.
 *
 * The caller closes the prompt itself when the install succeeded (its `onSuccess` continues the operation the narrator asked for).
 */
export function AssetInstallPrompt({
  ask,
  workTitle,
  install,
  dismiss,
  children,
}: {
  /** `alternative` is a second way forward beside the download (the Story Bible builds without a language model this once). */
  ask: { title: string; body: ReactNode; confirmLabel: string; alternative?: { label: string; action: () => void } };
  workTitle: string;
  install: AssetInstall;
  /** Cancel in the question, and Close once the install ended without success. */
  dismiss: () => void;
  children?: ReactNode;
}) {
  const asking = !install.job && !install.failure && !install.starting;
  const secondaryChoice: { secondary: () => void; secondaryLabel: string } | { secondary?: undefined; secondaryLabel?: undefined } = ask.alternative
    ? { secondary: ask.alternative.action, secondaryLabel: ask.alternative.label }
    : {};
  if (asking) {
    return (
      <ConfirmDialog
        title={ask.title}
        body={ask.body}
        confirmLabel={ask.confirmLabel}
        confirm={() => void install.begin()}
        cancel={dismiss}
        {...secondaryChoice}
      >
        {children}
      </ConfirmDialog>
    );
  }
  // Only the download itself can be stopped; the checks after it finish what they started.
  const canCancel = install.job?.phase === 'downloading';
  return <WorkDialog title={workTitle} job={workJob(install)} close={dismiss} cancel={canCancel ? () => void install.cancel() : undefined} />;
}
