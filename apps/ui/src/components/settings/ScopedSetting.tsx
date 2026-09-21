import type { Scope, ScopedSettingField } from '../../types';
import { Select } from '../primitives/Select';
import { Switch } from '../primitives/Switch';
import { TextField } from '../primitives/TextField';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { proofingChoiceLabel } from '../proofing/options';

const TOOLTIP: Record<string, string> = {
  spacy_model: 'Controls Story Bible detection quality and build speed.',
  model_size: 'Default Whisper model for new comparisons.',
  chunk_seconds: 'Default transcription chunk length.',
  color_note: 'Color used for narrator note treatment.',
  log_verbosity: 'Controls diagnostic output shown in logs.',
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
