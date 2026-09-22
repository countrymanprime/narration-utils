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

// N3: only these kinds are worth an OS notification (Story Bible build, model/voice downloads, Transcript Compare, import). A
// manuscript import that also chains a Story Bible build (D8) still only notifies through its own story_bible job:ended event;
// a fast import stays quiet on its own account like everything else here.
const NOTIFIABLE_JOB_KINDS = new Set(['story_bible', 'tts_install', 'whisper_install', 'spacy_install', 'transcript_compare', 'manuscript_import']);

/** N3: fast jobs stay quiet so a notification means something. */
export const NOTIFY_THRESHOLD_MS = 10_000;

/**
 * Whether a host job ending is worth an OS notification (N1-N4). `focused` is `document.hasFocus()`: the host has no
 * way to know this (N1, no focus query in the Wails v2.16 host API), so the decision is made here, in the webview,
 * every time a job ends. A narrator watching the job does not need an OS notification about it (N1); a job the
 * narrator cancelled was not "finished" in a way worth telling them about elsewhere; and a job that took under 10s
 * would just be noise (N3).
 */
export function shouldNotifyForJobEnd(event: JobEnded, focused: boolean): boolean {
  if (focused) return false;
  if (event.outcome === 'cancelled') return false;
  if (!NOTIFIABLE_JOB_KINDS.has(event.kind)) return false;
  return event.durationMs >= NOTIFY_THRESHOLD_MS;
}

/** The title and body for the OS notification `shouldNotifyForJobEnd` approved. */
export function notificationForJobEnd(event: JobEnded): { title: string; body: string } {
  if (event.outcome === 'error') return { title: 'Task failed', body: event.message || 'A background task failed.' };
  return { title: 'Task finished', body: event.message || 'A background task finished.' };
}
