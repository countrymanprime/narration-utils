import { useState } from 'react';
import { Select } from '../primitives/Select';
import { TextField } from '../primitives/TextField';
import type { TeleprompterDevice } from '../../types';

// The label styling every Teleprompter field row shares (TeleprompterPage.tsx's LABEL_CLASS); duplicated here rather
// than imported so this component has no dependency back on its one caller.
const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';
const HINT_CLASS = 'mt-1 block text-xs';

const OTHER_VALUE = '__other__';
const OTHER_LABEL = 'Other…';
const CHOOSE_LABEL = 'Choose a microphone…';

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The sidecar's `--list-devices` result (`TeleprompterDevices`), by the exact name the capture path opens each one under. */
  devices: TeleprompterDevice[];
  /** A listing problem from the host (never blocks Start: a previously-chosen device can still be used). */
  error?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
};

// The device picker (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2), replacing Phase 1's typed-name
// seam: a dropdown of the names the sidecar's capture path actually opens, with a typed "Other…" entry kept as the
// fallback for an empty listing or a device the list does not have (the remembered choice is shown as "not found",
// never silently replaced by another entry).
export function MicrophoneField({ value, onChange, devices, error, onRefresh, refreshing = false }: Props) {
  const knownNames = new Set(devices.map((device) => device.name));
  const remembersAnUnlistedDevice = value !== '' && !knownNames.has(value);
  const [otherChosen, setOtherChosen] = useState(false);
  const showTyped = devices.length === 0 || otherChosen;

  const changeSelect = (next: string) => {
    if (next === OTHER_VALUE) {
      setOtherChosen(true);
      onChange('');
      return;
    }
    setOtherChosen(false);
    onChange(next);
  };
  const changeTyped = (next: string) => {
    onChange(next);
  };
  const chooseFromList = () => {
    setOtherChosen(false);
    onChange('');
  };

  if (showTyped) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className={LABEL_CLASS} htmlFor="teleprompter-device">
            Microphone
          </label>
          <span className="flex gap-2">
            {devices.length > 0 && (
              <button type="button" className="text-xs text-[var(--accent)] underline" onClick={chooseFromList}>
                Choose from the list
              </button>
            )}
            {onRefresh && (
              <button type="button" className="text-xs text-[var(--accent)] underline" onClick={onRefresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </span>
        </div>
        <TextField
          id="teleprompter-device"
          aria-describedby="teleprompter-device-hint"
          className="mt-1"
          value={value}
          placeholder="Microphone (USB Audio Device)"
          onChange={changeTyped}
        />
        <span id="teleprompter-device-hint" className={HINT_CLASS} style={{ color: 'var(--text-muted)' }}>
          {devices.length === 0
            ? 'No microphones were found. Type the device name exactly as Windows lists it under Sound settings.'
            : 'The device name exactly as Windows lists it under Sound settings.'}
        </span>
        {error && (
          <span className={HINT_CLASS} role="alert" style={{ color: 'var(--danger-text)' }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  const options = [
    ...(value === '' ? [{ value: '', label: CHOOSE_LABEL }] : []),
    ...devices.map((device) => ({ value: device.name, label: device.name })),
    ...(remembersAnUnlistedDevice ? [{ value, label: `${value} (not found)` }] : []),
    { value: OTHER_VALUE, label: OTHER_LABEL },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className={LABEL_CLASS} htmlFor="teleprompter-device">
          Microphone
        </label>
        {onRefresh && (
          <button type="button" className="text-xs text-[var(--accent)] underline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      <Select id="teleprompter-device" className="mt-1" fullWidth value={value} onChange={changeSelect} options={options} />
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
