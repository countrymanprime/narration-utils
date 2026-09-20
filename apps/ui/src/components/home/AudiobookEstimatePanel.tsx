import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import type { ChapterStatus, ManuscriptChapter } from '../../types';
import { estimateFinishedHours } from '../../state';
import { useApi } from '../../api/ApiContext';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../primitives/Collapsible';
import { MeterBar } from '../primitives/MeterBar';
import { Panel } from '../primitives/Panel';
import { STATUS_COLOR, STATUS_LABELS, STATUS_ORDER } from '../manuscript/ChapterNav';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';

const fmtHours = (hours: number) => {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return whole > 0 ? `${whole}h ${minutes}m` : `${minutes}m`;
};

const RECORDED_FRACTION: Record<ChapterStatus, number> = { not_started: 0, recording: 0.5, editing: 1, proofing: 1, finalized: 1 };

export type StatusTotal = { count: number; hours: number; words: number };

// Keep the progress bar's domain model independent from its rendering.  This
// prevents a row-level status change from creating duplicate visual segments.
export function rollupChapterStatuses(chapters: ManuscriptChapter[]): Record<ChapterStatus, StatusTotal> {
  const empty = Object.fromEntries(STATUS_ORDER.map((status) => [status, { count: 0, hours: 0, words: 0 }])) as Record<ChapterStatus, StatusTotal>;
  return chapters.reduce((totals, chapter) => {
    const total = totals[chapter.status];
    total.count += 1;
    total.words += chapter.wordCount;
    total.hours += estimateFinishedHours(chapter.wordCount);
    return totals;
  }, empty);
}

export function AudiobookEstimatePanel({
  notify,
  goToManuscript,
  refreshKey,
}: {
  notify: (text: string) => void;
  goToManuscript: (chapter: string) => void;
  // The owning Home page changes this after a manuscript import/replacement.
  // Chapter estimates are derived from a separate request, so they cannot
  // rely on the Bootstrap payload alone to invalidate their cached rows.
  refreshKey?: string;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setChapters(await api.manuscriptChapters());
      } catch {
        setChapters([]);
      }
    })();
  }, [api, refreshKey]);

  if (!chapters) return null;
  const narrationChapters = chapters.filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration');
  if (narrationChapters.length === 0)
    return <Panel>No narratable manuscript chapters found yet. Select a manuscript from Home to see an audiobook estimate.</Panel>;

  const totalWords = narrationChapters.reduce((sum, c) => sum + c.wordCount, 0);
  const finishedHours = estimateFinishedHours(totalWords);
  const recordedHours = narrationChapters.reduce((sum, c) => sum + estimateFinishedHours(c.wordCount) * (c.recordedFraction ?? RECORDED_FRACTION[c.status]), 0);
  const stats = [
    { label: 'Est. finished audio', value: fmtHours(finishedHours) },
    { label: 'Actual recorded', value: fmtHours(recordedHours) },
    { label: 'Est. record time', value: fmtHours(finishedHours * 3) },
    { label: 'Est. edit time', value: fmtHours(finishedHours * 2) },
    { label: 'Est. proof time', value: fmtHours(finishedHours * 1) },
  ];
  const finalizedCount = narrationChapters.filter((c) => c.status === 'finalized').length;
  const statusTotals = rollupChapterStatuses(narrationChapters);

  return (
    <Collapsible
      open={breakdownOpen}
      onOpenChange={setBreakdownOpen}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
        <div>
          <h2 className="text-sm font-semibold">Audiobook estimate</h2>
          <div className="mt-0.5 flex items-center text-xs" style={{ color: 'var(--text-faint)' }}>
            {totalWords.toLocaleString()} words · {narrationChapters.length} chapters · ~150 words/min narrated{' '}
            <Tooltip text="Fixed industry rule of thumb (~9,300 words per finished hour). Record, edit, and proof use standard multipliers of that finished length." />
          </div>
        </div>
        <TooltipTarget text={breakdownOpen ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}>
          <CollapsibleTrigger
            label={breakdownOpen ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}
            className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <FontAwesomeIcon icon={breakdownOpen ? faChevronUp : faChevronDown} />
          </CollapsibleTrigger>
        </TooltipTarget>
      </div>
      <div className="space-y-4 p-[1.1rem]">
        <div className="grid grid-cols-5 gap-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
                {stat.label}
              </div>
              <div className="mt-1 font-['IBM_Plex_Mono',ui-monospace,monospace] text-2xl font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
              Recording progress
            </span>
            <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]" style={{ color: 'var(--text-muted)' }}>
              {finalizedCount} of {narrationChapters.length} chapters finalized
            </span>
          </div>
          <MeterBar
            label="Recording progress"
            segments={[...STATUS_ORDER]
              .reverse()
              .filter((status) => statusTotals[status].count > 0)
              .map((status) => ({
                key: status,
                widthPercent: (statusTotals[status].words / totalWords) * 100,
                color: STATUS_COLOR[status],
                tooltip: `${STATUS_LABELS[status]}: ${statusTotals[status].count} chapter${statusTotals[status].count === 1 ? '' : 's'} · ~${fmtHours(statusTotals[status].hours)} finished audio`,
              }))}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {STATUS_ORDER.map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[status] }} />
                {STATUS_LABELS[status]}
              </span>
            ))}
          </div>
        </div>
        <CollapsiblePanel className="overflow-x-auto border-t border-[var(--border)] pt-1">
          <table className="dtable">
            <thead>
              <tr>
                <th>Chapter</th>
                <th className="text-right">Words</th>
                <th className="text-right">Est. finished length</th>
                <th className="text-right">Actual recorded</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {narrationChapters.map((chapter) => {
                const finished = estimateFinishedHours(chapter.wordCount);
                return (
                  <tr key={chapter.id}>
                    <td>
                      <div>
                        <Link
                          className="font-medium hover:underline"
                          to={`/manuscript#c${encodeURIComponent(chapter.id)}`}
                          aria-label={chapter.subtitle ? `${chapter.title} — ${chapter.subtitle}` : chapter.title}
                          onClick={(event) => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            goToManuscript(chapter.id);
                          }}
                        >
                          {chapter.title}
                          {chapter.subtitle && (
                            <span style={{ color: 'var(--text-faint)' }}>
                              {' — '}
                              {chapter.subtitle}
                            </span>
                          )}
                        </Link>
                      </div>
                    </td>
                    <td className="text-right font-['IBM_Plex_Mono',ui-monospace,monospace]">{chapter.wordCount.toLocaleString()}</td>
                    <td className="text-right font-['IBM_Plex_Mono',ui-monospace,monospace]">{fmtHours(finished)}</td>
                    <td className="text-right font-['IBM_Plex_Mono',ui-monospace,monospace]">
                      {(chapter.recordedFraction ?? RECORDED_FRACTION[chapter.status]) > 0
                        ? fmtHours(finished * (chapter.recordedFraction ?? RECORDED_FRACTION[chapter.status]))
                        : '—'}
                    </td>
                    <td>
                      <select
                        aria-label={`${chapter.title} status`}
                        value={chapter.status}
                        onChange={async (event) => {
                          try {
                            const updated = await api.manuscriptSetChapterStatus(chapter.id, event.target.value as ChapterStatus);
                            setChapters((current) =>
                              current?.map((c) =>
                                c.id === chapter.id
                                  ? { ...c, ...updated, wordCount: c.wordCount, subtitle: c.subtitle, recordedFraction: c.recordedFraction }
                                  : c,
                              ),
                            );
                          } catch (error) {
                            notify(String(error));
                          }
                        }}
                      >
                        {STATUS_ORDER.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}
