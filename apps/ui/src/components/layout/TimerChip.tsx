import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStopwatch } from '@fortawesome/free-solid-svg-icons';
import type { ProductionOverview } from '../../api/contracts/production';
import type { ChapterStatus } from '../../api/contracts/manuscript';
import { STATUS_LABELS } from '../../chapterStatus';
import { HeaderChip } from '../primitives/HeaderChip';

/** The production stage timer that is running, as the header shows it: when it started, and on which chapter and stage. */
export type RunningTimer = { startedAt: string; chapterTitle: string; stage: ChapterStatus };

/** The running timer in a production overview, or null when none runs. */
export function runningTimerOf(overview: ProductionOverview): RunningTimer | null {
  const { running } = overview;
  if (!running) return null;
  const chapter = overview.chapters.find((candidate) => candidate.id === running.chapterId);
  return { startedAt: running.startedAt, chapterTitle: chapter?.title ?? running.chapterId, stage: running.stage };
}

/** Whole seconds since `startedAt` as h:mm:ss; never negative (a clock a little behind the host's reads 0:00:00). */
export function elapsedClock(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/**
 * The header's running-timer chip (stage-navigation-and-page-replacement.prd.md Phase 2, "The header" item 4; mock 01's
 * "2:14:08 today · timer on Ch 7"): how long the production stage timer has run and on which chapter, on every page while it
 * runs, and nothing otherwise. The host logs the time (production tracking, ADR 0320); this only counts the seconds since the
 * session started so the narrator sees it move. A `timer` role is not a live region, so the ticking is never announced.
 */
export function TimerChip({ timer }: { timer: RunningTimer }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const clock = elapsedClock(timer.startedAt, now);
  return (
    <HeaderChip role="timer" aria-label={`Timer running on ${timer.chapterTitle}, ${STATUS_LABELS[timer.stage]}: ${clock}`} className="min-w-0">
      <FontAwesomeIcon icon={faStopwatch} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
      {/* The digits in Plex Mono 13 px 500, as mock 01 sets them beside the Barlow text. */}
      <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem] font-medium tracking-normal">{clock}</span>
      {/* Below `md` the chip keeps its clock; the chapter stays in the accessible name above. */}
      <span className="truncate max-md:hidden">· timer on {timer.chapterTitle}</span>
    </HeaderChip>
  );
}
