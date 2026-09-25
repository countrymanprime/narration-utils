# 0242. The recording check writes the chapter's word alignment as additive lines, and align-again never transcribes

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** the owner

## Context and problem

The [edit and proof workspace](../prds/edit-and-proof-workspace.prd.md) follows the chapter's text while the recording plays and shows where the reading differs from the text. Phase 1 needs the word alignment for that. The recording check already computes it (`compare.diff_and_build_markers`, [ADR 0126](0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md)) and throws it away after counting.

The owner took the recommended answer to EP3 (D39), which is C:

- the check writes the alignment;
- a cache-only re-align runs after a trim or split, when every item's words are still cached.

The PRD assumed that the report's schema version would go up and that an older report would read as "align again". But the host (lane A's `internal/coverage/report.go`) refuses any schema version other than its own, and skips tags it doesn't know ([ADR 0127](0127-the-coverage-sidecar-mode-reads-a-json-manifest-keeps-one-words-file-per-item-and-writes-tagged-json-lines.md): the format is additive). The host side of Phase 1 is built in another lane, after this. A version bump now would make every stored check unreadable until then.

## Decision drivers

- Phase 1 of the workspace needs the word alignment, which the recording check already computes and throws away.
- The owner took EP3's recommended answer C (D39): the check writes the alignment, and a cache-only re-align runs after a trim or split.
- The host refuses any schema version other than its own and skips tags it does not know.
- The host side of Phase 1 is built in another lane, after this.

## Considered options

1. Additive tagged lines under schema version 1, and an align-again that never transcribes
2. Bump the report's schema version and read an older report as "align again" (the PRD's assumption)

## Decision outcome

**Chosen option: additive tagged lines under schema version 1, and an align-again that never transcribes**, because the host refuses any other schema version, so a version bump now would make every stored check unreadable until the host side is built.

1. **Two more tagged lines, after the measurement lines, in the same results file.** `compare.py --coverage` (`sidecars/transcript-compare/core/coverage_mode.py`) writes:
   - one `COVERAGE_TOKEN|{"i","p","w","text","status","heard","item","start","end"}` per chapter token, in order:
     - `p` is the paragraph id (`null` for the title and subtitle);
     - `w` is the ordinal of the whitespace word the token came from in that paragraph's text (or the heading's), so a screen finds the word with `text.split()[w]` and never tokenizes;
     - `status` is `read`, `misread`, `heading`, or one of the check's region kinds (`head`, `tail`, `skip`, `short_read`, `different_text`);
     - `heard` is what was said instead, for a misread;
     - `item`, `start` and `end` are the manifest item index and source seconds where the word was heard, or `null`;
   - one `COVERAGE_EXTRA|{"text","tokens","start","end","afterToken"}` per run of heard words that no chapter token accounts for. `start` and `end` have the regions' position shape, and `afterToken` is the last token heard before the run.
2. **The flags are the check's.** `recording_coverage.align_tokens` reads its statuses from the same `_statuses` and `_segments` that `compute_coverage` counts with:
   - `read` and `misread` add up to `presentTokens`, and to each paragraph's `present`;
   - each missing status adds up to its regions' `tokenCount`;
   - the extra runs add up to `extraTokens`.

   A token is `misread` when it is present in a gap and the word heard in its place differs, as the check counts a short gap.
3. **The schema version stays 1.** A results file without token lines is one written before this change, and a reader treats it as "align again". The measurement lines are unchanged, byte for byte, on the committed corpus (`results.golden.json` pins only them, because the token lines would outgrow the fixtures' size budget).
4. **Align-again is `--coverage --align-only`.** Before it decodes anything, it refuses with an error naming the first item whose words are not cached for its played range, and its transcriber refuses too. `--align-only` without `--coverage` is a usage error.
5. **Played ranges on the tracks wire.** `TracksList`'s `TrackItem` also carries the active take's GUID, where the item starts in its source (the section start plus `SOFFS`) and its play rate. Together with the manifest's items, the host has what it needs to join tokens to items.

### Consequences

- **Good:** The workspace's text, flags and click-to-seek come from one alignment, so they can't disagree with the Home check or the Review page's findings.
- **Neutral:** A 15,000-word chapter adds about 1.5 MB to its results file, well under the host's 16 MB limit.
- **Neutral:** Lane A still has to build the stored artifact and its read binding: join `item` to the item and take GUIDs from the manifest and the saved project, and treat a report with no token lines as "align again". Nothing reads the new lines until then.
- **Neutral:** The hyphen fuse and merged number words make one token stand for two words, or two tokens for one. `w` names the first word, and a screen highlights up to the next token's word.
- **Neutral:** Changing a line's shape later needs a new tag, or a schema version bump coordinated with the host reader.

### Confirmation

`results.golden.json` pins the measurement lines, byte for byte, on the committed corpus.

## Pros and cons of the options

### Bump the report's schema version and read an older report as "align again" (the PRD's assumption)

- Bad, because the host refuses any schema version other than its own, so every stored check would be unreadable until the host side is built.
