import { describe, expect, it } from 'vitest';
import { bucketAt, decodeMinMax } from './peaksDecode';

// Two buckets: [-64, 64] then [-127, 127] (measure.Peaks' own byte layout, apps/desktop/internal/measure/peaks.go).
const bytes = new Int8Array([-64, 64, -127, 127]);
const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.buffer)));

describe('decodeMinMax', () => {
  it('round-trips signed bytes through base64', () => {
    expect(Array.from(decodeMinMax({ minMax: base64 }))).toEqual([-64, 64, -127, 127]);
  });
});

describe('bucketAt', () => {
  const decoded = decodeMinMax({ minMax: base64 });

  it('picks the bucket a fraction falls into', () => {
    expect(bucketAt(decoded, 2, 0)).toEqual([-64, 64]);
    expect(bucketAt(decoded, 2, 0.5)).toEqual([-127, 127]);
    expect(bucketAt(decoded, 2, 0.99)).toEqual([-127, 127]);
  });

  it('clamps a fraction at or past 1', () => {
    expect(bucketAt(decoded, 2, 1)).toEqual([-127, 127]);
  });

  it('answers [0, 0] with no buckets', () => {
    expect(bucketAt(decoded, 0, 0.5)).toEqual([0, 0]);
  });
});
