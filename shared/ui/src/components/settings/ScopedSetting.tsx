import type { Scope, ScopedSettingField } from '../../types';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';

const TOOLTIP: Record<string, string> = {
  spacy_model: 'Controls Story Bible detection quality and build speed.',
  model_size: 'Default Whisper model for new comparisons.',
  chunk_seconds: 'Default transcription chunk length.',
  color_note: 'Color used for narrator note treatment.',
  log_verbosity: 'Controls diagnostic output shown in logs.',
};
const optionTip = (field: ScopedSettingField, value: string) =>
  field.key.includes('color') ? `Use ${value} as the saved base color.` : `${value} is the selected ${field.label.toLowerCase()} option.`;

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
  return (
    <div className="form-row">
      <div className="form-label pt-2">
        {field.label}
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
      </div>
      <div className="setting-control">
        {isColor ? (
          <>
            <input
              aria-label={`${field.label} hex`}
              className="color-swatch"
              type="color"
              value={`#${effective.padStart(6, '0')}`}
              onChange={(event) => change(event.target.value.slice(1).toUpperCase())}
            />
            <input className="form-control f-mono" value={effective} onChange={(event) => change(event.target.value.replace('#', '').toUpperCase())} />
          </>
        ) : (
          <TooltipTarget text={optionTip(field, effective)}>
            <select className="form-control" value={effective} onChange={(event) => change(event.target.value)}>
              {field.choices.map((choice) => (
                <option key={choice}>{choice}</option>
              ))}
            </select>
          </TooltipTarget>
        )}
        {scope === 'project' && field.isSet && (
          <button type="button" className="reset-override" onClick={onClearOverride}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
