import { describe, expect, it } from 'vitest';
import { MOCK_ACX, mockCustomProfile } from '../../api/deliveryProfilesMock';
import type { DeliveryRule } from '../../types';
import { formatLength, formatLevel } from './deliveryFormat';
import { deliveryProfileKey, deliveryProfileTitle, describeCheck, describeMiss, formatBound, formatRuleValue, profileCounts } from './deliveryProfile';
import { ruleColumns } from './MeasurementsTable';

const rule = (id: string): DeliveryRule => {
  const found = MOCK_ACX.rules.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no rule ${id}`);
  return found;
};

describe('naming a profile', () => {
  it('names a built-in by its platform and the month its page was read, a custom profile by its own name', () => {
    expect(deliveryProfileTitle(MOCK_ACX)).toBe('ACX (September 2026)');
    expect(deliveryProfileKey(MOCK_ACX)).toBe('acx@2026-09');
    const custom = mockCustomProfile();
    expect(deliveryProfileTitle(custom)).toBe('My ACX, tighter peak');
    expect(deliveryProfileKey(custom)).toBe('custom-0123456789abcdef@r3');
  });

  it('counts the rules the app checks, does not check, leaves to listening and has yet to verify', () => {
    expect(profileCounts(MOCK_ACX)).toEqual({ checked: 8, notChecked: 3, listen: 2, off: 0, toVerify: 5, conflicting: 1 });
    expect(profileCounts(mockCustomProfile()).off).toBe(2);
  });
});

describe('writing a rule', () => {
  it('writes each bound in the rule’s own unit', () => {
    expect(formatBound(rule('acx.rms'))).toBe('−23 to −18 dBFS');
    expect(formatBound(rule('acx.peak'))).toBe('≤ −3 dBFS');
    expect(formatBound(rule('acx.sample_rate'))).toBe('44.1 kHz');
    expect(formatBound(rule('acx.file_length'))).toBe('≤ 120 min');
    expect(formatBound(rule('acx.format'))).toBe('192 kbps+ CBR');
    expect(formatBound(rule('acx.channels'))).toBe('mono or stereo, the same in every file');
    expect(formatBound(rule('acx.room_tone_head'))).toBe('0.5 to 5 s');
  });

  it('writes a value the way its column reads, and how a missed value missed', () => {
    expect(formatRuleValue(rule('acx.rms'), -24.13)).toBe('−24.1');
    expect(formatRuleValue(rule('acx.sample_rate'), 48000)).toBe('48 kHz');
    expect(formatRuleValue(rule('acx.file_length'), 2092)).toBe('34:52');
    expect(describeMiss(rule('acx.rms'), { ruleId: 'acx.rms', status: 'not_met', value: -24.1, violation: 'below_min' }, "ACX's")).toBe(
      "below ACX's −23 minimum",
    );
    expect(describeMiss(rule('acx.sample_rate'), { ruleId: 'acx.sample_rate', status: 'not_met', value: 48000, violation: 'not_one_of' }, "ACX's")).toBe(
      'not 44.1 kHz',
    );
  });

  it('says how the app checks each rule, and never reads a rule it cannot check as measured', () => {
    expect(describeCheck(rule('acx.rms'))).toBe('Measured: −23 to −18 dBFS');
    expect(describeCheck(rule('acx.room_tone_tail'))).toBe('Measured: 1 to 5 s');
    expect(describeCheck(rule('acx.credits'))).toBe('Not checked by the app.');
    expect(describeCheck(rule('acx.format'))).toMatch(/check the MP3 you upload/);
    expect(describeCheck(rule('acx.consistency'))).toBe('Listen');
    expect(describeCheck({ ...rule('acx.rms'), off: true })).toMatch(/^Off/);
  });

  it('lays the file rules out as columns, room tone at the head and tail in one', () => {
    expect(ruleColumns(MOCK_ACX).map((column) => [column.label, column.sub])).toEqual([
      ['RMS', '−23 to −18 dBFS'],
      ['Peak', '≤ −3 dBFS'],
      ['Noise floor', '≤ −60 dBFS'],
      ['Sample rate', '44.1 kHz'],
      ['File length', '≤ 120 min'],
      ['Room tone', 'head · tail'],
      ['MP3 format', '192 kbps+ CBR'],
    ]);
  });
});

describe('formatting', () => {
  it('writes a level with one decimal and a real minus sign', () => {
    expect(formatLevel(-19.44)).toBe('−19.4');
    expect(formatLevel(0)).toBe('0.0');
  });

  it('writes a length as minutes and seconds, or hours when it is that long', () => {
    expect(formatLength(2)).toBe('0:02');
    expect(formatLength(1843.5)).toBe('30:43');
    expect(formatLength(3725)).toBe('1:02:05');
  });
});
