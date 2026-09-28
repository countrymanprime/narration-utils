import type { ChapterSyncBatch, ChapterSyncChapter, ChapterSyncNeedsYou, ChapterSyncPickupTrack, ChapterSyncTrackRef } from '../../api/contracts/chapterSync';

/**
 * Why a chapter is in Needs you, as the consent dialog says it (daw-chapter-track-auto-sync.prd.md Phase 3, mockup 01). The
 * engine panel's list says two of them its own way (mockup 02, `chapterSyncPanelReasonText`): D85 #13, the mocks win.
 */
export function chapterSyncReasonText(item: ChapterSyncNeedsYou): string {
  switch (item.reason) {
    case 'ambiguous': {
      const names = item.candidates.map((candidate) => `“${candidate.trackName}”`);
      if (names.length === 0) return 'More than one track looks like it.';
      if (names.length === 1) return `${names[0]} looks like it.`;
      return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} both look like it.`;
    }
    case 'uncertain':
      return item.best ? `“${item.best.trackName}” is close, but not a confident match.` : 'No track is a confident match.';
    case 'region':
      return 'Only a project region names this chapter, not a track.';
    case 'rejected':
      return 'You unlinked this chapter before; sync will not relink it on its own.';
    case 'not-mutual':
      return item.best ? `“${item.best.trackName}” matches another chapter better.` : 'Its closest track matches another chapter better.';
  }
}

/** "Tracks that are not chapters" (mockup 02): unmatched track names plus any pickup tracks, with a note singling
 * the pickup tracks out (they are kept for take review, never a chapter link). */
export function chapterSyncNotChaptersText(unmatched: ChapterSyncTrackRef[], pickupTracks: ChapterSyncPickupTrack[]): { names: string; note: string } {
  const names = [...unmatched.map((track) => track.name), ...pickupTracks.map((pickup) => pickup.trackName)];
  if (names.length === 0) return { names: 'None.', note: '' };
  const subject = pickupTracks.length === 1 ? 'The last one is' : `The last ${pickupTracks.length} are`;
  const object = pickupTracks.length === 1 ? `${pickupTracks[0].chapterTitle}'s pickup track` : 'their chapters’ pickup tracks';
  const note = pickupTracks.length > 0 ? `${subject} kept as ${object}.` : '';
  return { names: names.join(', '), note };
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function quotedList(names: string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  return quoted.length < 2 ? (quoted[0] ?? '') : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Why a chapter is in the engine panel's Needs you (mockup 02): a tie and a guess in the mock's words, the rest as the dialog says them. */
export function chapterSyncPanelReasonText(item: ChapterSyncNeedsYou): string {
  if (item.reason === 'ambiguous' && item.candidates.length >= 2) {
    const count = COUNT_WORDS[item.candidates.length] ?? String(item.candidates.length);
    return `${count} tracks match: ${quotedList(item.candidates.map((candidate) => candidate.trackName))}. A chapter is checked from one track.`;
  }
  if (item.reason === 'uncertain' && item.best) return `Closest track “${item.best.trackName}” is not a confident match, so it was not linked on its own.`;
  return chapterSyncReasonText(item);
}

/** The engine panel's "Tracks that are not chapters" line (mockup 02): "Room tone · Pickups · Chapter 3 (pickups), kept as Chapter 3’s pickup track". */
export function chapterSyncPanelNotChaptersText(unmatched: ChapterSyncTrackRef[], pickupTracks: ChapterSyncPickupTrack[]): string {
  const names = [...unmatched.map((track) => track.name), ...pickupTracks.map((pickup) => pickup.trackName)].join(' · ');
  if (pickupTracks.length === 0) return names;
  return `${names}, kept as ${pickupTracks.length === 1 ? `${pickupTracks[0].chapterTitle}’s pickup track` : 'their chapters’ pickup tracks'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a sync ran, as mockup 02 dates its Sync activity: "10:42" today, "Yesterday", then "22 Sep" (with the year when it is not this one). */
export function chapterSyncTimeLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  if (days === 1) return 'Yesterday';
  const dayMonth = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? dayMonth : `${dayMonth} ${at.getFullYear()}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const chapters = (count: number) => `${count} chapter${count === 1 ? '' : 's'}`;

/**
 * Chapter sync's "on" line (mockup 02): "On · last synced 10:42 from the saved Alice.rpp · 8 chapters linked automatically, 1 by
 * you". The split comes from the host's per-chapter rows (`origin`); before it has them (the saved .rpp unreadable) the plain
 * count of links stands in.
 */
export function chapterSyncSummaryText(
  state: { lastSync: string | null; projectFile: string; chapters: Pick<ChapterSyncChapter, 'origin'>[]; linked: number },
  now: Date = new Date(),
): string {
  const synced = state.lastSync ? `last synced ${chapterSyncTimeLabel(state.lastSync, now) || 'at an unknown time'}` : 'not synced yet';
  const file = state.lastSync && state.projectFile ? ` from the saved ${basename(state.projectFile)}` : '';
  let links: string;
  if (state.chapters.length === 0) {
    links = `${chapters(state.linked)} linked`;
  } else {
    const auto = state.chapters.filter((chapter) => chapter.origin === 'auto').length;
    const manual = state.chapters.filter((chapter) => chapter.origin === 'manual').length;
    if (auto > 0) links = `${chapters(auto)} linked automatically${manual > 0 ? `, ${manual} by you` : ''}`;
    else if (manual > 0) links = `${chapters(manual)} linked by you`;
    else links = 'no chapters linked';
  }
  return `On · ${synced}${file} · ${links}`;
}

/** One line of the Sync activity list. `undoTrackGuid` is the automatic link Undo would remove ('' for a line with no Undo). */
export type ChapterSyncActivityRow = { key: string; at: string; text: string; undoTrackGuid: string };

/**
 * The Sync activity list (daw-chapter-track-auto-sync.prd.md Phase 4, mockup 02), newest first as the host keeps it: the first
 * sync as one line ("First sync: 8 chapters linked"), then a line per link a later sync made ("Linked “Ch. 11” to Chapter 11",
 * with Undo) and per new track that is not a chapter. A batch with neither (an Undo's own sync) adds no line.
 */
export function chapterSyncActivityRows(activity: ChapterSyncBatch[], trackName: (guid: string) => string): ChapterSyncActivityRow[] {
  return activity.flatMap((batch, index) => {
    if (batch.trigger === 'consent') {
      return batch.linked.length > 0
        ? [{ key: `${index}:first`, at: batch.at, text: `First sync: ${chapters(batch.linked.length)} linked`, undoTrackGuid: '' }]
        : [];
    }
    const linked = batch.linked.map((link) => {
      const name = trackName(link.trackGuid);
      return {
        key: `${index}:link:${link.trackGuid}`,
        at: batch.at,
        text: name ? `Linked “${name}” to ${link.chapterTitle}` : `Linked a track to ${link.chapterTitle}`,
        undoTrackGuid: link.origin === 'auto' ? link.trackGuid : '',
      };
    });
    const added = batch.newTracks.map((track) => ({
      key: `${index}:new:${track.guid}`,
      at: batch.at,
      text: `New track “${track.name}”, not a chapter`,
      undoTrackGuid: '',
    }));
    return [...linked, ...added];
  });
}
