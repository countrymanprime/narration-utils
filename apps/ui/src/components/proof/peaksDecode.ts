import type { WorkspacePeaks } from '../../api/contracts/workspace';

/** Decodes a WorkspacePeaks' base64 minMax into its two's-complement signed bytes (measure.Peaks, Go host): index
 * 2*k and 2*k+1 are bucket k's minimum and maximum, each in -127..127. */
export function decodeMinMax(peaks: Pick<WorkspacePeaks, 'minMax'>): Int8Array {
  const binary = atob(peaks.minMax);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int8Array(bytes.buffer);
}

/** The bucket covering `fraction` (0..1) of decoded's buckets: its minimum and maximum, each -127..127. [0, 0] for
 * an empty decode (no buckets), so a caller can always draw something rather than branch on emptiness. */
export function bucketAt(decoded: Int8Array, buckets: number, fraction: number): readonly [number, number] {
  if (buckets <= 0) return [0, 0];
  const index = Math.max(0, Math.min(buckets - 1, Math.floor(fraction * buckets)));
  return [decoded[2 * index], decoded[2 * index + 1]];
}
