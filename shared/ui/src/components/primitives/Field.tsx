export function Field({
  label,
  value,
  onChange,
  onBlur,
  disabled,
  textarea = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  textarea?: boolean;
}) {
  return (
    <label className="mt-3 block text-[0.82rem] font-medium text-[var(--text-muted)]">
      {label}
      {textarea ? (
        <textarea
          className="mt-1 min-h-20 w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          className="mt-1 min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      )}
    </label>
  );
}
