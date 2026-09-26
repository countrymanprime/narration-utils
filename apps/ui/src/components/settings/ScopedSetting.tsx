import { useId, type ReactNode } from 'react';
import type { NumberSettingRange } from '../../api/contracts/system';
import type { Scope, ScopedSettingField } from '../../types';
import { Select } from '../primitives/Select';
import { Switch } from '../primitives/Switch';
import { TextField } from '../primitives/TextField';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { proofingChoiceLabel } from '../proofing/options';
import { describeNumberRange, numberProblem } from './numberSetting';

const DELIVERY_LIMIT_TIP =
  "Your own limit for this measurement. Leave it blank and the measurement is reported without being checked. No distributor's numbers are built in.";
const DELIVERY_LIMIT_KEYS = [
  'integrated_lufs_min',
  'integrated_lufs_max',
  'rms_dbfs_min',
  'rms_dbfs_max',
  'sample_peak_dbfs_max',
  'true_peak_dbtp_max',
  'noise_floor_dbfs_max',
];
const TOOLTIP: Record<string, string> = {
  ...Object.fromEntries(DELIVERY_LIMIT_KEYS.map((key) => [key, DELIVERY_LIMIT_TIP])),
  spacy_model: 'Controls Story Bible detection quality and build speed.',
  model_size: 'Default Whisper model for new comparisons.',
  chunk_seconds: 'Default transcription chunk length.',
  color_note: 'Color used for narrator note treatment.',
  log_verbosity: 'Controls diagnostic output shown in logs.',
  credits_room_tone_seconds:
    'Silence the Home estimate adds to each opening and closing credits file, head and tail together. ACX asks for 1 to 5 seconds at each end; leave 0 to count the words only.',
  check_on_startup:
    'Once a day, when the app starts, it asks GitHub whether a newer release exists. It sends nothing about you or your projects, and it never downloads anything without your click.',
  channel: 'Release candidates are the pre-releases that come before each stable release; every release so far is one.',
  input_device: 'The microphone the Teleprompter listens to. Choose it from the list on the Teleprompter page; it is remembered here.',
  engine:
    'Which local speech engine listens for your voice during a Teleprompter session. Moonshine is offered on Windows only. Choosing one never downloads anything: a missing model is asked for when you start reading.',
  model: 'Which model size the live engine loads. Tiny keeps up on most computers; Small is more accurate but needs a faster one.',
  reaper_path: 'Leave blank to auto-detect reaper.exe. Set this only when auto-detect finds the wrong install or none at all.',
  auto_start_launcher:
    'When Narration Utils starts REAPER, also pass the Narration Utils action as a startup script, so the bridge is live immediately. Off by default: REAPER is never changed automatically.',
  suggestions_enabled: 'Turns every stage suggestion on Home off at once, without changing which signals are required below.',
  'recording.text_present':
    'Whether every paragraph present in order, as the recording check measures it, must be met before Home suggests moving a chapter from Recording to Editing.',
};
const optionTip = (field: ScopedSettingField, value: string) =>
  field.key.includes('color')
    ? `Use ${value} as the saved base color.`
    : `${proofingChoiceLabel(field.key, value)} is the selected ${field.label.toLowerCase()} option.`;

// A native color input can only show a full #rrggbb value. An empty or invalid
// setting used to be zero-padded to #000000, so every unset color looked like a
// deliberate black; show a neutral gray instead and let the text field say
// "Not set".
const NEUTRAL_PICKER_COLOR = '#808080';
const pickerColor = (value: string) => {
  const hex = value.replace('#', '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : NEUTRAL_PICKER_COLOR;
};

// One setting: the label above its control below `md`, the label beside it from `md` (Tailwind's 48rem, the app's own layout
// breakpoint). The two-column template used to apply at every width, and a grid gives a fixed-range track (the label's
// minmax(12rem,16rem)) its full maximum before a flexible one gets any, so at a 390 px window the control column was 45 px.
// Between `md` and `lg` the settings panel is narrow (the category list stands beside it) so the label takes its 12rem
// minimum and the control the rest (191 px at 768 px, not 127); from `lg` the label may grow to 16rem again.
const ROW_CLASSES =
  'grid grid-cols-1 gap-2 border-b border-[var(--border)] py-4 md:grid-cols-[12rem_minmax(0,1fr)] md:items-start md:gap-5 lg:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]';
// The controls (a select, or a swatch and a hex box) and the Reset link. The row may wrap so Reset drops under the control only
// when there is no room beside it, and a control stops growing at 28rem so every select is the same width from md up.
const CONTROLS_CLASSES = 'flex min-w-0 max-w-md flex-wrap items-center gap-[0.6rem]';
// A boolean row: the switch with its label, the hint icon and Reset on one wrapping line.
const BOOL_ROW_CLASSES = 'flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-[var(--border)] py-4';
// A control that takes the free width, wraps to its own line below 10rem rather than shrinking past being usable, and can
// shrink below its content (`min-w-0`; a flex item otherwise never gets narrower than its longest option).
const GROWING_CONTROL_CLASSES = 'min-w-0 flex-[1_1_10rem]';
// The hex box beside a swatch: a six-digit code needs about 4.5rem, so it shares the row with the swatch rather than wrapping
// under it, and takes whatever is left.
const HEX_CONTROL_CLASSES = 'min-w-[4.5rem] flex-[1_1_0%]';

// What an empty number box stands for. Unlike the other kinds, a number box shows only this scope's own value, so it can
// be emptied (empty is "not set", saved as null): what it inherits is the placeholder. A global box never shows a
// project's value as inherited, and a project override being cleared inherits a value the page has not been sent yet.
function numberPlaceholder(field: ScopedSettingField, scope: Scope): string {
  const inherits = !field.isSet && field.effectiveValue !== '' && !(scope === 'global' && field.effectiveSource === 'project');
  if (inherits) return `Inherits ${field.effectiveValue}`;
  return scope === 'project' && field.isSet ? 'Inherits Global' : 'Not set';
}

function NumberSetting({
  field,
  range,
  scope,
  value,
  change,
  resetButton,
}: {
  field: ScopedSettingField;
  range: NumberSettingRange;
  scope: Scope;
  value: string;
  change: (value: string) => void;
  resetButton: ReactNode;
}) {
  const hintId = useId();
  const problem = numberProblem(range, value);
  const hint = problem ?? describeNumberRange(range);
  return (
    <div className={ROW_CLASSES}>
      <div className="text-[0.82rem] font-medium text-[var(--text-muted)] md:pt-2">
        {field.label}
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
      </div>
      <div className={CONTROLS_CLASSES}>
        {/* The unit stays beside its box at every width (the box shrinks, never below the collapsed-control floor of ADR 0060),
            so it never wraps to a line of its own the way a separate flex item would in the narrow tablet column. */}
        <div className={`flex items-center gap-[0.6rem] ${GROWING_CONTROL_CLASSES}`}>
          <TextField
            label={field.label}
            mono
            inputMode="decimal"
            className="min-w-0 flex-1"
            placeholder={numberPlaceholder(field, scope)}
            value={value}
            onChange={(next) => change(next.trim())}
            aria-invalid={problem ? true : undefined}
            aria-describedby={hint ? hintId : undefined}
          />
          {range.unit && <span className="flex-none text-[0.82rem] text-[var(--text-muted)]">{range.unit}</span>}
        </div>
        {resetButton}
        {hint && (
          <p id={hintId} className="basis-full text-xs" style={{ color: problem ? 'var(--danger-text)' : 'var(--text-muted)' }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function ScopedSetting({
  field,
  scope,
  value,
  change,
  onClearOverride,
}: {
  field: ScopedSettingField;
  scope: Scope;
  value: string;
  change: (value: string) => void;
  onClearOverride: () => void;
}) {
  const effective = value || field.effectiveValue;
  const resetButton = scope === 'project' && field.isSet && (
    <button type="button" className="ml-auto flex-none text-[0.75rem] text-[var(--accent)] underline" onClick={onClearOverride}>
      Reset
    </button>
  );
  if (field.kind === 'number' && field.number) {
    return <NumberSetting field={field} range={field.number} scope={scope} value={value} change={change} resetButton={resetButton} />;
  }
  if (field.kind === 'bool') {
    // A switch is its own label (the setting's name), so the row is the switch, the hint icon and Reset, not a label column
    // and a control column. Only the stored string "true" is on: anything else the host never validated reads as off.
    return (
      <div className={BOOL_ROW_CLASSES}>
        <Switch checked={effective === 'true'} onChange={(checked) => change(String(checked))}>
          {field.label}
        </Switch>
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
        {resetButton}
      </div>
    );
  }
  const isColor = field.kind === 'color';
  const isText = field.kind === 'text';
  return (
    <div className={ROW_CLASSES}>
      <div className="text-[0.82rem] font-medium text-[var(--text-muted)] md:pt-2">
        {field.label}
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
      </div>
      <div className={CONTROLS_CLASSES}>
        {isColor ? (
          <>
            <TextField label={`${field.label} hex`} type="color" value={pickerColor(effective)} onChange={(value) => change(value.slice(1).toUpperCase())} />
            <TextField
              label={field.label}
              mono
              className={HEX_CONTROL_CLASSES}
              placeholder="Not set"
              value={effective}
              onChange={(value) => change(value.replace('#', '').toUpperCase())}
            />
          </>
        ) : isText ? (
          <TextField label={field.label} className={GROWING_CONTROL_CLASSES} value={effective} onChange={change} />
        ) : (
          <TooltipTarget text={optionTip(field, effective)} className={GROWING_CONTROL_CLASSES}>
            <Select
              label={field.label}
              fullWidth
              value={effective}
              onChange={change}
              options={field.choices.map((choice) => ({ value: choice, label: proofingChoiceLabel(field.key, choice) }))}
            />
          </TooltipTarget>
        )}
        {resetButton}
      </div>
    </div>
  );
}
