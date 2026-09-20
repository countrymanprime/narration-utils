import type { Scope, ScopedSettingField } from '../../types';
import { Select } from '../primitives/Select';
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
  const isColor = field.kind === 'color';
  const isText = field.kind === 'text';
  return (
    <div className="grid grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] items-start gap-5 border-b border-[var(--border)] py-4">
      <div className="pt-2 text-[0.82rem] font-medium text-[var(--text-muted)]">
        {field.label}
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
      </div>
      <div className="flex items-center gap-[0.6rem]">
        {isColor ? (
          <>
            <TextField label={`${field.label} hex`} type="color" value={pickerColor(effective)} onChange={(value) => change(value.slice(1).toUpperCase())} />
            <TextField label={field.label} mono placeholder="Not set" value={effective} onChange={(value) => change(value.replace('#', '').toUpperCase())} />
          </>
        ) : isText ? (
          <TextField label={field.label} value={effective} onChange={change} />
        ) : (
          <TooltipTarget text={optionTip(field, effective)}>
            <Select
              label={field.label}
              fullWidth
              value={effective}
              onChange={change}
              options={field.choices.map((choice) => ({ value: choice, label: proofingChoiceLabel(field.key, choice) }))}
            />
          </TooltipTarget>
        )}
        {scope === 'project' && field.isSet && (
          <button type="button" className="ml-auto text-[0.75rem] text-[var(--accent)] underline" onClick={onClearOverride}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
