import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import type { ManuscriptContentKind } from '../../api/contracts/manuscript';
import type { ChapterTrackLink, ChapterTrackSummary, Track } from '../../types';
import { formatAudioTime, formatWhen } from './recordingCheckText';
import { MappingConfirm } from '../mapping/MappingConfirm';
import { Button } from '../primitives/Button';
import { SlideOver } from '../primitives/SlideOver';
import type { Notify } from '../primitives/Toast';
import { chapterTrackButtonState } from './chapterTrackButtonState';
import { RemoveFromRecordingDialog } from './RemoveFromRecordingDialog';

const EYEBROW = "font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase";

/**
 * The track slide-over a row's ChapterTrackButton opens (chapter-track-link-control.prd.md Phase 2): what the saved
 * project knows about the chapter's track as of its last save, and the narrator's link/relink/unlink actions. Reuses
 * MappingConfirm for the track picker, so Change/Clear behave the same way here as on the Tracks page - one host
 * operation (`chapterTrackSet`) makes a relink atomic (Phase 1), so a narrator can never end up with two links.
 * "Remove from recording" (Phase 3) opens from here too: the chapter's own reclassification, so it lives beside its
 * track controls rather than on the row itself.
 */
export function ChapterTrackPanel({
  open,
  chapterId,
  chapterTitle,
  link,
  trackSummary,
  savedAt,
  notify,
  onClose,
  onChanged,
  onRemoveFromRecording,
}: {
  open: boolean;
  chapterId: string;
  chapterTitle: string;
  /** undefined while the row's own ChapterTrackLinks read is still in flight. */
  link?: ChapterTrackLink;
  /** The linked or suggested track's own facts, resolved by the caller from ChapterTrackLinks' `tracks` list. */
  trackSummary?: ChapterTrackSummary;
  savedAt: string;
  notify: Notify;
  onClose: () => void;
  /** Re-reads ChapterTrackLinks after a link, relink or unlink. */
  onChanged: () => Promise<void>;
  /** Reclassifies the chapter (manuscriptSetChapterKind); the caller re-reads the chapter list and ChapterTrackLinks
   * and shows its own notify/error. Rejects on failure, which keeps the confirm open for a retry. */
  onRemoveFromRecording: (kind: ManuscriptContentKind) => Promise<void>;
}) {
  const api = useApi();
  const [tracks, setTracks] = useState<Track[]>();
  const [tracksError, setTracksError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .tracksList()
      .then((project) => active && setTracks(project.tracks))
      .catch((error) => active && setTracksError(describeApiError(error)));
    return () => {
      active = false;
    };
  }, [api, open]);

  const link_ = async (trackGuid: string) => {
    setBusy(true);
    try {
      const result = await api.chapterTrackSet(chapterId, trackGuid);
      if (result.displaced) notify(`Linked. This track was linked to ${result.displaced.chapterTitle}, which is now unlinked.`);
      else notify('Track linked.');
      await onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    setBusy(true);
    try {
      await api.chapterTrackUnlink(chapterId);
      notify('Track unlinked.');
      await onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (kind: ManuscriptContentKind) => {
    setBusy(true);
    try {
      await onRemoveFromRecording(kind);
      setRemoveOpen(false);
      onClose();
    } catch {
      // The caller already showed why (its own notify); leave the confirm open so the narrator can retry or cancel.
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOver open={open} title={`Track: ${chapterTitle}`} onClose={onClose}>
      {!link ? (
        <p role="status">Reading the saved project…</p>
      ) : (
        <div className="space-y-4 text-sm">
          <Header chapterTitle={chapterTitle} link={link} trackSummary={trackSummary} />
          {trackSummary && (
            <section aria-labelledby="chapter-track-facts" className="space-y-1.5">
              <h3 id="chapter-track-facts" className={EYEBROW}>
                As of last save {formatWhen(savedAt)}
              </h3>
              <Fact label="Items" value={`${trackSummary.playableCount} playable of ${trackSummary.itemCount}`} />
              {trackSummary.missingSourceCount > 0 && <Fact label="Missing sources" value={String(trackSummary.missingSourceCount)} />}
              {trackSummary.span && <Fact label="Span" value={`${formatAudioTime(trackSummary.span.start)} to ${formatAudioTime(trackSummary.span.end)}`} />}
              {link.track && (
                <Fact
                  label="Found through"
                  value={
                    link.track.source === 'confirmed'
                      ? 'Confirmed link'
                      : link.track.source === 'region-name'
                        ? `Region "${link.track.region?.name ?? ''}"`
                        : 'Track name'
                  }
                />
              )}
              {link.links[0] && <Fact label="Linked" value={formatWhen(link.links[0].confirmedAt)} />}
            </section>
          )}
          {link.status === 'ambiguous' && link.links.length > 1 && (
            <section aria-labelledby="chapter-track-conflict" className="space-y-2">
              <h3 id="chapter-track-conflict" className={EYEBROW}>
                Linked to {link.links.length} tracks
              </h3>
              <p style={{ color: 'var(--text-muted)' }}>Keep one link; the others will be cleared.</p>
              <ul className="space-y-2">
                {link.links.map((mapping) => {
                  const summary = tracks?.find((track) => track.guid === mapping.trackGuid);
                  return (
                    <li key={mapping.trackGuid} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                      <span>{summary?.name || 'Track'}</span>
                      <Button variant="ghost" disabled={busy} pending={busy} onClick={() => void link_(mapping.trackGuid)}>
                        Keep this one
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {link.status !== 'ambiguous' && link.candidates.length > 0 && !link.track && (
            <section aria-labelledby="chapter-track-candidates" className="space-y-2">
              <h3 id="chapter-track-candidates" className={EYEBROW}>
                Possible tracks
              </h3>
              <ul className="space-y-2">
                {link.candidates.map((candidate) => (
                  <li key={candidate.trackGuid} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2">
                    <span>
                      {candidate.trackName}
                      {candidate.region && <span style={{ color: 'var(--text-muted)' }}> · region "{candidate.region.name}"</span>}
                    </span>
                    <Button disabled={busy} pending={busy} onClick={() => void link_(candidate.trackGuid)}>
                      Link
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="chapter-track-link" className="space-y-2">
            <h3 id="chapter-track-link" className={EYEBROW}>
              Link
            </h3>
            {tracksError ? (
              <p style={{ color: 'var(--danger-text)' }}>The REAPER tracks could not be listed: {tracksError}</p>
            ) : !tracks ? (
              <p role="status">Reading the REAPER tracks…</p>
            ) : (
              <MappingConfirm
                chapterTitle={chapterTitle}
                tracks={tracks}
                linkedTrackGuid={link.track?.trackGuid}
                linkedTrackName={link.track?.trackName}
                busy={busy}
                onConfirm={(trackGuid) => void link_(trackGuid)}
                onClear={() => void unlink()}
              />
            )}
          </section>
          <section aria-labelledby="chapter-track-remove" className="space-y-2 border-t border-[var(--border)] pt-3">
            <h3 id="chapter-track-remove" className="sr-only">
              Chapter
            </h3>
            <Button variant="ghost" onClick={() => setRemoveOpen(true)}>
              Remove from recording…
            </Button>
          </section>
        </div>
      )}
      {removeOpen && (
        <RemoveFromRecordingDialog chapterTitle={chapterTitle} busy={busy} onConfirm={(kind) => void remove(kind)} onCancel={() => setRemoveOpen(false)} />
      )}
    </SlideOver>
  );
}

function Header({ chapterTitle, link, trackSummary }: { chapterTitle: string; link: ChapterTrackLink; trackSummary?: ChapterTrackSummary }) {
  const state = chapterTrackButtonState(link);
  const STATE_LABEL: Record<typeof state.kind, string> = {
    linked: 'Linked',
    renamed: 'Linked, renamed',
    suggested: 'Suggested',
    ambiguous: 'Ambiguous',
    missing: 'Track missing',
    not_linked: 'Not linked',
  };
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        {trackSummary && (
          <span aria-hidden="true" className="mt-1 size-3 flex-none rounded-full" style={{ background: trackSummary.color || 'var(--non-text)' }} />
        )}
        <div>
          <div className="font-['Barlow_Condensed',sans-serif] text-lg font-semibold uppercase">{link.track?.trackName ?? chapterTitle}</div>
          {trackSummary && <div style={{ color: 'var(--text-muted)' }}>Track {trackSummary.index + 1}</div>}
        </div>
      </div>
      <span className={EYEBROW}>{STATE_LABEL[state.kind]}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{value}</span>
    </div>
  );
}
