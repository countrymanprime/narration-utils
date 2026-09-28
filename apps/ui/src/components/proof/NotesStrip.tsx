import type { Finding, TrackItem } from '../../types';
import type { StatusTone } from '../primitives/StatusBadge';
import { Timeline, TimelineLane, type TimelineMarker } from '../primitives/Timeline';
import { CATEGORY_TONE } from './FindingsList';
import { evidenceKindLabel, findingSummary, formatTime } from './findingFormat';

// The legend's dot for each tone, the same fills Timeline's markers use.
const LEGEND_DOT: Record<StatusTone, string> = {
  neutral: 'bg-[var(--text-muted)]',
  info: 'bg-[var(--info)]',
  progress: 'bg-[var(--accent)]',
  success: 'bg-[var(--ok)]',
  warning: 'bg-[var(--warn)]',
  danger: 'bg-[var(--danger)]',
  experimental: 'bg-[var(--experimental)]',
};

// Timeline's markers take every tone but `progress`, which no note category uses.
const markerTone = (tone: StatusTone): TimelineMarker['tone'] => (tone === 'progress' ? 'info' : tone);

/** Where the chapter's recording starts and ends on the project timeline: its linked track's items, first to last. */
export function chapterSpan(items: readonly TrackItem[]): { start: number; end: number } | undefined {
  if (items.length === 0) return undefined;
  const start = Math.min(...items.map((item) => item.position));
  const end = Math.max(...items.map((item) => item.position + item.length));
  return end > start ? { start, end } : undefined;
}

/**
 * Mock 04's strip over the chapter's recording, with a pin at each note, coloured by its type, and a legend of the types
 * shown (PF10, D85 #2). A pin selects its note. The mock draws the pins over the chapter's waveform; the host sends no
 * peaks for a chapter, so there is no waveform to draw, and the strip shows the pins over a plain rule rather than an
 * invented one (ADR 0470). Nothing is drawn when no note has a place in the recording.
 */
export function NotesStrip({
  findings,
  items,
  selectedId,
  onSelect,
}: {
  findings: readonly Finding[];
  items: readonly TrackItem[];
  selectedId: string | undefined;
  onSelect: (finding: Finding) => void;
}) {
  const span = chapterSpan(items);
  if (!span) return null;
  const duration = span.end - span.start;
  const timed = findings.filter((finding) => finding.time_range && finding.time_range.start >= span.start && finding.time_range.start <= span.end);
  if (timed.length === 0) return null;

  const markers: TimelineMarker[] = timed.map((finding) => ({
    id: finding.id,
    at: finding.time_range!.start - span.start,
    tone: markerTone(CATEGORY_TONE[finding.category] ?? 'neutral'),
    label: `${evidenceKindLabel(finding)}: ${findingSummary(finding)}`,
  }));
  const legend = [...new Map(timed.map((finding) => [evidenceKindLabel(finding), CATEGORY_TONE[finding.category] ?? 'neutral'])).entries()];
  const selected = timed.find((finding) => finding.id === selectedId);

  return (
    <section aria-label="Notes in the recording" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 pt-3 pb-2 shadow-[var(--shadow)]">
      <Timeline duration={duration} playhead={selected ? selected.time_range!.start - span.start : undefined}>
        <div className="relative">
          <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
          <TimelineLane
            label="Notes"
            duration={duration}
            markers={markers}
            onActivate={(id) => {
              const finding = timed.find((candidate) => candidate.id === id);
              if (finding) onSelect(finding);
            }}
          />
        </div>
      </Timeline>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">0:00</span>
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Note types">
          {legend.map(([label, tone]) => (
            <li key={label} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={`inline-block size-2 rounded-full ${LEGEND_DOT[tone]}`} />
              {label.toLowerCase()}
            </li>
          ))}
        </ul>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{formatTime(duration).replace(/\.\d$/, '')}</span>
      </div>
    </section>
  );
}
