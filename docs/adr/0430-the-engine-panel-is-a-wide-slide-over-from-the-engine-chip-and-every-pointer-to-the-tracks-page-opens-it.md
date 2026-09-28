# 0430. The engine panel is a wide slide-over from the engine chip, and every pointer to the Tracks page opens it

**Status:** Proposed
**Date:** 2026-09-28

## Context

Stage navigation and page replacement (`docs/prds/stage-navigation-and-page-replacement.prd.md`, delivered and deleted) Phase 6 retires the Tracks page ([ADR 0407](0407-a-new-page-replaces-its-old-counterpart-in-the-same-change-and-the-navigation-is-grouped-by-production-stage.md)). Its Q3 answer puts what the page held that is about REAPER rather than a stage (the linked `.rpp`, the track list with its chapter links and chapter sync's activity, and the REAPER tools) in an **engine panel**, "a slide-over opened from the engine chip on any page". Its Q8 answer redirects `/tracks` to `/proof`. Two things were left open:

- **Width.** `SlideOver` has one width, `min(20rem, 100vw)` ([ADR 0051](0051-the-slide-over-and-the-navigation-drawer-are-modal-base-ui-drawers.md) kept it). That fits a detail view (a chapter's track, a word's look-up), not the Chapter links table (a chapter, its status, Open workspace, Editing check and a track picker per row) or chapter sync's Needs you rows with their pickers, which the Tracks page drew at up to 48rem. At 20rem those overflow sideways, which the visual suite fails.
- **Where the old pointers go.** Many places told the narrator to go to the Tracks page ("Open Tracks", "on the Tracks page"): stage causes, the editing check, the recording check, the read-aloud resume notice, Proof's chapter view, Pickups, the sync consent dialog, and the host's own refusal messages. A redirect to `/proof` alone would land every one of them on the wrong screen.

## Decision

1. **`SlideOver` gains `size="wide"`, `min(44rem, 100vw)`**, beside the default 20rem, **and `headingLevel` 2** beside the default `<h3>` title (`apps/ui/src/components/primitives/SlideOver.tsx`, a `Wide` story). A wide panel holds what a page used to; a detail view keeps the default width. The level is for a panel that opens over any page rather than from inside one of its sections: over Proof, whose only heading is its `<h1>`, an `<h3>` title skips a level (axe `heading-order`, which the visual suite gates). Nothing else about the primitive changes: it is still the modal Base UI drawer ADR 0051 describes, and every existing slide-over keeps its width and its `<h3>`.
2. **The engine panel is one `EnginePanel` (`components/engine/`), owned by `App.tsx`,** titled "Audio engine", opened by the header's engine chip (its click no longer runs the link action itself; the panel's "Link a REAPER project file" button does) and closed by a move to another page (a link inside it, such as Open workspace). It loads nothing until it opens.
3. **Every pointer that sent the narrator to the Tracks page opens the panel instead**, through one `EnginePanelLink` ("Open the audio engine panel") that reads the opener from a React context (`EnginePanelContext.tsx`), and the text says "in the audio engine panel", in the UI and in the host's refusal messages alike. (Home's and the Booth's own "Open Tracks" links belong to the phases rebuilding those pages; until they are rewritten they reach the panel through the redirect below.)
4. **`/tracks` lands on `/proof` (Q8 A), query and hash kept, with the panel open over it** (`RetiredTracksRoute`), so an old bookmark, and any link not yet rewritten, reaches both the chapter player and the tools.

## Consequences

- The panel's tables and pickers fit at every captured width, and a narrow window gets the whole screen (the `100vw` cap), as the default slide-over already does.
- A new wide slide-over is a caller choosing `size="wide"`, not a new primitive; a third width, or a wide panel for a detail view, needs its own reason.
- The engine chip no longer links a project in one click: linking is one click further, inside the panel, beside the file the panel shows. The chip's tooltip and accessible name say it opens the panel.
- A dialog a REAPER tool opens sits over the panel, and the panel stays open behind it, so closing the tool returns to the panel.
- The Tracks page's player is gone, not moved: a chapter is heard in its Proof chapter view, and `useTrackPlayback` stays only because Home's chapter track panel plays a track with it.
- Removing the `/tracks` redirect, or giving the engine a page of its own, needs an ADR superseding this one.
