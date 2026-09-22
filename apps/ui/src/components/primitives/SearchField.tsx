import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useRef } from 'react';
import { IconButton } from './IconButton';
import { TextField } from './TextField';
import { TooltipTarget } from './Tooltip';

// A text field for filtering a list or the manuscript, with a clear button inside it once there is something to clear. The
// clear button returns focus to the field, so typing can continue. Named by `label` (aria-label); controlled.
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  clearLabel = 'Clear search',
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  autoFocus?: boolean;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative w-full">
      <TextField
        ref={fieldRef}
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={value ? { paddingRight: '2.25rem' } : undefined}
      />
      {value && (
        <TooltipTarget text={clearLabel} style={{ position: 'absolute', right: '.25rem', top: '50%', transform: 'translateY(-50%)' }}>
          <IconButton
            label={clearLabel}
            onClick={() => {
              onChange('');
              fieldRef.current?.focus();
            }}
          >
            <FontAwesomeIcon icon={faXmark} />
          </IconButton>
        </TooltipTarget>
      )}
    </div>
  );
}
