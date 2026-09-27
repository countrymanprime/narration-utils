import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import { useCapability } from '../../useCapability';
import type { CleanupPreviewResult, LevelMatchPreviewResult } from '../../types';
import { Button } from '../primitives/Button';
import { CapabilityGate } from '../primitives/CapabilityGate';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import type { Notify } from '../primitives/Toast';

/**
 * Silence trim and item gain (booth-actions-enablement PRD Phase 5): the Editing view's own row for `bridge.CleanupClient`
 * and `bridge.LevelMatchClient`, the first real callers of either (Evidence section, apps/desktop/internal/bridge/
 * {cleanup.go,levelnormalize.go}). Each action previews its candidates through the host before offering Apply in a
 * `ConfirmDialog` (Open Question 1's recommendation: a button here, no new page), and each is gated behind its own
 * `CapabilityGate` so the control is visible - disabled with the host's "Experimental" message - from day one and
 * switches live with no code change once the owner's verification pass promotes it (D1).
 */

/** The level-match target this action offers (Open Question 1's minimal scope: no per-narrator target setting exists
 * yet - DAW port PRD P4's per-capability Settings rows are a later phase). ACX's own RMS window is -23 to -18 dBFS;
 * the middle of that range is a reasonable default match target until a narrator can choose one. */
const LEVEL_MATCH_METRIC = 'rms_dbfs' as const;
const LEVEL_MATCH_TARGET_DB = -20;
const LEVEL_MATCH_TOLERANCE_DB = 2;

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function CleanupTrimAction({ chapterId, notify }: { chapterId: string; notify: Notify }) {
  const api = useApi();
  const capability = useCapability('silence_trim');
  const action = usePendingAction();
  const [preview, setPreview] = useState<CleanupPreviewResult>();

  const openPreview = () =>
    action.run('cleanup-preview', async () => {
      try {
        setPreview(await api.cleanupPreview(chapterId));
      } catch (reason) {
        notify(describeApiError(reason), 'error');
      }
    });

  const apply = () =>
    action.run('cleanup-apply', async () => {
      try {
        const result = await api.cleanupApply(chapterId);
        notify(`Trimmed ${pluralize(result.applied, 'candidate')} of ${result.candidates}.`, 'info');
      } catch (reason) {
        notify(describeApiError(reason), 'error');
      } finally {
        setPreview(undefined);
      }
    });

  return (
    <>
      <CapabilityGate capability={capability}>
        <Button
          variant="ghost"
          onClick={() => void openPreview()}
          pending={action.isPending('cleanup-preview')}
          disabled={action.isBlockedFor('cleanup-preview')}
        >
          Trim silence…
        </Button>
      </CapabilityGate>
      {preview && (
        <ConfirmDialog
          title="Trim silence"
          confirmLabel="Trim"
          confirm={() => void apply()}
          cancel={() => setPreview(undefined)}
          pending={action.isPending('cleanup-apply')}
          body={
            <>
              <p>
                {pluralize(preview.candidates, 'silence candidate')} in this chapter. REAPER has marked {pluralize(preview.added, 'take marker')} for preview
                {preview.existing > 0 ? ` (${pluralize(preview.existing, 'marker')} already there)` : ''}.
              </p>
              {preview.stale.length > 0 && (
                <p style={{ color: 'var(--danger-text)' }}>
                  {pluralize(preview.stale.length, 'candidate')} {preview.stale.length === 1 ? 'is' : 'are'} stale (the saved project has changed since the last
                  check) and will be skipped.
                </p>
              )}
              <p>Trimming removes the marked audio in REAPER, in one undo step.</p>
            </>
          }
        />
      )}
    </>
  );
}

function LevelMatchAction({ chapterId, notify }: { chapterId: string; notify: Notify }) {
  const api = useApi();
  const capability = useCapability('item_gain');
  const action = usePendingAction();
  const [preview, setPreview] = useState<LevelMatchPreviewResult>();

  const openPreview = () =>
    action.run('gain-preview', async () => {
      try {
        setPreview(await api.levelMatchPreview(chapterId, LEVEL_MATCH_METRIC, LEVEL_MATCH_TARGET_DB, LEVEL_MATCH_TOLERANCE_DB));
      } catch (reason) {
        notify(describeApiError(reason), 'error');
      }
    });

  const apply = () =>
    action.run('gain-apply', async () => {
      try {
        const result = await api.levelMatchApply(chapterId, LEVEL_MATCH_METRIC, LEVEL_MATCH_TARGET_DB, LEVEL_MATCH_TOLERANCE_DB);
        notify(`Matched levels on ${pluralize(result.changed.length, 'item')}.`, 'info');
      } catch (reason) {
        notify(describeApiError(reason), 'error');
      } finally {
        setPreview(undefined);
      }
    });

  return (
    <>
      <CapabilityGate capability={capability}>
        <Button variant="ghost" onClick={() => void openPreview()} pending={action.isPending('gain-preview')} disabled={action.isBlockedFor('gain-preview')}>
          Match levels…
        </Button>
      </CapabilityGate>
      {preview && (
        <ConfirmDialog
          title="Match levels"
          confirmLabel="Match"
          confirm={() => void apply()}
          cancel={() => setPreview(undefined)}
          pending={action.isPending('gain-apply')}
          body={
            <>
              <p>
                {pluralize(preview.candidates.length, 'item')} on this chapter's linked track differ from {LEVEL_MATCH_TARGET_DB} dBFS RMS by more than{' '}
                {LEVEL_MATCH_TOLERANCE_DB} dB.
              </p>
              <p>Matching changes each item's volume in REAPER to bring it onto target, in one undo step.</p>
            </>
          }
        />
      )}
    </>
  );
}

export function CleanupAction({ chapterId, notify }: { chapterId: string; notify: Notify }) {
  return (
    <div className="flex flex-wrap gap-2">
      <CleanupTrimAction chapterId={chapterId} notify={notify} />
      <LevelMatchAction chapterId={chapterId} notify={notify} />
    </div>
  );
}
