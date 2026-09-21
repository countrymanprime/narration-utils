import type { JobEnded } from './api/contracts/system';
import type { ToastTone } from './components/primitives/Toast';

// Kinds whose own dialog is on screen while the job runs and is modal, so the narrator is still looking at it when it ends and it
// says so itself (the import, the downloads, the update). The event still reaches every listener (the notification work reads
// it); the app-level toast is for the jobs that can finish while the narrator is somewhere else.
const SHOWN_BY_THEIR_DIALOG = new Set(['manuscript_import', 'tts_install', 'whisper_install', 'app_update']);

/** What the app says when a host job ends, or nothing when the narrator does not need telling (they cancelled it, or its dialog says so). */
export function toastForJobEnd(event: JobEnded): { text: string; tone: ToastTone } | undefined {
  if (event.outcome === 'cancelled' || SHOWN_BY_THEIR_DIALOG.has(event.kind)) return undefined;
  if (event.outcome === 'error') return { text: event.message || 'A background task failed.', tone: 'error' };
  return { text: event.message || 'A background task finished.', tone: 'info' };
}
