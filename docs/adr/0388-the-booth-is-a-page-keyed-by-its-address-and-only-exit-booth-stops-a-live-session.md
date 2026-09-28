# 0388. The Booth is a page keyed by its address, and only Exit booth stops a live session

**Status:** Proposed
**Date:** 2026-09-27

## Context

[Stage Navigation and Page Replacement](../prds/stage-navigation-and-page-replacement.prd.md) Phase 4 replaces the Teleprompter page, the Manuscript's Read aloud dialog and its booth dialog with one Booth page at `/booth` ([ADR 0407](0407-a-new-page-replaces-its-old-counterpart-in-the-same-change-and-the-navigation-is-grouped-by-production-stage.md)). The three surfaces differed on two things the PRD does not settle:

- **What a surface reads.** The dialog was opened already pointed at one chapter (or the credits); the page had a picker that opened on REAPER's suggested chapter ([ADR 0113](0113-the-teleprompter-suggests-a-chapter-from-the-saved-armed-track-and-preselects-only-a-confident-match.md)) or the last chapter read.
- **Leaving during a live session.** The dialog was modal: closing it (the Close button or Escape) asked "Stop reading?" and stopped the session, so a live microphone never outlived it. The page could be left through the nav at any time, and the session kept running in the host; coming back picked it up.

On a page inside the app shell, the nav, Back and the mouse's back button are always reachable, so the Booth cannot be modal the way the dialog was.

## Decision

1. **The address says what the Booth reads.** `/booth?chapter=<id>` or `/booth?credits=opening|closing`; with neither, it opens on REAPER's confident suggestion, else the last chapter read (the old page's rule). A Manuscript card's "Record in Booth" links to it (the PRD's Q9), choosing in the picker replaces the query rather than pushing an entry, and `/teleprompter` redirects here with its query and hash. The page mounts one `BoothSession` keyed by what it reads, so the one `useTeleprompterSession` subscription is never doubled and a new chapter starts clean.
2. **Exit booth and Escape keep the dialog's rule.** Both ask "Stop reading?" while a session is active and stop it (and a REAPER recording this app started) on confirm. Escape is heard on the Booth's own root, not as a registry command, because the router's target guard would drop it whenever focus sits on a button such as Play.
3. **Leaving by the nav, Back or a new chapter keeps the old page's rule.** The session keeps running in the host and the Booth picks it up on return; the flags the session raised so far are kept as findings as the Booth unmounts.

## Consequences

- Deep links, Back and the Script cards all land on the same chapter, and no state outside the address decides it.
- A narrator who leaves through the nav while listening leaves the microphone live until they come back and stop it, as on the old Teleprompter page. Whether that should instead ask, or stop, is the owner's call (asked on #510); changing it is a guard in `App.tsx`'s `guardedNavigate` like the unsaved-Settings one.
- Flags raised after the Booth was left, and before the session ends, are not kept (the old page never kept flags at all).
