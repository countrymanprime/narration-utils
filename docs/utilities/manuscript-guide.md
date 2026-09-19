# Manuscript Guide

**Status: Implemented; enhancement plan documented.**

## Current capability and problem

The current Python backend reads the project-owned canonical manuscript JSON, detects candidate characters, places, and organizations, and writes editable JSON with pronunciation, evidence, conservative descriptions, and personality notes. The native Go/Wails host imports DOCX and Markdown once before analysis; new PDF import is fail-closed pending corpus parity. The REAPER bridge supports building, reviewing, editing/locking fields, and optional local Piper previews.

## Target workflow

Run the guide after manuscript selection; review uncertain candidates; lock narrator-authored pronunciation and notes; export approved vocabulary for transcription; consult chapter/scene and dialogue information during recording.

## Inputs and outputs

- Inputs: Word manuscript, local spaCy model when available, optional eSpeak, the selected catalog-managed Piper voice, and existing guide JSON.
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
