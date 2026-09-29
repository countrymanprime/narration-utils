import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { ProductionChapter } from '../../api/contracts/production';
import { STATUS_LABELS, STATUS_TONE } from '../../chapterStatus';
import { Dot, toneColors } from '../primitives/StatusBadge';
import { clockText } from './boothProgress';

/**
 * The companion's "This chapter" (mock 07: "Recorded 12:40 · check 97% coverage", "QC: not mastered · head room tone 0.3 s"):
 * what the Production board already knows about the chapter - its measured recorded length and its stage with the reason that
 * holds it back - read once, never recomputed. The mock's check-coverage figure needs the closed-loop proofing session's own
 * numbers, which the app does not have yet, so it is not drawn; a chapter with nothing measured says so.
 */
export function CompanionThisChapter({ chapterId }: { chapterId?: string }) {
  const api = useApi();
  const [state, setState] = useState<{ loaded: boolean; chapter?: ProductionChapter }>({ loaded: false });
  useEffect(() => {
    let live = true;
    void api
      .productionOverview()
      .then((overview) => live && setState({ loaded: true, chapter: overview.chapters.find((item) => item.id === chapterId) }))
      .catch(() => live && setState({ loaded: true }));
    return () => {
      live = false;
    };
  }, [api, chapterId]);

  if (!state.loaded) return null;
  const { chapter } = state;
  if (!chapter) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Nothing measured for this chapter yet.
      </p>
    );
  }
  const stageTone = toneColors(STATUS_TONE[chapter.status]).text;
  const reason = chapter.readiness?.reason;
  return (
    <ul className="space-y-1.5 text-sm">
      <li className="flex items-center gap-2">
        <Dot color={chapter.recordedSeconds === null ? toneColors('neutral').text : 'var(--ok)'} />
        {chapter.recordedSeconds === null ? 'Recorded length not measured' : `Recorded ${clockText(chapter.recordedSeconds)}`}
      </li>
      <li className="flex items-center gap-2">
        <Dot color={stageTone} />
        <span>
          {STATUS_LABELS[chapter.status]}
          {reason ? ` · ${reason}` : ''}
        </span>
      </li>
    </ul>
  );
}
