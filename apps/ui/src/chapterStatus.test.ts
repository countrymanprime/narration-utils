// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { STATUS_ORDER, STATUS_TONE } from './chapterStatus';
import type { StatusTone } from './components/primitives/StatusBadge';

const TONES: readonly StatusTone[] = ['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental'];

describe('STATUS_TONE', () => {
  it("gives every chapter status a tone from StatusBadge's closed set", () => {
    for (const status of STATUS_ORDER) {
      expect(TONES).toContain(STATUS_TONE[status]);
    }
  });

  it('maps the two ends of the pipeline to neutral and success, and the middle stages to progress', () => {
    expect(STATUS_TONE.not_started).toBe('neutral');
    expect(STATUS_TONE.finalized).toBe('success');
    expect(STATUS_TONE.recording).toBe('progress');
    expect(STATUS_TONE.editing).toBe('progress');
    expect(STATUS_TONE.proofing).toBe('progress');
  });
});
