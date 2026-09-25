# 0245. Chapter and credits regions are planned by the host from confirmed links and the saved project

- **Status:** Proposed
- **Date:** 2026-09-25

## Context and problem

[ADR 0235](0235-one-create-regions-command-serves-chapter-and-credits-regions-and-replaces-create-chapter-regions.md) gave both PRDs that need REAPER regions one command, `create_regions`, and a Go client, but nothing in the host decided which rows to send. The follow-through PRD's Phase 7 (RF-7) wants "chapter regions with bounds from `tracks` extents", previewed and approved; credits-in-chapter-table Phase 4 wants the credits to get regions of their own, listed first and last (CT8). The chapter-to-track link control now stores one narrator-confirmed track per chapter, and the saved `.rpp` gives each track's span. Credits have no stored track link yet: that is credits-in-chapter-table Phase 3.

## Decision drivers

- Nothing in the host decided which rows to send to `create_regions`.
- RF-7 wants chapter regions with bounds from `tracks` extents, previewed and approved; CT8 wants the credits to get regions of their own, listed first and last.
- The chapter-to-track link control stores one narrator-confirmed track per chapter, and the saved `.rpp` gives each track's span.
- Credits have no stored track link yet.

## Considered options

1. The host plans the regions from confirmed links and the saved project, and the UI only chooses

No alternatives were recorded when this decision was made.

## Decision outcome

**Chosen option: the host plans the regions from confirmed links and the saved project, and the UI only chooses**, because nothing in the host decided which rows to send, and the confirmed links and the saved `.rpp` give each chapter's track and its span.

- **The host plans; the UI only chooses.** `ChapterRegionsPreview(openingTrackGUID, closingTrackGUID)` reads the saved `.rpp` and the confirmed links once and returns the rows and every skip with its reason. `ChapterRegionsCreate(opening, closing, update)` recomputes the same plan and sends it in one `create_regions` request. Bounds and titles never come from the UI.
- **Only confirmed links make chapter regions.** A chapter with exactly one confirmed link to a track that has items gets a region spanning the track's first item start to its last item end. An unconfirmed match, no link, several links, a link to a track the project lacks, and an empty track are each skipped with a reason.
- **Credits rows are named like the chapter table's rows** ("Opening credits", "Closing credits"; CT8's recommendation) and come first and last. Their track is passed per call; an empty GUID leaves the row out. When Phase 3 stores credits links, the caller passes those.
- **The preview judges each row against the saved regions** with `create_regions`' own rule (a matching region within 0.01 s first, then one region with the title, then several): `new`, `exists`, `moves` or `ambiguous`. REAPER decides for real, because the live project can differ from its last save.
- The bridge's S28 commands get one host client, `bridge.Actions`, on the same client as the other consumers; it reads the Experimental REAPER actions switch on every request ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)).

### Consequences

- **Good:** A second run adds nothing: every row is `exists` and `create_regions` skips it.
- **Good:** Regions follow the narrator's confirmed links, so a wrong automatic match never becomes a region without a confirmation.
- **Neutral:** `hostAPIVersion` 49 to 50. The dialog that calls these bindings is a UI-lane follow-up; until it lands, no narrator can reach them.

### Confirmation

Not recorded when this decision was made.
