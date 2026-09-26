// A narration chapter's recording-check status without a click (daw-chapter-track-auto-sync.prd.md Phase 6, S14):
// Home's row reads this instead of pressing Check. It leads with the track link's own trouble when there is one (a
// chapter with no confident, confirmed track has nothing for a check's freshness to mean yet), and only once the
// chapter is linked does it show the check's own freshness (current / stale, with why / never), from
// `ChapterSyncState.chapters[]` (already computed on the host, ADR 0209-0211; reading it never starts a check).
import type { ChapterSyncChapter, ChapterTrackLink } from '../../types';
import { chapterTrackButtonState } from './chapterTrackButtonState';

export type ChapterCheckStatus =
  | { kind: 'checking'; percent?: number }
  | { kind: 'current'; checkedAt: string }
  | { kind: 'stale'; reason: string; changedAt: string | null }
  | { kind: 'never'; changedAt: string | null }
  | { kind: 'needs_track'; count: number }
  | { kind: 'suggested'; trackName: string }
  | { kind: 'missing' }
  | { kind: 'not_linked' };

/**
 * `link` is this chapter's row from `ChapterTrackLinks` (undefined while that read is still in flight, or the
 * project is not `ready`); `sync` is its row from `ChapterSyncState.chapters` (undefined before the first sync, or
 * for a project with no chapter-sync data yet); `checking` covers both a check this page started and one the
 * background scheduler started (Phase 7, `sync.checking`) or is already running when the page opens (`coverage`).
 */
export function chapterCheckStatus(
  link: ChapterTrackLink | undefined,
  sync: ChapterSyncChapter | undefined,
  checking: boolean,
  percent?: number,
): ChapterCheckStatus {
  if (checking) return { kind: 'checking', percent };
  if (!link) return { kind: 'not_linked' };
  const button = chapterTrackButtonState(link);
  switch (button.kind) {
    case 'missing':
      return { kind: 'missing' };
    case 'ambiguous':
      return { kind: 'needs_track', count: button.count };
    case 'suggested':
      return { kind: 'suggested', trackName: button.trackName };
    case 'not_linked':
      return { kind: 'not_linked' };
    case 'linked':
    case 'renamed':
      // A confirmed track: the check's own freshness is what the row shows now.
      if (!sync || sync.freshness === 'never') return { kind: 'never', changedAt: sync?.lastChanged ?? null };
      if (sync.freshness === 'stale') return { kind: 'stale', reason: sync.reasons[0] ?? '', changedAt: sync.lastChanged };
      return { kind: 'current', checkedAt: sync.checkedAt ?? '' };
  }
}

const SHORT_REASON: Record<string, string> = {
  item_added: 'item added',
  item_removed: 'item removed',
  item_trimmed: 'item trimmed',
  item_moved: 'item moved',
  item_muted: 'item muted or unmuted',
  take_switched: 'take switched',
  source_changed: 'audio changed',
  mapping_changed: 'track changed',
  mapped_track_missing: 'track missing',
  analyzer_changed: 'check updated',
  params_changed: 'settings changed',
  project_unreadable: 'project unreadable',
};

/** The reason word for the row's second line ("item added", "take switched"); an unrecognised code is humanised. */
export function shortReasonText(reason: string): string {
  return SHORT_REASON[reason] ?? reason.replace(/_/g, ' ');
}

/** "just now", "5 min ago", "2h ago", "yesterday", "3 days ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffMs = Math.max(0, now - then);
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(diffMs / 86_400_000);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The row's bold label and its small muted line under it (04-row-check-status-replaces-check.webp), and the
 * accessible name that reads both, since colour is never the only signal (WCAG 1.4.1). */
export function chapterCheckStatusText(chapterTitle: string, status: ChapterCheckStatus, now?: number): { label: string; detail?: string; name: string } {
  switch (status.kind) {
    case 'checking': {
      const label = status.percent !== undefined ? `Checking ${Math.floor(status.percent)}%` : 'Checking';
      return { label, name: `${label}, recording of ${chapterTitle}` };
    }
    case 'current': {
      const detail = `checked ${relativeTime(status.checkedAt, now)}`;
      return { label: 'Current', detail, name: `Recording check for ${chapterTitle}: current, ${detail}` };
    }
    case 'stale': {
      const parts = [status.reason && shortReasonText(status.reason), status.changedAt && relativeTime(status.changedAt, now)].filter(Boolean);
      const detail = parts.join(' · ') || undefined;
      return { label: 'Out of date', detail, name: `Recording check for ${chapterTitle}: out of date${detail ? `, ${detail}` : ''}` };
    }
    case 'never': {
      const detail = status.changedAt ? `changed ${relativeTime(status.changedAt, now)}` : undefined;
      return { label: 'Never checked', detail, name: `Recording check for ${chapterTitle}: never checked${detail ? `, ${detail}` : ''}` };
    }
    case 'needs_track': {
      const detail = `${status.count} possible tracks`;
      return { label: 'Needs a track', detail, name: `Recording check for ${chapterTitle}: needs a track, ${detail}` };
    }
    case 'suggested': {
      const detail = `confirm “${status.trackName}”`;
      return { label: 'Suggested track', detail, name: `Recording check for ${chapterTitle}: suggested track, ${detail}` };
    }
    case 'missing':
      return { label: 'Track missing', detail: 'not in the saved project', name: `Recording check for ${chapterTitle}: linked track is missing` };
    case 'not_linked':
      return { label: 'No track yet', name: `Recording check for ${chapterTitle}: no track linked yet` };
  }
}
