import { TextField } from '../primitives/TextField';

// The label styling every Teleprompter field row shares (TeleprompterPage.tsx's LABEL_CLASS); duplicated here rather
// than imported so this component has no dependency back on its one caller.
const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

// The seam PRD 2 (teleprompter-manuscript-integration) and this PRD's own Phase 2 share: today it is exactly the typed
// device-name field TeleprompterPage.tsx had (docs/prds/teleprompter-engines-and-input-devices.prd.md, "Microphone
// picker overlap" open question, option (b)) - unchanged behavior, just relocated so a later phase can swap its
// internals for a real device picker without either PRD needing to coordinate on where the field lives.
export function MicrophoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor="teleprompter-device">
        Microphone
      </label>
      <TextField
        id="teleprompter-device"
        aria-describedby="teleprompter-device-hint"
        className="mt-1"
        value={value}
        placeholder="Microphone (USB Audio Device)"
        onChange={onChange}
      />
      <span id="teleprompter-device-hint" className="mt-1 block text-xs" style={{ color: 'var(--text-muted)' }}>
        The device name exactly as Windows lists it under Sound settings.
      </span>
    </div>
  );
}
