import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { useChapterSync } from '../../hooks/useChapterSync';
import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import type { Notify } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { chapterSyncNotChaptersText, chapterSyncReasonText } from './chapterSyncText';

function syncedLabel(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'never' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Chapter sync's own panel on Tracks (daw-chapter-track-auto-sync.prd.md Phase 3, mockup 02): the on/off state and
 * last-sync summary, the Needs you list with an inline Link (chapterTrackSet, the same binding as Chapter links
 * below), and the tracks sync could not place. Nothing here shows before the consent dialog has been answered
 * (`ask`) - that is the narrator's first decision, not a second copy of it on Tracks.
 */
export function ChapterSyncPanel({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const api = useApi();
  const state = useChapterSync(api);
  const [preview, setPreview] = useState<ChapterSyncPreview>();
  const [toggling, setToggling] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [linkingChapterId, setLinkingChapterId] = useState('');

  const loadPreview = useCallback(async () => {
    try {
      setPreview(await api.chapterSyncPreview());
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  }, [api, notify]);

  useEffect(() => {
    if (state?.consent === 'on' && state.project === 'ready') void loadPreview();
  }, [state?.consent, state?.project, state?.lastSync, loadPreview]);

  if (!state || state.project !== 'ready' || state.consent === 'undecided') return null;

  const toggle = async (on: boolean) => {
    setToggling(true);
    try {
      await api.chapterSyncSetEnabled(on);
      onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setToggling(false);
    }
  };

  if (state.consent === 'off') {
    return (
      <Panel title="Chapter sync">
        <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Chapter sync is off.
          <Button variant="ghost" pending={toggling} onClick={() => void toggle(true)}>
            Turn on
          </Button>
        </div>
      </Panel>
    );
  }

  const link = async (chapterId: string, fallbackTrackGuid: string) => {
    const trackGuid = picked[chapterId] ?? fallbackTrackGuid;
    if (!trackGuid) return;
    setLinkingChapterId(chapterId);
    try {
      await api.chapterTrackSet(chapterId, trackGuid);
      notify('Track linked.');
      await loadPreview();
      onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setLinkingChapterId('');
    }
  };

  const notChapters = preview && chapterSyncNotChaptersText(preview.unmatched, preview.pickupTracks);

  return (
    <Panel title="Chapter sync">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span>
          On · last synced {syncedLabel(state.lastSync)} · {state.counts.linked} chapter{state.counts.linked === 1 ? '' : 's'} linked
        </span>
        <Button variant="ghost" pending={toggling} onClick={() => void toggle(false)}>
          Turn off
        </Button>
      </div>
      {preview && preview.needsYou.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="section-label">Needs you ({preview.needsYou.length})</h3>
          {preview.needsYou.map((item) => {
            const fallback = item.best?.trackGuid ?? item.candidates[0]?.trackGuid ?? '';
            const selected = picked[item.chapterId] ?? fallback;
            return (
              <div key={item.chapterId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.chapterTitle}</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {chapterSyncReasonText(item)}
                  </div>
                </div>
                {item.candidates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Select
                      label={`Track for ${item.chapterTitle}`}
                      value={selected}
                      onChange={(value) => setPicked((current) => ({ ...current, [item.chapterId]: value }))}
                      options={item.candidates.map((candidate) => ({ value: candidate.trackGuid, label: candidate.trackName }))}
                    />
                    <Button pending={linkingChapterId === item.chapterId} disabled={!selected} onClick={() => void link(item.chapterId, fallback)}>
                      Link
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {notChapters && notChapters.names !== 'None.' && (
        <div className="mt-3 border-t border-[var(--border)] pt-3 text-sm">
          <h3 className="section-label mb-1">Tracks that are not chapters</h3>
          <p>{notChapters.names}</p>
          {notChapters.note && (
            <p className="mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {notChapters.note}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
