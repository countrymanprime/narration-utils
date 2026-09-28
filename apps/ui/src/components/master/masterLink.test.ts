import { describe, expect, it } from 'vitest';
import { masterHash, parseMasterHash } from './masterLink';

describe('masterLink', () => {
  it('round-trips a file and a rule through the Master & QC anchor, whatever the path holds', () => {
    const focus = { file: 'C:\\Books\\Alice & Bob\\Chapter #1 (final).wav', rule: 'acx.rms' };
    expect(parseMasterHash(masterHash(focus))).toEqual(focus);
    expect(parseMasterHash(masterHash({ file: 'C:/a.wav' }))).toEqual({ file: 'C:/a.wav' });
  });

  it('reads no focus from an anchor that names no file', () => {
    expect(parseMasterHash('')).toBeUndefined();
    expect(parseMasterHash('#rule=acx.rms')).toBeUndefined();
    expect(parseMasterHash('#measurements')).toBeUndefined();
  });
});
