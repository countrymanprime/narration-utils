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
    <label className="label mt-3 block">
      {label}
      {textarea ? (
        <textarea className="input mt-1 min-h-20" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      ) : (
        <input className="input mt-1" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
      )}
    </label>
  );
}
