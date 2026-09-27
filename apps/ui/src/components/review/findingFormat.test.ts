import { describe, expect, it } from 'vitest';
import { WIRE_FINDINGS, WIRE_TAKE_REVIEW_FINDINGS } from '../../api/mockFixtures';
import { FINDING_CATEGORIES } from '../../api/contracts/findings';
import type { Finding } from '../../types';
import { analyzerLabel, categoryLabel, chapterLabel, confidenceLabel, evidenceRows, findingSummary, formatDecidedAt, formatTime } from './findingFormat';

/** A delivery finding as the host saves it for the Review page (tests/fixtures/contracts/findings-list-delivery-qc.json). */
const deliveryFinding = (evidence: Record<string, unknown>): Finding => ({
  schema_version: 1,
  id: 'delivery-1',
  analyzer: 'measure',
  project: { path: 'C:/Projects/Alice' },
  source: { file: 'C:/Projects/Alice/renders/Chapter 01.wav' },
  category: 'delivery_qc',
  severity: 'error',
  confidence: 1,
  confidence_reason: 'deterministic measurement of the decoded samples',
  evidence: { profile: 'acx@2026-09', profile_name: 'ACX (September 2026)', ...evidence },
  evidence_version: 'sha256:1',
  review: { status: 'unreviewed' },
});

describe('findingFormat', () => {
  it('words every documented category, and a newer one as words rather than an identifier', () => {
    for (const category of FINDING_CATEGORIES) expect(categoryLabel(category)).not.toContain('_');
    expect(categoryLabel('breath_noise')).toBe('Breath noise');
    expect(analyzerLabel('room-tone-check')).toBe('Room tone check');
    expect(analyzerLabel('measure')).toBe('Delivery measurement');
  });

  it('shows a score as a percentage and no score as no score', () => {
    expect(confidenceLabel(0.9)).toBe('90%');
    expect(confidenceLabel(0)).toBe('0%');
    expect(confidenceLabel(null)).toBe('No score');
  });

  it('formats project time as minutes and tenths of a second', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(12.44)).toBe('0:12.4');
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(754.25)).toBe('12:34.3');
  });

  it('sums up a finding by what was expected and what was heard', () => {
    const [misread, skipped, extra, entity] = WIRE_FINDINGS;
    expect(findingSummary(misread)).toBe('“a White Rabbit with pink eyes” read as “a white rabbit with pale eyes”');
    expect(findingSummary(skipped)).toBe('“Oh dear!” not heard');
    expect(findingSummary(extra)).toBe('“and then” heard, not in the script');
    expect(findingSummary(entity)).toBe('“White Rabbit”');
    expect(findingSummary({ ...entity, manuscript: undefined })).toBe('Story Bible entry');
  });

  it('lists the evidence it knows how to word, in reading order, and leaves the rest out', () => {
    expect(evidenceRows(WIRE_FINDINGS[2])).toEqual([
      { label: 'Kind', value: 'Extra words' },
      { label: 'Script', value: 'Curiouser and curiouser!' },
      { label: 'Recording', value: 'Curiouser and then curiouser!' },
      { label: 'Existing REAPER marker', value: 'TAKE 2' },
    ]);
    expect(evidenceRows({ ...WIRE_FINDINGS[0], evidence: { kind: 'SWAPPED', marker_state: 'pending', timing_gap_seconds: 'n/a' } })).toEqual([
      { label: 'Kind', value: 'Swapped' },
    ]);
  });

  it('sums up a take-review group by its kind, its reads and the script span they cover', () => {
    const [pickup, duplicate] = WIRE_TAKE_REVIEW_FINDINGS;
    expect(findingSummary(pickup)).toBe('Partial pickup: 2 reads of sentences 4–8');
    expect(findingSummary(duplicate)).toBe('Near duplicate: 2 reads of sentences 13–16');
    expect(evidenceRows(pickup)).toEqual([
      { label: 'Kind', value: 'Partial pickup' },
      { label: 'In the script', value: 'Sentences 4–8' },
      { label: 'Reads', value: '2' },
    ]);
  });

  it('words take-review evidence that does not match its schema generically, never as reads', () => {
    const [pickup] = WIRE_TAKE_REVIEW_FINDINGS;
    const broken = { ...pickup, evidence: { kind: 'restart', members: 'lost' } };
    expect(findingSummary(broken)).toBe('Pickup');
    expect(evidenceRows(broken)).toEqual([{ label: 'Kind', value: 'Restart' }]);
  });

  it('shows a decision time that is not a date as it came', () => {
    expect(formatDecidedAt(undefined)).toBeUndefined();
    expect(formatDecidedAt('yesterday')).toBe('yesterday');
    expect(formatDecidedAt('2026-09-21T10:00:00Z')).toMatch(/2026/);
  });

  it('words a delivery finding by its rule, its value and how it missed, in the file it is about', () => {
    const rms = deliveryFinding({
      rule: 'acx.rms',
      rule_label: 'RMS',
      metric: 'rms_dbfs',
      unit: 'dBFS',
      value: -24.1,
      violation: 'below_min',
      limit_min: -23,
      limit_max: -18,
      requirement: 'Each file measures between -23 dB and -18 dB RMS.',
    });
    expect(findingSummary(rms)).toBe('RMS −24.1 dBFS, below the minimum of −23');
    expect(chapterLabel(rms)).toBe('Chapter 01.wav');
    expect(evidenceRows(rms)).toEqual([
      { label: 'Rule', value: 'RMS' },
      { label: 'Requirement', value: 'Each file measures between -23 dB and -18 dB RMS.' },
      { label: 'Measured', value: '−24.1 dBFS' },
      { label: 'Judged against', value: 'ACX (September 2026)' },
    ]);
    const peak = deliveryFinding({
      rule: 'acx.peak',
      rule_label: 'Peak',
      metric: 'sample_peak_dbfs',
      unit: 'dBFS',
      value: -2.4,
      violation: 'above_max',
      limit_max: -3,
    });
    expect(findingSummary(peak)).toBe('Peak −2.4 dBFS, above the maximum of −3');
    const rate = deliveryFinding({
      rule: 'acx.sample_rate',
      rule_label: 'Sample rate',
      metric: 'sample_rate',
      unit: 'Hz',
      value: 48000,
      violation: 'not_one_of',
      allowed: [44100],
    });
    expect(findingSummary(rate)).toBe('Sample rate 48 kHz, not 44.1 kHz');
    const floor = deliveryFinding({ rule: 'acx.noise_floor', rule_label: 'Noise floor', metric: 'noise_floor_dbfs', unit: 'dBFS', available: false });
    expect(findingSummary(floor)).toBe('Noise floor could not be measured');
    expect(evidenceRows(floor)).toContainEqual({ label: 'Measured', value: 'Could not be measured' });
    const format = deliveryFinding({
      rule: 'acx.format',
      rule_label: 'MP3 format',
      metric: 'mp3_format',
      unit: 'kbps',
      value: 176,
      violation: 'not_cbr',
      limit_min: 192,
    });
    expect(findingSummary(format)).toBe('MP3 format 176 kbps, not a constant bit rate');
    // A delivery finding saved before its rule was named on it still reads as its rule id, never as nothing.
    expect(findingSummary(deliveryFinding({ rule: 'acx.rms', metric: 'rms_dbfs', value: -24.1, violation: 'below_min', limit_min: -23 }))).toBe(
      'acx.rms −24.1, below the minimum of −23',
    );
  });
});
