# Workflow: Manuscript and Editorial Review

## Goal

Prepare a reliable narration reference before recording, then turn spoken-text discrepancies into an ordered review queue.

## Flow

1. Save the project and import the manuscript; both tools use project-owned canonical JSON, not the source file.
2. Run Manuscript Guide and review uncertain entities, aliases, categories, and pronunciations. Lock narrator-authored values.
3. Export approved names as transcription hotwords when useful; this is an explicit export, not an implicit shared setting.
4. Record or assemble a chapter on a REAPER track whose name maps to the Word heading.
5. Run Transcript Compare. Review its diff and take markers, then accept/dismiss/defer each finding in the future dashboard.

## Planned improvements

- Surface guide entities and pronunciation notes in the dashboard alongside transcript findings.
- Attach a chapter/scene location and evidence excerpts to all entity findings.
- Let reviewed equivalences suppress recurring ASR spelling noise without hiding genuine misreads.

## Human decisions

The narrator approves names, pronunciation, equivalence entries, and every correction. A transcription mismatch is evidence to listen to, not proof of an error.

## Success signals

- A narrator reaches every flagged discrepancy in one action.
- Invented vocabulary is reviewed once and stops creating repeated false positives.
- A changed manuscript clearly invalidates or refreshes derived data.
