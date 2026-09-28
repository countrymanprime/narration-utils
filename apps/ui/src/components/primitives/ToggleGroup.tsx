import { Pill } from './Pill';

type ToggleGroupOption = {
  value: string;
  label: string;
  disabled?: boolean;
  // Shown as a hint on the chip (why it is off, or what it means).
  title?: string;
};

/** `default` is a row of standalone chips, each with its own border. `segmented` is one bordered container (the Master
 * platform switch, mock-fidelity-primitives-and-components.prd.md Phase 5): 33 px, 1 px `--border`, `--bg` fill, radius
 * ≈6; the chosen segment is inset, filled `--accent`, and the rest carry no fill, in the label's own case (title case in
 * the mocks, not uppercase — ACX, iNaudio, Google Play). */
export type ToggleGroupLook = 'default' | 'segmented';

// A group of chips of which one is chosen (the Whisper model, the text size, the theme). The group has a name a screen
// reader says before its chips ("Chunk length, group"), where the chips used to be preceded by a `<label>` with nothing to
// label. Each chip is a `Pill`, a toggle that reports `aria-pressed`; pressing the chosen one again reports it too and the
// caller decides, as before. Every chip stays a tab stop. `className` is the group's layout (`gap-1.5 flex-wrap`).
export function ToggleGroup({
  label,
  value,
  onChange,
  options,
  look = 'default',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ToggleGroupOption[];
  look?: ToggleGroupLook;
  className?: string;
}) {
  const containerClass =
    look === 'segmented'
      ? 'inline-flex h-[2.0625rem] gap-0.5 rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg)] p-[0.1875rem]'
      : 'flex';
  return (
    <div role="group" aria-label={label} className={`${containerClass} ${className}`}>
      {options.map((option) => (
        <Pill
          key={option.value}
          label={option.label}
          active={value === option.value}
          disabled={option.disabled}
          title={option.title}
          look={look === 'segmented' ? 'segmented' : 'chip'}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}
