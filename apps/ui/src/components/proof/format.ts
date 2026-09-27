/** The transport's elapsed readout: minutes:seconds.tenths (the mockup's "6:52.4"), so a narrator can see the app
 * clock move between whole-second `timeupdate` ticks. */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  const tenths = Math.floor((seconds - whole) * 10);
  return `${minutes}:${remaining.toString().padStart(2, '0')}.${tenths}`;
}

/** The transport's duration readout: minutes:seconds, no tenths (the mockup's "11:48"). */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}
