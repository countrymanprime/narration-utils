// Stories that must get a fresh page load for every theme/viewport variant even though they have no play() function
// (ADR: atlas groups a story's variants into one page load, switching theme and resizing instead of reloading -
// see docs/adr/README.md). This is an escape hatch, not a default: an entry here means the side-by-side diff this
// phase's PR ran found the story rendering differently after a switch than after a fresh load, so it opts back into
// the old, safe-but-slower behaviour. Each entry needs a reason; the list may only grow when a real difference is
// found, never as a guess.
export const RELOAD_DEBT: string[] = [];
