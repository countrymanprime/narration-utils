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

A narrator can also keep their own pronunciation and track where each one stands (prep depth Phase 1,
[ADR 0346](../adr/0346-a-pronunciation-carries-a-status-and-note-and-the-narrators-own-sits-beside-the-dictionarys-as-the-alternate.md)):
`pronounce-user --ipa=<text>` sets one with source `user` that never asks a dictionary, and keeps the dictionary's answer beside
it as `alternate`; `pronunciation-use-alternate` swaps the two back, losslessly and without a lookup; `pronunciation-status
--status researched|query_sent|author_confirmed [--note=<text>]` records whether the author was asked or has confirmed it. An
entry with no `status` reads as `researched`. `author_confirmed` is withdrawn to `researched` when the pronunciation in use
changes. A rebuild keeps all of it. The host bindings are `GuidePronounceUser`, `GuidePronunciationUseAlternate` and
`GuidePronunciationSetStatus` (`hostAPIVersion` 69); the Story Bible shows the status and note, and in edit mode offers "Your
pronunciation", the switch to the kept one, and the status with its note.

The host derives the **pronunciation query list** from those statuses on every read (prep depth Phase 3,
[ADR 0347](../adr/0347-the-pronunciation-query-export-is-csv-with-its-ids-last-and-a-formula-guard-and-is-a-download.md)):
`guide.Service.PronunciationQueries` returns every name, the entity's own and each alias, that is not `author_confirmed`, each
once, in reading order (first paragraph that uses it; never used last), with that first use's chapter and excerpt.
`guide.QueriesCSV` writes it as CSV (`word, entry, category, chapter, excerpt, pronunciation, source, status, note, entry_id,
alias_index`) with a formula guard, and `guide.ParseQueriesCSV` reads an exported or hand-edited file back, reporting every row
it cannot use. The bindings are `GuidePronunciationQueries` and `GuidePronunciationQueriesCSV` (`hostAPIVersion` 70); the Story
Bible's Pronunciation queries panel saves the CSV as a download and marks a row sent or answered through
`GuidePronunciationSetStatus`.

Once the author replies, the narrator can **re-import** the answered file instead of marking each row by hand (prep depth
Phase 6, [ADR 0348](../adr/0348-a-re-imported-query-answer-is-matched-by-entry-id-and-alias-index-and-a-blank-note-column-leaves-the-note-alone.md)):
`guide.MatchQueryAnswers` matches each of `ParseQueriesCSV`'s rows to a still-existing entity or alias by `entry_id` and
`alias_index`, never by the free-text word, and reports a row whose entry or alias is gone the same way a row it could not
parse is reported. `guide.Service.ImportQueriesCSV` then applies every matched row through the existing
`SetPronunciationStatus` call, one sidecar call per row; a blank note column is sent as no note (leaving an existing one
alone), never as a note that clears it. The binding is `GuidePronunciationImportQueriesCSV` (`hostAPIVersion` 71), which
takes the file's text (the UI reads whatever file the narrator picks) and answers `{applied, issues}`; the panel's Import
answers button shows the count and lists any row it could not use.

## Target workflow

Run the guide after manuscript selection; review uncertain candidates; lock narrator-authored pronunciation and notes; export approved vocabulary for transcription; consult chapter/scene and dialogue information during recording.

## Inputs and outputs

- Inputs: Word manuscript, the selected catalog-managed spaCy language model (downloaded after a confirmation; without one the build offers a rules-only run), optional eSpeak, the selected catalog-managed Piper voice, and existing guide JSON.
- Outputs: `<project>/ManuscriptGuide/manuscript_guide.json`, optional audio previews, and shared `entity` and `pronunciation` findings for entries that need review or a pronunciation with low or unknown confidence (`apps/desktop/internal/guide/findings_adapter.go`), which the [Review page](../guides/using-the-app/review.md) lists and decides.
- Narrator actions: edit, lock, merge/reject candidates, approve pronunciations, and choose exports.

## Planned features

### MVP enhancements

- Alias merge/split review with stable entity IDs and auditable user decisions.
- Chapter and scene appearance maps for each entity.
- Narrator-approved pronunciation export with aliases and "say it as" forms suited to Transcript Compare hotwords.
- Dialogue-cue extraction that identifies likely speaker cues and preserves manuscript evidence.

### Later work

- Entity relationship review and character-bible export.
- Better support for intentionally ambiguous names and titles.

## Non-goals and review boundary

The tool does not invent character psychology, choose a voice, scrape external sources, or alter the manuscript. All inferred entities and traits remain review candidates.

## Acceptance and risks

- Locked narrator edits survive a rebuild; accepted alias choices do not reappear as duplicates.
- Every appearance map links to a reproducible manuscript excerpt.
- Exported terms can be consumed by Transcript Compare without undocumented file coupling.
- Main risks: false entity merges, alias ambiguity, and inconsistent Word styles; each requires a visible review path.
