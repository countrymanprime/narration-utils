import type { NumberSettingRange } from '../../api/contracts/system';

// The page's copy of the host's number check (apps/desktop/settings_number.go): a plain decimal, in range, on step. The
// host still validates every save; this only lets the row say what is wrong before Save is pressed.
const PLAIN_NUMBER = /^-?(\d+(\.\d*)?|\.\d+)$/;
const STEP_TOLERANCE = 1e-9;

const withUnit = (value: number, unit: string) => (unit ? `${value} ${unit}` : `${value}`);

function rangeWords({ min, max, unit }: NumberSettingRange): string {
  if (min !== null && max !== null) return `from ${min} to ${withUnit(max, unit)}`;
  if (min !== null) return `at least ${withUnit(min, unit)}`;
  if (max !== null) return `at most ${withUnit(max, unit)}`;
  return '';
}

/** The range in words, like "From -60 to 0 dBTP", or '' when the field is unbounded. */
export function describeNumberRange(range: NumberSettingRange): string {
  const words = rangeWords(range);
  return words && words[0].toUpperCase() + words.slice(1);
}

/** Why `text` cannot be saved in a number field with `range`, or undefined when it can. Empty text is "not set", which is valid. */
export function numberProblem(range: NumberSettingRange, text: string): string | undefined {
  if (text === '') return undefined;
  const value = Number(text);
  if (!PLAIN_NUMBER.test(text) || !Number.isFinite(value)) return 'Enter a number, like -3 or 0.5.';
  if ((range.min !== null && value < range.min) || (range.max !== null && value > range.max)) return `Enter a value ${rangeWords(range)}.`;
  if (range.step !== null) {
    const steps = (value - (range.min ?? 0)) / range.step;
    if (Math.abs(steps - Math.round(steps)) > STEP_TOLERANCE * Math.max(1, Math.abs(steps))) return `Use steps of ${range.step}.`;
  }
  return undefined;
}
