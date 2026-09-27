import { describe, expect, it } from 'vitest';
import { deliveryHash, parseDeliveryHash } from './deliveryLink';

describe('deliveryLink', () => {
  it('round-trips a file and a rule through the Delivery page anchor, whatever the path holds', () => {
    const focus = { file: 'C:\\Books\\Alice & Bob\\Chapter #1 (final).wav', rule: 'acx.rms' };
    expect(parseDeliveryHash(deliveryHash(focus))).toEqual(focus);
    expect(parseDeliveryHash(deliveryHash({ file: 'C:/a.wav' }))).toEqual({ file: 'C:/a.wav' });
  });

  it('reads no focus from an anchor that names no file', () => {
    expect(parseDeliveryHash('')).toBeUndefined();
    expect(parseDeliveryHash('#rule=acx.rms')).toBeUndefined();
    expect(parseDeliveryHash('#measurements')).toBeUndefined();
  });
});
