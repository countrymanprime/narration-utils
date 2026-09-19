import type { Scope, ScopedSettingField } from '../../types';
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
  const controlClass =
    'min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-[var(--accent)] focus:outline-offset-1';
  return (
    <div className="grid grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] items-start gap-5 border-b border-[var(--border)] py-4">
      <div className="pt-2 text-[0.82rem] font-medium text-[var(--text-muted)]">
        {field.label}
        <Tooltip text={TOOLTIP[field.key] || `Configure ${field.label.toLowerCase()}.`} />
      </div>
      <div className="flex items-center gap-[0.6rem]">
        {isColor ? (
          <>
            <input
              aria-label={`${field.label} hex`}
              className="size-[2.35rem] rounded-[0.35rem] border border-[var(--border)] bg-[var(--surface)] p-[0.2rem]"
              type="color"
              value={`#${effective.padStart(6, '0')}`}
              onChange={(event) => change(event.target.value.slice(1).toUpperCase())}
            />
            <input
              className={`${controlClass} font-['IBM_Plex_Mono',ui-monospace,monospace]`}
              value={effective}
              onChange={(event) => change(event.target.value.replace('#', '').toUpperCase())}
            />
          </>
        ) : isText ? (
          <input className={controlClass} value={effective} onChange={(event) => change(event.target.value)} />
        ) : (
          <TooltipTarget text={optionTip(field, effective)}>
            <select className={controlClass} value={effective} onChange={(event) => change(event.target.value)}>
              {field.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {proofingChoiceLabel(field.key, choice)}
                </option>
              ))}
            </select>
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
