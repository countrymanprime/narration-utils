import { describe, expect, it } from 'vitest';
import { describeNumberRange, numberProblem } from './numberSetting';

const PEAK = { min: -60, max: 0, step: 0.1, unit: 'dBTP' };
const COUNT = { min: 0, max: null, step: 1, unit: 'words' };
const FREE = { min: null, max: null, step: null, unit: '' };

describe('numberProblem', () => {
  it('accepts a plain decimal in range and on step, and empty text (not set)', () => {
    for (const text of ['-3.5', '-60', '0', '-0.1', '-2.3', '']) expect(numberProblem(PEAK, text)).toBeUndefined();
    expect(numberProblem(COUNT, '3')).toBeUndefined();
    expect(numberProblem(FREE, '123456.789')).toBeUndefined();
  });

  it('refuses what the host refuses: words, units, exponents, spaces, a plus sign, a comma decimal', () => {
    for (const text of ['loud', '-3 dB', '-3e0', ' -3', '+1', '-3,5', 'Infinity', 'NaN', '-']) {
      expect(numberProblem(PEAK, text)).toBe('Enter a number, like -3 or 0.5.');
    }
  });

  it('names the range, with its unit, for a value outside it', () => {
    expect(numberProblem(PEAK, '0.5')).toBe('Enter a value from -60 to 0 dBTP.');
    expect(numberProblem(COUNT, '-1')).toBe('Enter a value at least 0 words.');
  });

  it('names the step for a value between steps', () => {
    expect(numberProblem(PEAK, '-3.25')).toBe('Use steps of 0.1.');
    expect(numberProblem(COUNT, '2.5')).toBe('Use steps of 1.');
  });
});

describe('describeNumberRange', () => {
  it('describes each shape of range, and nothing for an unbounded one', () => {
    expect(describeNumberRange(PEAK)).toBe('From -60 to 0 dBTP');
    expect(describeNumberRange(COUNT)).toBe('At least 0 words');
    expect(describeNumberRange({ ...FREE, max: 1 })).toBe('At most 1');
    expect(describeNumberRange(FREE)).toBe('');
  });
});
