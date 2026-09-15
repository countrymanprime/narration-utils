import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import type { ChapterStatus, ManuscriptChapter } from '../../types';
import { estimateFinishedHours } from '../../state';
import { useApi } from '../../api/ApiContext';
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
}: {
  notify: (text: string) => void;
  goToManuscript: (chapter: string) => void;
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
  }, []);

  if (!chapters) return null;
  if (chapters.length === 0) return <Panel>No manuscript chapters found yet. Select a manuscript from Home to see an audiobook estimate.</Panel>;

  const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const finishedHours = estimateFinishedHours(totalWords);
  const recordedHours = chapters.reduce((sum, c) => sum + estimateFinishedHours(c.wordCount) * (c.recordedFraction ?? RECORDED_FRACTION[c.status]), 0);
  const stats = [
    { label: 'Est. finished audio', value: fmtHours(finishedHours) },
    { label: 'Actual recorded', value: fmtHours(recordedHours) },
    { label: 'Est. record time', value: fmtHours(finishedHours * 3) },
    { label: 'Est. edit time', value: fmtHours(finishedHours * 2) },
    { label: 'Est. proof time', value: fmtHours(finishedHours * 1) },
  ];
  const finalizedCount = chapters.filter((c) => c.status === 'finalized').length;
  const statusTotals = rollupChapterStatuses(chapters);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="text-sm font-semibold">Audiobook estimate</h2>
          <div className="mt-0.5 flex items-center text-xs" style={{ color: 'var(--text-faint)' }}>
            {totalWords.toLocaleString()} words · {chapters.length} chapters · ~150 words/min narrated{' '}
            <Tooltip text="Fixed industry rule of thumb (~9,300 words per finished hour). Record, edit, and proof use standard multipliers of that finished length." />
          </div>
        </div>
        <button className="btn btn-ghost text-xs" onClick={() => setBreakdownOpen((value) => !value)}>
          {breakdownOpen ? 'Hide' : 'Show'} per-chapter breakdown
        </button>
      </div>
      <div className="panel-body space-y-4">
        <div className="grid grid-cols-5 gap-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="section-label">{stat.label}</div>
              <div className="f-mono mt-1 text-2xl font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="section-label">Recording progress</span>
            <span className="f-mono" style={{ color: 'var(--text-muted)' }}>
              {finalizedCount} of {chapters.length} chapters finalized
            </span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
            {STATUS_ORDER.filter((status) => statusTotals[status].count > 0).map((status) => (
              <TooltipTarget
                key={status}
                className="progress-segment"
                style={{ flexBasis: `${((statusTotals[status].words / totalWords) * 100).toFixed(1)}%` }}
                text={`${STATUS_LABELS[status]}: ${statusTotals[status].count} chapter${statusTotals[status].count === 1 ? '' : 's'} · ~${fmtHours(statusTotals[status].hours)} finished audio`}
              >
                <span style={{ background: STATUS_COLOR[status] }} />
              </TooltipTarget>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {STATUS_ORDER.map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[status] }} />
                {STATUS_LABELS[status]}
              </span>
            ))}
          </div>
        </div>
        {breakdownOpen && (
          <div className="overflow-x-auto border-t pt-1" style={{ borderColor: 'var(--border)' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>Words</th>
                  <th>Est. finished length</th>
                  <th>Actual recorded</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((chapter) => {
                  const finished = estimateFinishedHours(chapter.wordCount);
                  return (
                    <tr key={chapter.id}>
                      <td>
                        <div className="flex items-center gap-1">
                          <TooltipTarget text="Jump to chapter in Manuscript">
                            <button aria-label={`Jump to ${chapter.title} in manuscript`} className="icon-btn" onClick={() => goToManuscript(chapter.id)}>
                              <FontAwesomeIcon icon={faFileLines} />
                            </button>
                          </TooltipTarget>
                          <span>
                            {chapter.title}
                            {chapter.subtitle && <span style={{ color: 'var(--text-faint)' }}> — {chapter.subtitle}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="f-mono">{chapter.wordCount.toLocaleString()}</td>
                      <td className="f-mono">{fmtHours(finished)}</td>
                      <td className="f-mono">
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
          </div>
        )}
      </div>
    </section>
  );
}
