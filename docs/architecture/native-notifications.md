# Native notifications

A Windows OS notification for a long job that finished while the narrator was looking at something else, alongside
the in-app toast queue ([interaction feedback](interaction-feedback.md)), never instead of it. Delivered by the
story-bible-and-import-ux-briefs PRD's N brief (phases 1-2); this page replaces that PRD (see its Open Questions
N1-N4 for the decisions' own reasoning) now that the PRD is deleted.

## The path

1. The webview owns "is the narrator looking": `App.tsx`'s `subscribeJobEnded` handler reads `document.hasFocus()`
   fresh on every `job:ended` event, since Wails v2.16 has no window-focus query on the host side.
2. `apps/ui/src/jobEnded.ts`'s `shouldNotifyForJobEnd` decides whether this particular completion qualifies: the
   setting is on (`General.notifications`), the window is unfocused, the job is one of the notifying kinds
   (`story_bible`, `tts_install`, `whisper_install`, `spacy_install`, `transcript_compare`, `manuscript_import`), and
   it ran at least 10 seconds (`NOTIFY_THRESHOLD_MS`).
3. A qualifying completion calls `Host.SystemNotify` (`hostAPIVersion` 14), which wraps Wails's own cross-platform
   notification API. `apps/desktop/notifications.go` initializes the underlying Wails notification service lazily,
   only on the first send while the setting is on — Windows notification support writes a per-user registry key on
   initialize, so a narrator who never enables the setting never gets one written.
4. A send failure is swallowed on the host side and never blocks or fails the job it describes: the toast is the
   record of truth for whether a job finished, the OS notification is a convenience for the case the narrator was not
   watching.

## Decisions worth remembering

- **On by default** (owner decision D8), opt-out in `General.notifications`. Wails needs no OS consent prompt on
  Windows.
- **A manuscript import that chains a Story Bible build** ([story-bible-concurrent-build.md](story-bible-concurrent-build.md))
  notifies only through the build's own `job:ended` event, once the build itself clears the threshold; a fast import
  stays quiet on its own account like anything else under 10 seconds.
- **Windows-only, plain title and body.** No action buttons, categories, reply fields, or macOS/Linux behavior.
- **Toast identity** on a dev build shows the executable's base name, not "Narration Studio"; the installed build is
  an owner verification step (was tracked on issue #280, which this PRD's phases closed).

## Tests

Vitest: `apps/ui/src/jobEnded.test.ts` (the threshold, the kinds, `document.hasFocus` stubbed both ways). Go:
`apps/desktop/notifications_test.go` (a fake sender, lazy initialization, a send error never surfacing to the
caller).
