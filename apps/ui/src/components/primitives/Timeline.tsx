import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

// The meanings a marker's tone may take, sharing the fills phase 1 landed for the meter zones and the badge tones (ADR
// 0360): a marker earns a colour for what it is, not for which lane it happens to sit in.
type TimelineMarkerTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'experimental';

const TONE_DOT: Record<TimelineMarkerTone, string> = {
  neutral: 'bg-[var(--text-muted)]',
  info: 'bg-[var(--info)]',
  success: 'bg-[var(--ok)]',
  warning: 'bg-[var(--warn)]',
  danger: 'bg-[var(--danger)]',
  experimental: 'bg-[var(--experimental)]',
};

export type TimelineMarker = {
  id: string;
  // Seconds from the start of the parent `Timeline`'s `duration`.
  at: number;
  tone: TimelineMarkerTone;
  label: string;
};

function toPercent(at: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (at / duration) * 100));
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

// A time axis for a proof pass or a session recap (studio-ui-primitives.prd.md mock 04): a `duration`-second ruler, an
// optional `playhead` line, and the caller's `TimelineLane`s stacked under it. `backdrop` is a decorative visual the
// feature draws under the lanes (a waveform); the primitive itself draws no audio and marks the backdrop `aria-hidden`
// (Q5). Every position is a percentage of the ruler's width, so a long recording never causes sideways overflow.
export function Timeline({
  duration,
  playhead,
  backdrop,
  className = '',
  children,
}: {
  duration: number;
  // Seconds from the start; drawn as a line across the full height of the lanes.
  playhead?: number;
  backdrop?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {backdrop && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {backdrop}
        </div>
      )}
      <div className="relative flex flex-col gap-2">{children}</div>
      {playhead !== undefined && duration > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-[var(--accent)]"
          style={{ left: `${toPercent(playhead, duration)}%` }}
        />
      )}
    </div>
  );
}

// One row of markers over the parent `Timeline`'s duration (a category: misread, pronunciation, noise, pacing). The
// markers are one roving-focus group, named by `label`: Left/Right step between them, Home/End jump to the first/last,
// and Enter or Space activates the focused one, reporting `onActivate(id)`. Each marker is named by its time and label
// ("1:04, Mispronounced 'epitome'"), so a screen reader hears more than a bare dot.
export function TimelineLane({
  label,
  duration,
  markers,
  onActivate,
  className = '',
}: {
  label: string;
  duration: number;
  markers: TimelineMarker[];
  onActivate: (id: string) => void;
  className?: string;
}) {
  // The one tab stop of the group: the last marker focus landed on, or the first until then.
  const [activeId, setActiveId] = useState<string | undefined>(markers[0]?.id);
  const active = markers.some((marker) => marker.id === activeId) ? activeId : markers[0]?.id;
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = Math.min(markers.length - 1, index + 1);
    else if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = markers.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate(markers[index].id);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (nextIndex === index) return;
    const next = markers[nextIndex];
    setActiveId(next.id);
    buttons.current.get(next.id)?.focus();
  };

  return (
    <div role="group" aria-label={label} className={`relative h-6 ${className}`}>
      {markers.map((marker, index) => (
        <button
          key={marker.id}
          ref={(node) => {
            if (node) buttons.current.set(marker.id, node);
            else buttons.current.delete(marker.id);
          }}
          type="button"
          tabIndex={marker.id === active ? 0 : -1}
          aria-label={`${formatTime(marker.at)}, ${marker.label}`}
          onClick={() => {
            setActiveId(marker.id);
            onActivate(marker.id);
          }}
          onFocus={() => setActiveId(marker.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={`absolute top-1/2 size-3 -translate-1/2 rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${TONE_DOT[marker.tone]}`}
          style={{ left: `${toPercent(marker.at, duration)}%` }}
        />
      ))}
    </div>
  );
}
