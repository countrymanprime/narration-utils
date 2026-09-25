import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';

export type RadioOption<Value extends string> = { value: Value; label: ReactNode; description?: ReactNode };

/**
 * A labelled choice of one from a short, named list (ADR 0047: Base UI styled with the app's tokens, never imported
 * directly by app code). Unlike Select, every option's label and its help text are always visible at once - for a
 * handful of options where seeing them side by side matters (chapter-track-link-control.prd.md Phase 3: "Not a
 * chapter" versus "Front matter"), not for a long list.
 */
export function RadioGroup<Value extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: Value;
  onChange: (value: Value) => void;
  options: readonly RadioOption<Value>[];
}) {
  return (
    <BaseRadioGroup aria-label={label} value={value} onValueChange={(next) => onChange(next as Value)} className="space-y-2.5">
      {options.map((option) => (
        // The description sits outside the <label>, so a screen reader hears just the option's own name ("Front
        // matter"), not the name followed by its help text run together.
        <div key={option.value}>
          <label className="flex items-center gap-2.5 text-sm">
            <Radio.Root
              value={option.value}
              className="inline-flex size-4 flex-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] data-[checked]:border-[var(--accent)]"
            >
              <Radio.Indicator className="size-2 rounded-full bg-[var(--accent)] data-[unchecked]:hidden" />
            </Radio.Root>
            <span className="font-medium">{option.label}</span>
          </label>
          {option.description && (
            <div className="mt-0.5 ml-[1.65rem]" style={{ color: 'var(--text-muted)' }}>
              {option.description}
            </div>
          )}
        </div>
      ))}
    </BaseRadioGroup>
  );
}
