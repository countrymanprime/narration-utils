import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { FIELD_LABEL_CLASSES } from '../primitives/Field';
import { Select } from '../primitives/Select';
import type { TeleprompterDevice } from '../../types';

const HINT_CLASS = 'mt-1 block text-xs';

const CHOOSE_LABEL = 'Choose a microphone…';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The sidecar's `--list-devices` result (`TeleprompterDevices`), by the exact name the capture path opens each one under. */
  devices: TeleprompterDevice[];
  /** A listing problem from the host. An empty list (with or without an error) blocks the phase (see below). */
  error?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The field's id, so two pickers can share a page: the teleprompter's (the default) and the built-in recorder's (Q6). */
  id?: string;
  /** Its visible label ("Microphone" by default). */
  label?: string;
  /** What an empty list blocks, after "Connect a microphone, then refresh." */
  blocks?: string;
};

// The device picker (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2), replacing Phase 1's typed-name
// seam: a dropdown of the names the sidecar's capture path actually opens, and nothing else - no typed name, no
// "Other…" entry. This is the standing "Microphone is never typed" decision (the PRD's Decisions Log, 2026-09-20): a
// failed or empty listing blocks the phase instead of falling back to typing, so a device the list does not have
// simply cannot be started with, and a remembered device the list no longer has is kept selected and shown as
// "(not found)" rather than silently replaced.
export function MicrophoneField({
  value,
  onChange,
  devices,
  error,
  onRefresh,
  refreshing = false,
  id = 'teleprompter-device',
  label = 'Microphone',
  blocks = 'Reading cannot start until a device is listed.',
}: Props) {
  const knownNames = new Set(devices.map((device) => device.name));
  const remembersAnUnlistedDevice = value !== '' && !knownNames.has(value);
  const listEmpty = devices.length === 0;

  const refreshButton = onRefresh && (
    <Button variant="ghost" className="px-2! py-1! text-[0.7rem]!" onClick={onRefresh} pending={refreshing}>
      <FontAwesomeIcon icon={faRotate} /> {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  );

  if (listEmpty) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className={FIELD_LABEL_CLASSES} id={`${id}-label`}>
            {label}
          </span>
          {refreshButton}
        </div>
        <p id={id} role="alert" aria-labelledby={`${id}-label`} className="mt-1 text-sm font-medium" style={{ color: 'var(--danger-text)' }}>
          {error ? "Couldn't list microphones" : 'No microphone found'}
        </p>
        <span className={HINT_CLASS} style={{ color: 'var(--text-muted)' }}>
          {error || `Connect a microphone, then refresh. ${blocks}`}
        </span>
      </div>
    );
  }

  const options = [
    ...(value === '' ? [{ value: '', label: CHOOSE_LABEL }] : []),
    ...devices.map((device) => ({ value: device.name, label: device.name })),
    ...(remembersAnUnlistedDevice ? [{ value, label: `${value} (not found)` }] : []),
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className={FIELD_LABEL_CLASSES} htmlFor={id}>
          {label}
        </label>
        {refreshButton}
      </div>
      <Select id={id} className="mt-1" fullWidth value={value} onChange={onChange} options={options} />
      {remembersAnUnlistedDevice && (
        <span className={HINT_CLASS} role="alert" style={{ color: 'var(--warn-text)' }}>
          The remembered microphone was not found in the current device list. Pick it again or choose another one.
        </span>
      )}
      {error && (
        <span className={HINT_CLASS} role="alert" style={{ color: 'var(--danger-text)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
