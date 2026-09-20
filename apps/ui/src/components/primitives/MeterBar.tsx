import { TooltipTarget } from './Tooltip';

export type MeterSegment = {
  key: string;
  widthPercent: number;
  color: string;
  tooltip: string;
};

// Rendering order is entirely caller-controlled (e.g. finished-first, like a
// device storage indicator) - this component just lays segments out in order.
//
// A segmented bar has no single value (Base UI's Meter is one scalar), so it is an image whose name is the label followed
// by every segment's own tooltip text: what a sighted user learns by hovering, a screen reader hears at once. The segments
// stay pointer-only hints for the same reason. The width transition only runs when the user has not asked for reduced motion.
export function MeterBar({ label, segments }: { label: string; segments: MeterSegment[] }) {
  const name = segments.length ? `${label}: ${segments.map((segment) => segment.tooltip).join('; ')}` : label;
  return (
    <div role="img" aria-label={name} className="flex h-4 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
      {segments.map((segment) => (
        <TooltipTarget
          key={segment.key}
          className="progress-segment h-full flex-none motion-safe:transition-[flex-basis] motion-safe:duration-300 motion-safe:ease-out"
          style={{ flexBasis: `${segment.widthPercent.toFixed(1)}%`, display: 'block' }}
          text={segment.tooltip}
        >
          <span className="block size-full" style={{ background: segment.color }} />
        </TooltipTarget>
      ))}
    </div>
  );
}
