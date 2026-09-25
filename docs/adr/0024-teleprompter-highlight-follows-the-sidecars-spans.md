# 0024. The teleprompter highlight follows the sidecar's spans and only ever catches up to the real position

- **Status:** Accepted
- **Date:** 2026-09-19
- **Related:** Amends [ADR-0016](0016-highlight-primitive.md) (adds the `Cursor` kind, which is a solid fill with no underline rather than a 20% tint with one).

## Context and problem

The sidecar reports where the narrator is as `read`, an index into a flat list of words (the chapter title, then every paragraph, split on whitespace), and describes that list once in a `script` event of spans. `ParagraphView.tsx` renders text as character-offset annotations and never splits it into words. The tracker also occasionally takes back a single word when a later reading of a phrase disagrees with an earlier one, and it reports positions in bursts (a confirmed phrase can move the cursor several words). ADR-0015 forbids progress that is not real.

## Decision drivers

- The sidecar reports position as an index into a flat list of words, described once by a `script` event of spans.
- `ParagraphView.tsx` renders character-offset annotations and never splits text into words.
- The tracker occasionally takes back a single word and reports positions in bursts.
- ADR-0015 forbids progress that is not real.

## Considered options

1. A separate reader component that lays the sidecar's spans over the chapter text, with a cursor that only catches up to the reported position
2. Reuse `ParagraphView.tsx`

## Decision outcome

**Chosen option: a separate reader component that lays the sidecar's spans over the chapter text, with a cursor that only catches up to the reported position**, because the sidecar's positions are word indices that `ParagraphView` cannot address, and ADR-0015 forbids showing progress that is not real.

1. The reader is its own component (`components/teleprompter/ReaderText.tsx`), not `ParagraphView`. It lays the `script` event's spans over the chapter text the manuscript reader already has (`readerModel.buildRows`). Spans are the authority on positions: a title or paragraph whose word count differs from its span is still shown, as plain text without tracking, so one drifted paragraph cannot shift the rest.
2. The current word is drawn with the `Highlight` primitive as a new `Cursor` kind (ADR-0016): a solid accent fill, not a tint, so it reads as a position marker and never as an entity or note. Words already read are dimmed; words the tracker reports as skipped keep the normal text color with a dotted underline.
3. The highlight walks forward to the reported position a few words at a time (`usePacedCursor`) and never runs ahead of it. A move backward, reduced motion, or a jump of more than 80 words (a session picked up mid-chapter) lands immediately. A one-word backward correction is ignored entirely (`nextCursor`); anything larger is followed.
4. The page hydrates from the host's `teleprompter:state` snapshot (which carries the last `script` and `position`), so leaving the page and coming back mid-session shows the highlight where it was.
5. The browser mock replays a `position` stream recorded from the real `ScriptTracker` (`tools/manuscript-teleprompter/spikes/record_mock_stream.py` regenerates `teleprompterRecording.json`), rescaled onto whichever chapter is shown, rather than an invented pace.

### Consequences

- **Bad:** The reader needs the chapter's paragraphs and title exactly as the sidecar tokenized them; a manuscript edited after the session starts would show plain text for the edited rows.
- **Good:** Only the row being read re-renders per step (rows are memoized on their position relative to the cursor and a stable skipped-range list), which is what keeps a chapter of thousands of words responsive.
- **Neutral:** The pacing constants (45 ms steps, 80-word snap) are visual judgments to retune against real live use.
- **Neutral:** The mock's pacing is the tracker's own but its narrator is scripted, so it shows behavior, not accuracy.
- **Good:** Line breaks inside a paragraph are kept for tracked rows (each word remembers the whitespace after it), so the teleprompter text matches the manuscript reader.
- **Good:** A page opened mid-session takes only what is missing from the host's snapshot: it never overrides a position that live events already delivered.
- **Neutral:** Auto-scroll only moves when the current word leaves the middle of the screen, so a narrator who scrolls by hand while reading can still be pulled back. [ADR 0119](0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md) (proposed) pauses following on a hand scroll instead.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Reuse `ParagraphView.tsx`

- Bad, because it renders text as character-offset annotations and never splits it into words, while the sidecar reports positions as word indices.
