# DAW Project Scan

**Status: Planned.** The track/item enumeration part of the MVP is already delivered by [Tracks](tracks.md), which reads the project's `.rpp` file directly rather than through a new REAPER bridge action; the rest (chapter matching, measured duration, transcript/waveform) is still planned and should build on that parser.

## User problem

Home-page progress today is a word-count estimate, not what's actually recorded. Narrators also want to inspect a track's transcript and waveform, and act on a piece of it, without leaving REAPER context or hunting through generated files.

## Target workflow

Scan the open REAPER project; match tracks/regions to manuscript chapters; show measured recorded duration per chapter and per book on the home page; open a track to see its transcript and waveform together; select a transcript span to seek and play the matching DAW audio.

## Inputs and outputs

- Inputs: REAPER track/item/take GUIDs and lengths, the canonical `manuscript.json` chapter list, existing transcript/alignment output where a track has already been run through Transcript Compare.
- Outputs: a track-to-chapter mapping, measured recorded-duration stats for the home page, and a per-track transcript+waveform view with span-to-timestamp linking.
- Narrator actions: confirm or correct an ambiguous track/chapter match, open a track's transcript/waveform view, click a transcript span to seek and play.

## Planned features

### MVP

- Enumerate tracks/items/takes and their lengths via a new REAPER bridge action; fuzzy-match track/region names against manuscript chapter titles.
- Replace the home page's estimated recorded-hours figure with a measured value once a project has been scanned.
- Per-track transcript view (reusing Transcript Compare's Faster-Whisper output) paired with a waveform display built from downsampled peak data.
- Click a transcript word or sentence to move the REAPER edit cursor and play from that position.

### Later work

- Highlight-and-delete and highlight-and-apply-FX actions on a selected transcript span, each wrapped in its own undo block and requiring explicit per-action confirmation.
- An ambiguous-match review queue when a track can't be confidently mapped to a chapter.
- Feed the track-to-chapter mapping into [Review Dashboard](review-dashboard.md)'s chapter grouping so every analyzer shares one mapping instead of each reimplementing it.

## Non-goals and review boundary

Scanning is read-only by default. The later-work highlight-and-delete/apply-FX actions never execute without explicit per-action narrator confirmation, and a low-confidence chapter match is surfaced for review rather than silently assumed.

## Acceptance and risks

- A scanned project's recorded-duration figure reflects actual REAPER item lengths, not an estimate.
- An ambiguous or renamed track is flagged rather than silently mismatched to the wrong chapter.
- Tests cover multi-take tracks, renamed/reordered tracks, and chapters with no matching track yet.
- Main risks: track-naming conventions vary enough across narrators' projects that fuzzy matching needs a manual-override path from day one; waveform generation cost on very long books.
