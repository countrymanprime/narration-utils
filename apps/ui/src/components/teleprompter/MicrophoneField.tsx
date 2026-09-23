import { Select } from '../primitives/Select';
import type { TeleprompterDevice } from '../../types';

// The label styling every Teleprompter field row shares (TeleprompterPage.tsx's LABEL_CLASS); duplicated here rather
// than imported so this component has no dependency back on its one caller.
const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';
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
};

// The device picker (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2), replacing Phase 1's typed-name
// seam: a dropdown of the names the sidecar's capture path actually opens, and nothing else - no typed name, no
// "Other…" entry. This is the standing "Microphone is never typed" decision (the PRD's Decisions Log, 2026-09-20): a
// failed or empty listing blocks the phase instead of falling back to typing, so a device the list does not have
// simply cannot be started with, and a remembered device the list no longer has is kept selected and shown as
// "(not found)" rather than silently replaced.
export function MicrophoneField({ value, onChange, devices, error, onRefresh, refreshing = false }: Props) {
  const knownNames = new Set(devices.map((device) => device.name));
  const remembersAnUnlistedDevice = value !== '' && !knownNames.has(value);
  const listEmpty = devices.length === 0;

  const refreshButton = onRefresh && (
    <button type="button" className="text-xs text-[var(--accent)] underline" onClick={onRefresh} disabled={refreshing}>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </button>
  );

  if (listEmpty) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL_CLASS} id="teleprompter-device-label">
            Microphone
          </span>
          {refreshButton}
        </div>
        <p
          id="teleprompter-device"
          role="alert"
          aria-labelledby="teleprompter-device-label"
          className="mt-1 text-sm font-medium"
          style={{ color: 'var(--danger-text)' }}
        >
          {error ? "Couldn't list microphones" : 'No microphone found'}
        </p>
        <span className={HINT_CLASS} style={{ color: 'var(--text-muted)' }}>
          {error || 'Connect a microphone, then refresh. Reading cannot start until a device is listed.'}
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
        <label className={LABEL_CLASS} htmlFor="teleprompter-device">
          Microphone
        </label>
        {refreshButton}
      </div>
      <Select id="teleprompter-device" className="mt-1" fullWidth value={value} onChange={onChange} options={options} />
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
