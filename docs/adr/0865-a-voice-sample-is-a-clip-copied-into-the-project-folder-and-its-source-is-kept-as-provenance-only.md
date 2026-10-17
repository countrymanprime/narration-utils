# 0865. A voice sample is a clip copied into the project folder, and its source is kept as provenance only

**Status:** Proposed
**Significance:** A persistence strategy and the shape of a file the host writes and reads back. Reversing it later means migrating every narrator's saved samples from copies to references, or the other way, and changing every reader.
**Date:** 2026-10-17
**Supersedes:** none. It extends [ADR 0856](0856-the-editing-records-are-one-file-per-kind-keyed-by-word-with-its-text-checked-on-read-and-cleared-when-the-manuscript-is-replaced.md) (a record keyed by word, checked on read) from text records to audio, and sits beside [ADR 0263's](0263-a-character-reference-approves-a-saved-regions-snapshot-not-the-live-region.md) reference approvals, which it does not change.

## Context

The owner wants to mark a stretch of recorded audio in Editing as a character voice sample and replay it later from the Story Bible and the Booth ([PRD](../prds/character-voice-samples.prd.md), [#1820](https://github.com/countrymanprime/narration-utils/issues/1820)). The existing voice reference, a REAPER region approved for a character (`apps/desktop/internal/character`), stores a region GUID with a name and time snapshot and no audio; its Play button is a stub.

What a sample must survive is set by what narrators and the app do to a project: Editing hides, mutes and moves audio and never deletes it ([ADR 0860](0860-a-roll-keeps-the-earlier-audio-as-a-take-and-a-range-cut-a-chain-on-a-range-and-stacking-move-audio-and-never-delete-it.md)), so source offsets are stable across edits; but raw takes are archived or deleted after mastering, a chapter is re-recorded over its file, and a project folder is moved or copied. The app can play a project's track sources through `/media` only while the parsed `.rpp` still names them ([ADR 0012](0012-media-route-for-track-playback.md)).

**Considered options:**

- **Reference only** (source file, range, hash): no disk, and the shape the `daw` setting keeps when the DAW label is the record, and the sample dies or plays the wrong audio when the raw file is archived, re-recorded over or moved, and its playback needs `/media` to authorize a source by path.
- **Copy plus live source**: survives everything the copy does and keeps two playback paths and a state matrix for which one played. Rejected for cost without a benefit the copy lacks.
- **A rendered clip through the DAW** (an item range rendered with its FX): sounds as the DAW played it, is REAPER-only and slow, and fails with the DAW closed. Left as a later option ([PRD](../prds/character-voice-samples.prd.md), open question 5).
- **Copy, source as provenance** (chosen as the default, beside the setting above).

## Decision

0. **Where a sample is kept is a setting, and this ADR decides the default.** The owner decided on 2026-10-17 that the choice depends on the DAW: REAPER can label items, which makes the DAW the record and visible outside the app, while Audacity 3's labels are too limited and a copy in the project is better there, and a narrator may want the copy in REAPER too so that playing a sample never moves their place in the project. `VoiceSamples.storage` is `project` (the default and the only value built first), `daw` or `both`, layered like other settings, and the DAW values are offered only where the DAW can label an item. The `daw` and `both` values, the label's shape and the DAW as the record are not decided here: they need a REAPER spike and their own ADR ([PRD](../prds/character-voice-samples.prd.md), phase 6). Rules 1 to 8 below are the `project` storage and the clip in `both`.
1. **A sample is a clip file the host writes into the project.** `<project>/narration-utils/voice-samples/clips/<id>.wav` holds the marked stretch, copied from the source WAV in the source's own format (no resampling, dithering or fades), with a 150 ms handle each side clamped to the item's played range and both ends snapped to the nearest zero crossing. A clip is 0.5 to 30 s.
2. **The record is `samples.json`** beside it (`schemaVersion` 1): `id` (32 lowercase hex), `characterId` (a Story Bible entity id or `narration`, opaque as in `character.Reference`), `label` (60 UTF-16 units), `note` (500), `primary`, `createdAt`, the clip's `bytes`, `durationMs`, format and `sha256`, and a `source` block. At most one record per `characterId` is primary.
3. **The source block is provenance and is never opened.** It names the chapter, the first and last word keys with their text, the item and take GUIDs, the source file and the range. Playback, listing and serving read the clip only. The host derives the clip's file name from `id` and ignores any file name in the record, so a hand edit cannot make it open another path.
4. **Provenance is checked on read, never stored as state**, by the rule of [ADR 0856](0856-the-editing-records-are-one-file-per-kind-keyed-by-word-with-its-text-checked-on-read-and-cleared-when-the-manuscript-is-replaced.md): `ok`, `text_changed` or `chapter_missing` against the current manuscript. A clip's own state is `ok`, `missing`, `size_changed` or `hash_changed`. Neither provenance state blocks playback of a clip that is `ok`.
5. **Read as narrator data** through `persist`: a file that does not decode or breaks a rule is kept aside as `samples.json.corrupt-<time>`, a newer version is refused and never overwritten, a write is a temp file renamed into place, and a clip is written before its row.
6. **Limits:** 20 samples a character, 200 MiB of clips a project; a refusal says which.
7. **Retention:** kept through a manuscript replace (the audio is still the narrator's performance), removed by **Clear project data** and by deleting the sample. The rows are added to [data files](../reference/data-files.md) when the file exists.
8. **The page never sends a path.** Marking sends an item GUID and a range; the host takes the source file from the saved `.rpp`, checks the range against the item's played range and the chapter's cuts, and refuses a stale alignment.

## Consequences

- A sample plays with the DAW closed, the source file gone, the project moved, and after a re-record, a cleanup and any ripple edit, because it depends on nothing but its own file.
- The project folder grows by up to the limit, and the narrator's voice exists in a second place in it. Backups of the folder carry the clips. The Voice data panel shows the total and **Remove voice samples…** clears it.
- A clip is the raw recording. It does not carry the item's volume, fades or FX, and a sample marked before cleanup keeps the noise cleanup later removes.
- A copy of a source in a format `zerocross/wav.go` cannot read is refused (`unsupported_source`); Editing does not decode those files either.
- The series voice bible ([ADR 0565](0565-the-series-voice-bible-pools-reference-clips-by-character-id-and-shows-no-books-until-a-second-book-has-data.md)) can pool samples by `characterId` later, which needs reading a sibling project's clips and its own ADR ([ADR 0866](0866-voice-samples-play-in-the-apps-own-audio-served-by-id-and-never-through-the-daw.md) serves only this project's).
- To change this, write an ADR that supersedes it and migrates `samples.json` by a `schemaVersion` bump.
