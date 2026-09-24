// How the Delivery page writes a measured value (diagnostics-delivery-and-cleanup-tools.prd.md Phase 5): a level to one decimal
// with a typographic minus, and a duration as m:ss or h:mm:ss.

/** A level as the page writes it: one decimal, with a typographic minus so a column of negatives reads cleanly. */
export function formatLevel(value: number): string {
  return value.toFixed(1).replace('-', '−');
}

/** A duration as m:ss, or h:mm:ss from an hour up. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = (whole % 60).toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}
