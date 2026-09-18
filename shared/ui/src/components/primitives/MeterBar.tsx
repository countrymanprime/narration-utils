import { TooltipTarget } from './Tooltip';

export type MeterSegment = {
  key: string;
  widthPercent: number;
  color: string;
  tooltip: string;
};

// Rendering order is entirely caller-controlled (e.g. finished-first, like a
// device storage indicator) - this component just lays segments out in order.
export function MeterBar({ segments }: { segments: MeterSegment[] }) {
  return (
    <div className="flex h-4 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
      {segments.map((segment) => (
        <TooltipTarget
          key={segment.key}
          className="progress-segment h-full flex-none transition-[flex-basis] duration-300 ease-out"
          style={{ flexBasis: `${segment.widthPercent.toFixed(1)}%`, display: 'block' }}
          text={segment.tooltip}
        >
          <span className="block size-full" style={{ background: segment.color }} />
        </TooltipTarget>
      ))}
    </div>
  );
}
