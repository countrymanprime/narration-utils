import type { PlaylistSegment } from './playlist';
import type { WorkspaceItem, WorkspacePeaksEntry, WorkspacePeaksResult, WorkspaceToken } from '../../api/contracts/workspace';
import type { Flag, FlagKind } from './flags';
import type { TimelineMarker } from '../primitives/Timeline';

/** One playlist segment's place on the waveform strip (edit-and-proof-workspace.prd.md Phase 5): start and end are
 * seconds on the app's own elapsed timeline (playlist.ts), the same coordinate space `Timeline`'s `duration` and
 * `playhead` use, so the segment lines up with the transport's elapsed readout without any further conversion. */
export type WaveformSegment = {
  itemGuid: string;
  start: number;
  end: number;
  label: string;
  /** This item's peaks, or why it has none (WorkspacePeaksItem, bindings_workspace_peaks.go) - undefined only when
   * the strip's WorkspacePeaks answer has not loaded yet, or never named this item at all. */
  entry?: WorkspacePeaksEntry;
};

/** Lays the playlist's segments out along the strip, joining each to its WorkspacePeaks entry by item index -
 * WorkspacePeaksEntry.index and WorkspaceItem.index both name the chapter's stored alignment's own AlignmentItem,
 * so a segment's itemGuid resolves to that index and then to its peaks. A segment with no live alignment item, or
 * whose entry carries a Reason instead of Peaks, still gets a slot: the strip draws a flat "no waveform" line for
 * it rather than a gap that could read as still loading. */
export function buildWaveformSegments(
  playlist: readonly PlaylistSegment[],
  alignmentItems: readonly WorkspaceItem[],
  peaks: WorkspacePeaksResult | undefined,
): WaveformSegment[] {
  const entryByIndex = new Map((peaks?.items ?? []).map((entry) => [entry.index, entry] as const));
  const indexByGuid = new Map(alignmentItems.map((item) => [item.itemGuid, item.index] as const));
  return playlist.map((segment, position) => {
    const itemIndex = indexByGuid.get(segment.itemGuid);
    return {
      itemGuid: segment.itemGuid,
      start: segment.elapsedStart,
      end: segment.elapsedEnd,
      label: `Item ${position + 1}`,
      entry: itemIndex === undefined ? undefined : entryByIndex.get(itemIndex),
    };
  });
}

/** A flag kind's marker tone on the strip, sharing Timeline's own tone fills (NotesStrip.tsx's CATEGORY_TONE does
 * the same for a Finding's category): skip and pickup read as the strongest signals (a gap, or a proofer's own
 * note), misread and extra as informational, cleanup as resolved-sounding, the rest neutral. */
export const FLAG_MARKER_TONE: Record<FlagKind, TimelineMarker['tone']> = {
  skip: 'danger',
  not_recorded: 'danger',
  partial: 'warning',
  pickup: 'warning',
  misread: 'info',
  extra: 'info',
  cleanup: 'success',
};

/** Turns flags.ts's own labels and tones into the strip's TimelineMarkers, placed at each flag's seek target's
 * elapsed time (joining the token's item to the playlist segment that plays it, the same item-to-elapsed-time step
 * useChapterPlayback's own seek does). A flag with no seek target (a pure skip run has no audio position of its
 * own) is left off - there is nothing on the strip to place it at. */
export function buildFlagMarkers(
  flags: readonly Flag[],
  tokens: readonly WorkspaceToken[],
  alignmentItems: readonly WorkspaceItem[],
  playlist: readonly PlaylistSegment[],
): TimelineMarker[] {
  const itemByIndex = new Map(alignmentItems.map((item) => [item.index, item] as const));
  const segmentByGuid = new Map(playlist.map((segment) => [segment.itemGuid, segment] as const));
  const markers: TimelineMarker[] = [];
  for (const flag of flags) {
    if (flag.seekTokenIndex === undefined) continue;
    const token = tokens[flag.seekTokenIndex];
    if (!token || token.item === undefined || token.start === undefined) continue;
    const item = itemByIndex.get(token.item);
    const segment = item && segmentByGuid.get(item.itemGuid);
    if (!segment) continue;
    markers.push({ id: flag.id, at: segment.elapsedStart + (token.start - segment.sourceStart), tone: FLAG_MARKER_TONE[flag.kind], label: flag.label });
  }
  return markers;
}
