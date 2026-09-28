import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnosticsJobSchema } from '../../api/schemas/diagnostics';
import type { Finding } from '../../types';
import { MOCK_DIAGNOSTICS_THRESHOLDS } from '../../api/diagnosticsMock';
import { findingKindLabel, measuredText, sourceKindLabel, thresholdRows, thresholdText, timeRangeText } from './diagnosticsFormat';

// The host's own findings (bindings_diagnostics_contract_test.go), so the wording is tested against what the host sends.
const pinned = diagnosticsJobSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'tests', 'fixtures', 'contracts', 'diagnostics-success.json'), 'utf8')),
);
const [clip, shift, roomTone] = pinned.files[0].findings;

const pause: Finding = {
  ...clip,
  id: 'pause',
  category: 'pacing',
  severity: 'info',
  time_range: { start: 95.5, end: 98.75 },
  evidence: { kind: 'long_pause', source_kind: 'raw_recording', duration_seconds: 3.25, long_pause_seconds: 2, min_pause_seconds: 0.3 },
};

describe('diagnostics wording', () => {
  it('names each kind of finding, and an unknown kind as words', () => {
    expect([clip, shift, roomTone, pause].map(findingKindLabel)).toEqual(['Clipping', 'Level shift', 'Room-tone change', 'Long pause']);
    expect(findingKindLabel({ ...clip, evidence: { kind: 'mouth_noise' } })).toBe('Mouth noise');
  });

  it('says what was measured, with units, and the direction of a change', () => {
    expect(measuredText(clip)).toBe('Longest run 9 samples, channel 1');
    expect(measuredText(shift)).toBe('−19.5 to −25.3 LUFS (−5.8 LU)');
    expect(measuredText(roomTone)).toBe('−68.5 to −60.3 dBFS (+8.3 dB)');
    expect(measuredText(pause)).toBe('3.3 s between words');
    expect(measuredText({ ...clip, evidence: { kind: 'clipping', source_kind: 'processed_render', longest_run_samples: 4, channels: [1, 2] } })).toBe(
      'Longest run 4 samples, channels 1 and 2',
    );
  });

  it('says the threshold that raised each finding, from the finding itself', () => {
    expect(thresholdText(clip)).toBe('At or above full scale (0.0 dBFS), in runs of 3 or more samples');
    expect(thresholdText({ ...clip, evidence: { ...clip.evidence, ceiling_dbfs: -1 } })).toBe('At or above −1.0 dBFS, in runs of 3 or more samples');
    expect(thresholdText(shift)).toBe('A change of 4.0 LU or more');
    expect(thresholdText(roomTone)).toBe('A change of 6.0 dB or more between silences');
    expect(thresholdText(pause)).toBe('2.0 s or longer');
  });

  it('says what it cannot word instead of guessing', () => {
    const unknown = { ...clip, evidence: { kind: 'mouth_noise' } };
    expect(measuredText(unknown)).toBe('Not described here');
    expect(thresholdText(unknown)).toBe('Not described here');
    expect(measuredText({ ...shift, evidence: { kind: 'level_shift' } })).toBe('Not described here');
  });

  it('times a finding in the file, and a very short one by its length', () => {
    expect(timeRangeText(shift)).toBe('15:05.0 – 15:06.0');
    expect(timeRangeText(clip)).toBe('10:12.3 (63 ms)');
    expect(timeRangeText({ ...clip, time_range: undefined })).toBe('No time');
  });

  it('names the source kind the narrator chose', () => {
    expect(sourceKindLabel('processed_render')).toBe('Rendered chapter');
    expect(sourceKindLabel('raw_recording')).toBe('Raw recording');
  });

  it('lists every threshold a check uses with its unit', () => {
    expect(thresholdRows(MOCK_DIAGNOSTICS_THRESHOLDS)).toEqual([
      { label: 'Clipping', value: 'At or above full scale (0.0 dBFS), in runs of 3 or more samples' },
      { label: 'Silence', value: 'Below −50.0 dBFS for 0.3 s or longer' },
      { label: 'Level shift', value: 'A change of 4.0 LU or more' },
      { label: 'Room-tone change', value: 'A change of 6.0 dB or more between silences' },
      { label: 'Long pause', value: '2.0 s or longer, only from transcript timing' },
    ]);
  });
});
