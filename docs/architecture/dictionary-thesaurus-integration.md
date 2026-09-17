# Dictionary/thesaurus integration

**Status: Planned — not implemented.**

## Problem

There is no way to look up a word's definition or synonyms from within the app. A narrator reading unfamiliar vocabulary in a manuscript currently has to leave the app entirely.

## Proposal

Let the user select a word (likely in the Manuscript reader, `Manuscript.tsx` — the same text-selection infrastructure already used for "+ Note" and "+ Story Bible" per the existing `SelectionMenu.tsx`) and look it up via a sidebar panel or a tooltip, backed by a dictionary/thesaurus API.

### Where it could live in the existing UI

- Reuse the existing text-selection popup (`SelectionMenu.tsx`) — add a "Look up" action alongside the current "+ Note"/"+ Story Bible" actions.
- Display results either in the existing overlay/slide-over pattern (`.overlay-panel`, already used for Chapters & Search and, as of this session, the Story Bible "Review entry" overlay) or as a `Tooltip`-style popover anchored to the selection — the overlay is likely better for a definition + synonym list that might be long, per the design-system convention that a "peek at something else" belongs in an overlay, not a transient tooltip, when it has real content to browse.

### Things to research before implementing

- **Provider**: an API (needs a network dependency and a key-management story — this app is otherwise local-first) vs. a bundled offline dictionary dataset (larger install size, but consistent with the app's local-first design; `pyproject.toml` already vendors sizable local models like spaCy/piper, so precedent exists for bundling data).
- **Licensing** of whatever dataset/API is chosen.
- **Scope**: single-word lookup only, or also short phrases? Definitions only, or thesaurus (synonyms/antonyms) too, per the user's stated interest in both?

## Out of scope for this doc

Picking the actual provider/dataset — needs a short research spike weighing local-first vs. API-based against the licensing and offline-use requirements the rest of the app follows.
