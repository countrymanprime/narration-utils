import { Pill } from './Pill';

type ToggleGroupOption = {
  value: string;
  label: string;
  disabled?: boolean;
  // Shown as a hint on the chip (why it is off, or what it means).
  title?: string;
};

// A group of chips of which one is chosen (the Whisper model, the text size, the theme). The group has a name a screen
// reader says before its chips ("Chunk length, group"), where the chips used to be preceded by a `<label>` with nothing to
// label. Each chip is a `Pill`, a toggle that reports `aria-pressed`; pressing the chosen one again reports it too and the
// caller decides, as before. Every chip stays a tab stop. `className` is the group's layout (`gap-1.5 flex-wrap`).
export function ToggleGroup({
  label,
  value,
  onChange,
  options,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ToggleGroupOption[];
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`flex ${className}`}>
      {options.map((option) => (
        <Pill
          key={option.value}
          label={option.label}
          active={value === option.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}
