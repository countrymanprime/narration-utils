# Duplicate and Pickup Finder

**Status: Planned.**

## User problem

Narrators often record a correction elsewhere in a session or repeat a line after a false start. Locating the right alternate read and comparing it to the intended manuscript span is time-consuming.

## Target workflow

Analyze a selected chapter or range; review suspected pickup, restart, exact duplicate, or near-duplicate groups; audition candidates; then explicitly attach an approved candidate as a take in a target item.

## Inputs and outputs

- Inputs: selected REAPER audio items/takes, project timing, optional transcript/alignment data, and target manuscript spans.
- Outputs: `pickup` or `duplicate_read` findings with matched ranges, confidence/evidence, and an optional reviewed take-creation suggestion.
- Narrator actions: set scan scope, listen, reject intentional repetitions, select target item, and confirm any take creation.

## Planned features

### MVP

- Detect immediate restarts and exact/near-duplicate voiced passages.
- Associate candidates with likely manuscript spans when alignment evidence exists.
- Surface a partial-span match (only part of a candidate cleanly covers the target range) distinctly from a full match, so a partially usable pickup is never silently treated as complete — see [Take Intelligence](take-intelligence.md)'s segment-level evidence for the matching per-take view.
- Provide contextual A/B loop audition and exact source/target timestamps.
- Create a duplicate as a new take only after confirmation and only in a user-selected item.

### Later work

- Cross-session search index and configurable similarity thresholds.
- Explicit collection of alternate readings during recording.

## Non-goals and review boundary

The analyzer will not treat every repetition as a mistake, move source media, auto-create comps, or infer a target item from a weak match.

## Acceptance and risks

- Tests distinguish exact copies, pickups, intentional repeated prose, similar dialogue, and unrelated similar-sounding phrases.
- Approved creation is undoable and retains source provenance.
- Main risks: false matches in repetitive text and comparisons across different processing chains.
