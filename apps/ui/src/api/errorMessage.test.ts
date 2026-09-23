import { describe, expect, it } from 'vitest';
import { apiErrorMessage, describeApiError } from './errorMessage';
import { WireError } from './wire/WireError';

const wireError = new WireError('host.binding', 'Bootstrap', [{ path: 'projectName', message: 'expected string' }]);

describe('describeApiError', () => {
  it('uses the WireError user message, not its technical details', () => {
    expect(describeApiError(wireError)).toBe('The app received data it could not read.');
  });

  it('falls back to String(error) for anything that is not a WireError', () => {
    expect(describeApiError(new Error('boom'))).toBe('Error: boom');
    expect(describeApiError('plain string failure')).toBe('plain string failure');
  });
});

describe('apiErrorMessage', () => {
  it('uses the WireError user message', () => {
    expect(apiErrorMessage(wireError)).toBe('The app received data it could not read.');
  });

  it('uses a bare Error message, without the "Error: " prefix', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to String(error) for anything that is neither a WireError nor an Error', () => {
    expect(apiErrorMessage('plain string failure')).toBe('plain string failure');
    expect(apiErrorMessage(42)).toBe('42');
  });
});
