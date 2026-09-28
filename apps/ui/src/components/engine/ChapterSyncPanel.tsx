import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { useChapterSync } from '../../hooks/useChapterSync';
import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import type { Notify } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import {
  chapterSyncActivityRows,
  chapterSyncPanelNotChaptersText,
  chapterSyncPanelReasonText,
  chapterSyncSummaryText,
  chapterSyncTimeLabel,
} from './chapterSyncText';

/**
 * Chapter sync's own section of the engine panel (daw-chapter-track-auto-sync.prd.md Phases 3 and 4, mockup 02; stage navigation
 * Phase 6 moved it off the Tracks page): the on/off state and last-sync summary, the Needs you list with an inline Link
 * (chapterTrackSet, the same binding as Chapter links below), the tracks sync could not place, and the Sync activity with Undo
 * on a link sync made. Nothing here shows before the consent dialog has been answered (`ask`) - that is the narrator's first
 * decision, not a second copy of it here.
 */
export function ChapterSyncPanel({ notify, onChanged }: { notify: Notify; onChanged: () => void }) {
  const api = useApi();
  const state = useChapterSync(api);
  const [preview, setPreview] = useState<ChapterSyncPreview>();
  const [toggling, setToggling] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [linkingChapterId, setLinkingChapterId] = useState('');
  const [undoingTrackGuid, setUndoingTrackGuid] = useState('');

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

  // Undo removes one automatic link and remembers the pair so sync never makes it again (ADR 0209); the host answers with the
  // state, and chaptersync:state follows, so the list redraws on its own.
  const undo = async (trackGuid: string) => {
    setUndoingTrackGuid(trackGuid);
    try {
      await api.chapterSyncUndo(trackGuid);
      notify('Link undone. Sync will not make it again.');
      onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setUndoingTrackGuid('');
    }
  };

  const notChapters = preview ? chapterSyncPanelNotChaptersText(preview.unmatched, preview.pickupTracks) : '';
  const notChaptersCount = preview ? preview.unmatched.length + preview.pickupTracks.length : 0;
  // A link line offers Undo only while the chapter still holds that automatic link: Undo on a link already changed or cleared
  // would be refused by the host, so it is not offered.
  const stillAuto = (trackGuid: string) => state.chapters.some((chapter) => chapter.trackGuid === trackGuid && chapter.origin === 'auto');
  const activity = chapterSyncActivityRows(state.activity, (guid) => state.chapters.find((chapter) => chapter.trackGuid === guid)?.trackName ?? '');

  return (
    <Panel
      title="Chapter sync"
      actions={
        <Button variant="ghost" pending={toggling} onClick={() => void toggle(false)}>
          Turn off
        </Button>
      }
    >
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {chapterSyncSummaryText({ lastSync: state.lastSync, projectFile: state.projectFile, chapters: state.chapters, linked: state.counts.linked })}
      </p>
      {state.unsavedEdits && (
        <p role="status" className="mt-1 text-sm" style={{ color: 'var(--warn-text)' }}>
          REAPER has changes that aren&rsquo;t saved yet. Sync reads the saved project, so it picks them up when you save.
        </p>
      )}
      {preview && preview.needsYou.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="section-label">Needs you ({preview.needsYou.length})</h3>
          {preview.needsYou.map((item) => {
            const fallback = item.best?.trackGuid ?? item.candidates[0]?.trackGuid ?? '';
            const selected = picked[item.chapterId] ?? fallback;
            return (
              <div key={item.chapterId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--accent)] p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.chapterTitle}</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {chapterSyncPanelReasonText(item)}
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
      {(notChapters || activity.length > 0) && (
        <div className="mt-3 grid gap-4 border-t border-[var(--border)] pt-3 text-sm sm:grid-cols-2">
          {notChapters && (
            <div className="min-w-0">
              <h3 className="section-label mb-1">Tracks that are not chapters ({notChaptersCount})</h3>
              <p className="[overflow-wrap:anywhere]">{notChapters}</p>
            </div>
          )}
          {activity.length > 0 && (
            <div className="min-w-0">
              <h3 className="section-label mb-1">Sync activity</h3>
              <ul className="space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                {activity.map((row) => (
                  <li key={row.key} className="[overflow-wrap:anywhere]">
                    {chapterSyncTimeLabel(row.at)} · {row.text}
                    {row.undoTrackGuid && stillAuto(row.undoTrackGuid) && (
                      <>
                        {' ('}
                        <button
                          type="button"
                          className="underline disabled:opacity-60"
                          style={{ color: 'var(--text)' }}
                          disabled={undoingTrackGuid === row.undoTrackGuid}
                          aria-label={`Undo: ${row.text}`}
                          onClick={() => void undo(row.undoTrackGuid)}
                        >
                          Undo
                        </button>
                        {')'}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
