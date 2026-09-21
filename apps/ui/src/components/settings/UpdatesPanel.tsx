import { useCallback, useEffect, useRef, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { UpdateStatus } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { UpdateDownloadDialog } from './UpdateDownloadDialog';

const BYTES_PER_MB = 1024 * 1024;

/** The day of a check, from the host's ISO time (UTC), so the words do not change with the locale or the time zone. */
function checkedDay(lastChecked: string): string {
  return `${lastChecked.slice(0, 10)} UTC`;
}

/**
 * What the app knows about newer releases: the newest one on the narrator's channel if it is newer than this build, when the app last
 * looked, and a Check now button. It only reads and reports here: nothing is downloaded from this panel (ADR 0072).
 *
 * `formDirty` says the settings beside it have unsaved edits: a check asks with the saved channel, so it waits until they are saved
 * rather than answer a question the narrator has already changed. The caller gives the panel a new `key` when the saved channel
 * changes, so it asks the host again for what is available on the new one.
 */
export function UpdatesPanel({ formDirty = false }: { formDirty?: boolean }) {
  const api = useApi();
  const [status, setStatus] = useState<UpdateStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const checkButton = useRef<HTMLButtonElement>(null);
  // The narrator's steps toward an update: asked to confirm, downloading, and the version that finished downloading.
  const [confirming, setConfirming] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState('');

  useEffect(() => {
    let active = true;
    api
      .updateStatus()
      // An event that arrived first is newer than this answer.
      .then((next) => active && setStatus((current) => current ?? next))
      .catch((failure) => active && setError(describeApiError(failure)));
    // A check the app makes on its own, after this page opened, that found a release.
    const unsubscribe = api.subscribeUpdate((next) => {
      setStatus(next);
      setError('');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const check = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      setStatus(await api.updateCheck());
    } catch (failure) {
      setError(describeApiError(failure));
    } finally {
      setChecking(false);
      // The button was disabled while it ran, which drops keyboard focus; the result is announced, and focus comes back to it.
      checkButton.current?.focus();
    }
  }, [api]);

  const openNotes = useCallback(() => {
    api.updateOpenNotes().catch((failure) => setError(describeApiError(failure)));
  }, [api]);

  const errorAlert = error && (
    <p role="alert" style={{ color: 'var(--danger-text)' }}>
      {error}
    </p>
  );
  if (!status) {
    return errorAlert ? (
      <div className="mb-4 rounded-md p-3 text-sm" style={{ background: 'var(--review-soft)' }}>
        {errorAlert}
      </div>
    ) : null;
  }

  const available = status.available;
  return (
    <div className="mb-4 space-y-3 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
      <div className="font-medium">Updates</div>
      {status.development ? (
        <p style={{ color: 'var(--text-muted)' }}>Update checks are for releases. A development build is never offered an update.</p>
      ) : !status.platform ? (
        <p style={{ color: 'var(--text-muted)' }}>Narration Utils has no release for this kind of computer, so there is nothing to update to.</p>
      ) : (
        <>
          {/* One live region for the result, so a screen reader hears what a check found; it is remembered state, not an alert. */}
          <div role="status" className="space-y-2">
            {available ? (
              <>
                <div className="font-medium">Version {available.version} is available</div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {available.candidate ? 'A release candidate' : 'A release'} · {Math.round(available.size / BYTES_PER_MB)} MB
                </div>
                {available.replaces && downloaded === available.version && <p>Version {available.version} is downloaded and checked.</p>}
                {!available.replaces && (
                  <p style={{ color: 'var(--text-muted)' }}>
                    This platform does not update itself. Open the release notes to download it from the release page.
                  </p>
                )}
              </>
            ) : status.failure ? null : status.lastChecked ? (
              <p>You have the latest version.</p>
            ) : (
              <p>Not checked yet.</p>
            )}
            {status.lastChecked && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Last checked {checkedDay(status.lastChecked)}
              </p>
            )}
            {status.failure && <p style={{ color: 'var(--danger-text)' }}>{status.failure}</p>}
          </div>
          {available && (
            <div className="flex flex-wrap items-center gap-3">
              {available.replaces && downloaded !== available.version && (
                <Button className="text-xs" onClick={() => setConfirming(true)}>
                  Download update
                </Button>
              )}
              <Button variant="ghost" className="text-xs" aria-label="Release notes (opens in your browser)" onClick={openNotes}>
                Release notes
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button ref={checkButton} variant="ghost" className="text-xs" disabled={checking || formDirty} onClick={() => void check()}>
              {checking ? 'Checking…' : 'Check now'}
            </Button>
            {formDirty && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Save your changes first: a check uses the saved settings.
              </span>
            )}
          </div>
        </>
      )}
      {errorAlert}
      {confirming && available && (
        <ConfirmDialog
          title={`Download version ${available.version}?`}
          body={`This downloads Narration Utils ${available.version} (${Math.round(available.size / BYTES_PER_MB)} MB) from GitHub and checks it against the release's checksum. Nothing is installed yet, and you can cancel the download.`}
          confirmLabel="Download"
          confirm={() => {
            setConfirming(false);
            setDownloading(true);
          }}
          cancel={() => setConfirming(false)}
        />
      )}
      {downloading && available && (
        <UpdateDownloadDialog
          available={available}
          close={(result) => {
            setDownloading(false);
            if (result === 'ready') setDownloaded(available.version);
          }}
        />
      )}
    </div>
  );
}
