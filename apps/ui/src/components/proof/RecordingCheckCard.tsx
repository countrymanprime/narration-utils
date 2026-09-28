import type { ManuscriptChapter } from '../../types';
import type { WorkspaceAlignmentResult } from '../../api/contracts/workspace';
import { formatAudioTime, formatWhen, plural } from '../production/recordingCheckText';
import { Panel } from '../primitives/Panel';
import { SectionLabel } from '../primitives/SectionLabel';
import type { Flag } from './flags';

/** "2 regions not read, 3 misreads, 1 read short." from the check's own flags; only the kinds it found are named. */
export function checkSentence(flags: readonly Flag[]): string {
  const count = (...kinds: Flag['kind'][]) => flags.filter((flag) => kinds.includes(flag.kind)).length;
  const parts = [
    [count('skip', 'not_recorded'), 'region not read', 'regions not read'],
    [count('misread'), 'misread', 'misreads'],
    [count('partial'), 'read short', 'read short'],
    [count('extra'), 'extra passage', 'extra passages'],
  ] as const;
  const named = parts.filter(([n]) => n > 0).map(([n, one, many]) => plural(n, one, many));
  return named.length === 0 ? 'Nothing flagged.' : `${named.join(', ')}.`;
}

/**
 * The recording-check card on Proof's chapter view (D85 #11, edit-and-proof mock 01 "Recording check": RECORDED 97%,
 * LENGTH 11:48, "2 regions not read, 3 misreads, 2 repeats. Current for the project saved at 10:02."). The figures are
 * the chapter's own: its recorded share of the words (the check's `recordedFraction`) and its recorded length (the linked
 * track's audio). A figure the host has no value for is left out rather than shown empty.
 */
export function RecordingCheckCard({
  chapter,
  alignment,
  flags,
}: {
  chapter: ManuscriptChapter;
  alignment: WorkspaceAlignmentResult | undefined;
  flags: readonly Flag[];
}) {
  if (!alignment) return null;
  const figures = [
    ...(alignment.state === 'current' && chapter.recordedFraction !== undefined
      ? [{ label: 'Recorded', value: `${Math.round(chapter.recordedFraction * 100)}%` }]
      : []),
    ...(chapter.recordedSeconds !== undefined ? [{ label: 'Length', value: formatAudioTime(chapter.recordedSeconds) }] : []),
  ];
  const saved = alignment.basis ? formatWhen(alignment.basis.modifiedAt) : undefined;
  const standing =
    alignment.state === 'never'
      ? 'Not checked yet. Run Check recording to see how much of the script is recorded.'
      : alignment.state === 'stale'
        ? `The project changed since this check${saved ? ` (saved ${saved})` : ''}. Check again to bring it up to date.`
        : `Current for the project saved ${saved ?? 'last'}.`;

  return (
    <Panel title="Recording check">
      {figures.length > 0 && (
        <dl className="grid grid-cols-2 gap-3">
          {figures.map((figure) => (
            <div key={figure.label}>
              <dt>
                <SectionLabel>{figure.label}</SectionLabel>
              </dt>
              <dd className="font-['Barlow_Condensed',sans-serif] text-2xl font-semibold">{figure.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className={`${figures.length > 0 ? 'mt-3' : ''} text-sm`} style={{ color: 'var(--text-muted)' }}>
        {alignment.state === 'never' ? standing : `${checkSentence(flags)} ${standing}`}
      </p>
    </Panel>
  );
}
