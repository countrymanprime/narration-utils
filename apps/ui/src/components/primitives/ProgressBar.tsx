import { Progress } from '@base-ui/react/progress';

// The one determinate/indeterminate progress bar (ADR 0015: real progress only). Base UI's Progress carries the semantics (role="progressbar",
// aria-valuenow only when there is a value); the fill below keeps the current look. WorkDialog and the local-assets rows draw it.
//
// `value` is a percentage, or `null` when nothing has been measured yet: no value is announced and the fill slides. `running` says the job has begun,
// so the fill is at least a sliver wide (a bar at 1% would otherwise be invisible). `valueText` is what a screen reader hears in place of the
// number ("44 of 109 MB"): the numbers move on nearly every poll, so they belong here and not in a live region.
const MINIMUM_RUNNING_PERCENT = 4;

export function ProgressBar({
  label,
  value,
  running = false,
  valueText,
  className = '',
}: {
  label: string;
  value: number | null;
  running?: boolean;
  valueText?: string;
  className?: string;
}) {
  const indeterminate = value === null;
  return (
    <Progress.Root value={value} aria-label={label} aria-valuetext={valueText} className={className}>
      <Progress.Track className="progressbar h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          // motion-safe: the fill neither eases nor slides for people who have asked for reduced motion.
          className={`h-full bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-[0.4s] motion-safe:ease-in-out ${indeterminate ? 'motion-safe:animate-[work-progress-slide_1.15s_ease-in-out_infinite]' : ''}`}
          style={{ width: `${Math.max(value ?? 0, running ? MINIMUM_RUNNING_PERCENT : 0)}%` }}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
