import { isWireError } from './wire/WireError';

/**
 * The text a narrator reads for a failed API call. A payload that did not match its schema says so in plain words (the technical
 * text is in the host log and behind "Copy details"); any other failure keeps the text it always had (ADR 0069).
 */
export function describeApiError(error: unknown): string {
  return isWireError(error) ? error.userMessage : String(error);
}

/** The same for the places that show an error's bare message, without the "Error: " prefix `String(error)` adds. */
export function apiErrorMessage(error: unknown): string {
  if (isWireError(error)) return error.userMessage;
  return error instanceof Error ? error.message : String(error);
}
