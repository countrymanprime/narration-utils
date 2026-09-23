# Manuscript Guide

**Status: Implemented; enhancement plan documented.**

## Current capability and problem

The current Python backend reads the project-owned canonical manuscript JSON, detects candidate characters, places, and organizations, and writes editable JSON with pronunciation, evidence, conservative descriptions, and personality notes. The native Go/Wails host imports DOCX, Markdown, plain text (`.txt`) and EPUB (`.epub`) once before analysis, all through the same hand-written parsers (no third-party EPUB library) and the same canonical `Draft`; new PDF import is fail-closed pending corpus parity. The REAPER bridge supports building, reviewing, editing/locking fields, and optional local Piper previews.

## Entity properties

Every entry carries `properties`: an ordered list of `{"key", "value"}` facts, the labelled lines of a character block ("Codename", "Abilities", "Dossier") that have nowhere else to live. They are text only (no typed or nested values), every category has them, and they are shown in the Story Bible detail, edited in edit mode, and shown in the entry summary opened from the Manuscript.

- **Shape.** An ordered list, not an object: the host decodes the file to a map and writes it back, which sorts an object's keys and would lose the narrator's order. A key is required and unique whatever its case (`Codename` and `codename` are one key); a value may be empty. Both are trimmed.
- **Additive.** A Story Bible file written before properties existed has none, and every reader treats that as an empty list. `schema_version` stays 2.
- **Editing.** `edit --field properties --value=<JSON list>` replaces the whole list in one run, like every other field: a locked entry refuses it (ADR 0007), a bad list changes nothing, and it counts as a review (`review_state` becomes `reviewed`). The Save button sends it only when the list changed.
- **Creating with properties.** `create --properties=<JSON list>` sets them in the same run as the entry, for the import of a manuscript's cast blocks (`guide.Service.CreateFull` in the host). The list must be valid (a name on every property, no name twice); an invalid list creates nothing. The caller merges repeated labels before it asks.
- **Rebuilding.** A build never produces properties, so `merge_locked` carries the prior list onto a regenerated entry, and a locked or manual entry is kept whole. `merge` unions by key: the target's value wins and the source adds the keys the target lacks.

## Pronunciation: generate and replace

Alongside the automatic CMU-then-eSpeak fallback used at build time (`pronunciation()`), a narrator can set a pronunciation
explicitly from edit mode: `pronounce --entity-id <id> [--alias-index <n>] --source cmu|espeak` (`pronounce_source`) tries
exactly the named engine and raises when it has nothing for the name, instead of quietly falling back or reporting "not
generated". The value is marked `chosen: true`, so a rebuild's `merge_locked` keeps it instead of overwriting it with a
freshly generated one; an auto-generated value (no `chosen` key) is still replaced by the fresh build as before. Blocked on
a locked entity (ADR 0007), same as every other edit.

The Go host exposes it as `GuidePronounce(id, aliasIndex *int, source string)` / the `GuidePronounce` binding
(`hostAPIVersion` 13). The UI gates the play button on a pronunciation existing (the preview always speaks the name as
spelled and ignores the IPA, so this is a UI policy, not a technical limit) and offers Generate (missing) or Replace
(present) in edit mode only, each choosing explicitly between the CMU dictionary and eSpeak NG.

## Target workflow

Run the guide after manuscript selection; review uncertain candidates; lock narrator-authored pronunciation and notes; export approved vocabulary for transcription; consult chapter/scene and dialogue information during recording.

## Inputs and outputs

- Inputs: Word manuscript, the selected catalog-managed spaCy language model (downloaded after a confirmation; without one the build offers a rules-only run), optional eSpeak, the selected catalog-managed Piper voice, and existing guide JSON.
- Outputs: `<project>/ManuscriptGuide/manuscript_guide.json`, optional audio previews, then shared entity/pronunciation findings.
- Narrator actions: edit, lock, merge/reject candidates, approve pronunciations, and choose exports.

## Planned features

### MVP enhancements

- Alias merge/split review with stable entity IDs and auditable user decisions.
- Chapter and scene appearance maps for each entity.
- Narrator-approved pronunciation export with aliases and "say it as" forms suited to Transcript Compare hotwords.
- Dialogue-cue extraction that identifies likely speaker cues and preserves manuscript evidence.

### Later work

- Entity relationship review and character-bible export.
- Dashboard findings for unresolved entities and unreviewed pronunciations.
- Better support for intentionally ambiguous names and titles.

## Non-goals and review boundary

The tool does not invent character psychology, choose a voice, scrape external sources, or alter the manuscript. All inferred entities and traits remain review candidates.

## Acceptance and risks

- Locked narrator edits survive a rebuild; accepted alias choices do not reappear as duplicates.
- Every appearance map links to a reproducible manuscript excerpt.
- Exported terms can be consumed by Transcript Compare without undocumented file coupling.
- Main risks: false entity merges, alias ambiguity, and inconsistent Word styles; each requires a visible review path.
