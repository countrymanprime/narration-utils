# Recording Coverage Analysis

**Source:** New work; nothing to supersede. It turns one of the narrator's three stage rules (recording is done when 100% of the chapter's text is there, in order, even with mistakes) into a measurement. It draws on `docs/roadmap.md` (product boundary, line 10), `docs/utilities/transcript-compare.md`, [ADR 0008](../adr/0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md), [ADR 0015](../adr/0015-real-progress-only.md), [ADR 0012](../adr/0012-media-route-for-track-playback.md), [ADR 0025](../adr/0025-delivery-measurements-in-go-profiles-deferred.md), and the existing PRDs. Citations are `file:line` on `main` at d5cc994 (the worktree HEAD) for anything checked in code; "per docs" marks a claim taken from a document and not verified; "TBD - needs <what>" marks an unknown. Sibling PRDs (file names only, in `docs/prds/`): `chapter-stage-recommendations.prd.md` (prefix SR, umbrella; owns the `Signal` contract this PRD implements for the `recording` stage), `analysis-evidence-ledger.prd.md` (prefix EL, the parser extension, fingerprint, ledger, cache and confirmed track-to-chapter mapping this PRD consumes), `editing-readiness-analysis.prd.md` (ER), `proofing-readiness-signals.prd.md` (PS), plus the existing `diagnostics-delivery-and-cleanup-tools.prd.md` (no prefix is stated in its header; this PRD writes `DX`), `take-review-pickups-duplicates-take-intelligence.prd.md` (TR), `review-dashboard-and-findings-adoption.prd.md` (RD), `teleprompter-manuscript-integration.prd.md` (TM) and `reaper-automation-follow-through.prd.md` (RF). In Depends columns this PRD's own phases are bare numbers; other PRDs' phases are `<PREFIX>-n`. The EL and SR PRDs were written in parallel and their phase numbers were not final: where this PRD depends on one of them it writes `EL-<capability>` or `SR-<capability>`, to be replaced by the number at merge. The retired briefs are cited as of d5cc994 (`git show d5cc994:<path>`).

## Problem Statement

A narrator cannot tell from the app whether a chapter has been recorded in full. Transcript Compare finds mistakes inside what was read, and by design ignores what was never read: text before the first aligned word or after the last is dropped, so a chapter that stops halfway produces no marker for the missing half. The Home breakdown then shows "recorded hours" from a per-status guess (0.5 while `recording`, 1 afterwards), not from the recording. The narrator decides "done recording" from memory. The cost of a wrong call is an editing pass started before a paragraph exists, or a finished-looking chapter with a hole.

## Evidence

Verified in code:

- **No component reports coverage.** Nothing outputs a chapter percentage, an in-order verdict or a "complete" flag. Comparison output is `SUMMARY|`, `DIFF|` and `MARKER|` lines only (`sidecars/transcript-compare/core/compare.py:1538-1563`).
- **The needed alignment already exists but is thrown away.** `diff_and_build_markers()` (`compare.py:1042-1169`) aligns manuscript tokens to transcript tokens with `difflib.SequenceMatcher(None, chapter_norm, filtered_tokens, autojunk=False)` and `_fuse_hyphen_split_opcodes` (`:1055-1056`, `:965-987`). Equal blocks are strictly increasing in both sequences, which is the "in order" property. `replace` opcodes become `MISREAD` markers and do not break the alignment (`:1106-1110`). The opcodes are returned in the `alignment` dict (`:1161-1167`).
- **Head and tail are deliberately dropped.** A `delete` before the first aligned block or after the last is "never part of this recording (e.g. only a partial chapter was selected/recorded)" and produces no marker (`:1058-1075`, `:1112-1113`). `covered_range` in sentence units is computed (`:1148-1154`), widened by `EXCERPT_TAIL_BUFFER_SENTENCES = 2` (`:65`, `:1526-1530`) and used only to render the `.diff`, `.manuscript.txt` and `.recorded.txt` files (`:1532`). `docs/utilities/transcript-compare.md:43` states the utility does not "create markers for unrecorded chapter material". Coverage needs exactly what this code suppresses, so the change must be additive and must not alter which markers are produced (ADR 0008's additive precedent).
- **Small blocks are filtered even inside the span.** `if length < min_words: continue` (`:1100-1101`, default `--min-words 1`, `:1587`) affects marker output only; coverage must read opcodes, not markers.
- **SequenceMatcher is not a true LCS.** Per Python `difflib` docs it recurses on the longest contiguous matching block, and ADR 0008's consequences say the approach "does not fix cases where `SequenceMatcher` picks a poor alignment among repeated/common words". Inference, needs a test: a long partial retake can beat a shorter good read that a misread breaks up, and scattered function-word matches can align against unrelated speech.
- **Tolerance already present.** Smart-quote and possessive folding, the homophone table `core/homophones.csv` and per-project `TranscriptCompare/equivalences.csv` (`compare.py:216-238`, `:184`, `:1443-1447`), number-word merging (`:271-311`), `FILLER_WORDS` removal (`:57`, `:1046-1049`).
- **Title is optional by construction, subtitle is ignored.** The chapter title is tokenized and prepended (unit `-1`) so a spoken title aligns instead of showing as EXTRA (`:1514-1522`). `load_manuscript_chapters` reads `id`, `title`, paragraph text, paragraph indices and paragraph ids only (`:781-793`), not the canonical `subtitle` field (`apps/desktop/internal/manuscript/service.go:403`), and keeps only `contentKind == "narration"` chapters (`:784`), so Front Matter (`opening`) cannot be compared. Legacy titles can carry a subtitle after a line break (`display_title`, `:869-877`).
- **Paragraph mapping is available.** Chapters carry `paragraph_ids` (`p-%06d`, `service.go:425`, `compare.py:792`); sentence units carry their paragraph index (`compare.py:329-337`). Sentence units are recomputed at runtime with no stable ids (`:314-337`); chapter ids are positional `c-%04d` (`service.go:403`) and `resetDerived` deletes `TranscriptCompare/`, `manuscript-notes.json` and `.narration-last-comparison.json` on re-import (`service.go:434-441`).
- **Transcript words are not persisted.** `transcribe()` builds `(word, start, end)` tuples in memory (`:517-523`, `word_timestamps=True`, `vad_filter=True` at `:512-513`); chunked runs write per-chunk JSON under `<results>_chunks/` and remove it at the end (`:616-776`, overlap `CHUNK_OVERLAP_SECONDS = 1.5` at `:552`). Every comparison re-transcribes the whole track.
- **A manifest of played ranges exists only in Lua.** `prepare_compare` (`integrations/reaper/narration_ui_bridge.lua:92-172`) reads the active take (`:139`), `D_STARTOFFS` and `D_PLAYRATE` (`:144-145`) and writes `index|source_file|startoffs|length*rate` (`:151`), sorted by position; `build_concatenated_audio` joins the items at 16 kHz mono (`compare.py:444-464`) and `locate_in_segments` maps a concatenated time back to item and source position (`:467-482`). The static Go reader takes `POSITION`, `LENGTH`, `NAME` and the first `<SOURCE>` only (`apps/desktop/internal/tracks/parse.go:68-96`, `tracks.go:18-26`), so it cannot build that manifest and may pick the first take's source rather than the active one (inference). Only track mute is parsed (`parse.go:48-50`); item mute is not, and `prepare_compare` does not check it.
- **One persisted result, no chapter identity.** `.narration-last-comparison.json` is a single slot overwritten each run (`apps/desktop/internal/transcript/service.go:531-537`). It holds no chapter id, `documentId`, item GUIDs, source hashes or coverage figure.
- **Additive tagged lines are safe.** Lua acts only on `SUMMARY` and `MARKER` (`narration_ui_bridge.lua:200-204`); Go checks only the `NEED_CHAPTER|` prefix (`service.go:486`). The sidecar already has an additive CLI mode, `--extract-hints` (`compare.py:1598-1626`). A miscounted `MARKER` field silently corrupts `audio_context` (ADR 0008), so new output must not reuse the `MARKER` field layout.
- **Progress and cancel plumbing exists.** The sidecar writes `stage|pct|message` lines and honours `<progress>.cancel` (`compare.py:122-126`, exit code 2 at `:1641-1654`); Go tails the file and writes the cancel file (`service.go:107-119`, `:420-476`, `:497`). Whisper progress is `seg.end / total_duration` (`compare.py:525-526`), which is real work (ADR 0015).
- **The Home number is a guess.** `AudiobookEstimatePanel.tsx:19` derives recorded hours from status (`RECORDED_FRACTION`), used at `:69` and `:182-186`. `ManuscriptChapter.recordedFraction?` exists (`apps/ui/src/api/contracts/manuscript.ts:9`) and is preferred over the guess, but `chapterPayload` never sets it (`apps/desktop/internal/manuscript/reader.go:337-356`); only mocks do (`apps/ui/src/api/mockFixtures.ts:222`, `apps/ui/src/api/aliceManuscript.ts:78`).
- **Test gap.** `docs/utilities/transcript-compare.md:49` says tests cover "invented names, homophones, numbers, partial recordings, title reads, chunk seams, and stale item mappings". `sidecars/transcript-compare/tests/test_compare.py` has six tests (reference-section filter, five confidence-threshold tests) and `libs/python/tests/test_transcript_compare.py` has two marker-context tests. None covers any of the listed cases.
- **The live teleprompter tracker is a different thing.** It tokenizes with `text.split()` and `normalize_word` (`sidecars/manuscript-teleprompter/core/script_tracker.py:46-52`, `chapter_script.py:91`), lacks homophone, number-word and hyphen handling (`docs/architecture/manuscript-teleprompter.md:409-411`), and reports `status: "done"` when its display cursor reaches the end (`script_tracker.py:208-209`): a cursor position, not verified coverage.
- **Constraints.** faster-whisper/CTranslate2/PyAV are the only ML runtime and PyTorch is absent (ADR 0008); forced alignment would need a superseding ADR. The Whisper model is the narrator's `TranscriptCompare.model_size` setting, default `small` (`apps/desktop/app.go:645`, `:678`; `service.go:388`), hash-pinned in `config/whisper-assets.json` (per docs).

Not verified in this repo (general REAPER behavior; no repo doc states it, TBD - confirm with a REAPER-saved fixture pair): the saved `.rpp` lags an open, unsaved REAPER project, so every result must name its basis as the saved file.

Unknown (TBD): offline transcription throughput for any model on the narrator's hardware (none is recorded in the repo); `SequenceMatcher` runtime on a full chapter, worst case O(n*m) on repetitive text (unbenchmarked); how often Whisper drops or garbles words in a clean, complete read (this sets the false "not met" rate). No labeled recordings exist in the repo (D12). Assumption needing validation: that a monotone word alignment with the tolerances above separates complete from incomplete chapters on real narration.

## Proposed Solution

Add a read-only recording-coverage analyzer. For a chapter and its confirmed track, it takes the played range of each item, transcribes each range once (cached per item, so the words are kept), aligns the chapter's body text to the transcript in order, and reports what was read and where text is missing: a per-paragraph present fraction, the longest run of missing words, and typed regions (unread head, unread tail, skipped block, short read, different text) each with the paragraph ids, the first and last missing words, and the audio position where the gap sits. Misreads, extra words, false starts and a spoken title or subtitle never count against the narrator. The `recording` signal for the umbrella (`chapter-stage-recommendations.prd.md`) is `met` only when a `complete` analysis exists at the chapter's current fingerprint and every paragraph passes both narrator-set thresholds; a stale, partial, unmapped or never-run analysis is `unknown`. The measured word fraction also fills `ManuscriptChapter.recordedFraction`, replacing the status guess (D11). The app never changes a chapter status (D1): the narrator confirms in the umbrella's UI.

Design choices: coverage is computed by a new additive mode of the Python sidecar (tokenization, homophones, number words and equivalences exist only there, `compare.py:216-311`, and a Go copy would drift). The Go host builds the manifest from the saved project (no REAPER, no Lua), owns the cache keys, ledger records, job, progress and thresholds, and evaluates pass/fail on read so changing a threshold never re-transcribes or re-aligns.

## Key Hypothesis

We believe reporting per-paragraph present text and the longest missing run, from a monotone alignment of the manuscript to a cached transcript of each item's played range, will let narrators trust a "recording looks complete" suggestion without re-listening, for narrators who record chapters as one or more items on one REAPER track. We'll know we're right when, on the annotated corpus, (a) no incomplete chapter is classified complete (the proposed target is zero; the corpus size bounds what this proves), (b) the share of truly complete chapters classified complete is at or above a proposed target (assumption, calibrate on the corpus), (c) each missing region is localized to the right paragraph and within a proposed number of words (TBD - set from the corpus), and (d) re-checking after editing one item transcribes only that item.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Automatic status changes, or storing a recommendation as truth | D1 and the recorded decision: suggestions only; the narrator confirms |
| Judging reading accuracy, acting or delivery quality | `docs/roadmap.md:10`; misreads count as present here. Mistakes are Transcript Compare's and PS's concern |
| Automatic comping, take activation, moving or deleting audio | `docs/roadmap.md:10`; ADR draft 0031 (PR #44) |
| New Lua, or any REAPER-only path in the MVP | Recorded decision: Lua only for now; compute from the saved `.rpp` plus audio files. A live-REAPER change counter is at most a Could, owned by EL |
| Forced alignment (WhisperX, MFA) or any PyTorch/Kaldi dependency | ADR 0008 gates it on evidence; a new superseding ADR would be needed |
| Cloud transcription | `docs/roadmap.md:10` |
| A second track-to-chapter matcher | The Go matcher is `teleprompter-manuscript-integration.prd.md` Phase 8 (TM-8), consumed by `diagnostics-delivery-and-cleanup-tools.prd.md` Phase 8 (DX-8); EL owns the confirmed mapping |
| Finding the out-of-place read (a pickup recorded at the end) | Owned by `take-review-pickups-duplicates-take-intelligence.prd.md`; here such text is simply missing in place, with a note that extra unaligned speech exists |
| Front Matter and reference sections as targets | The compare path loads narration chapters only (`compare.py:784`); Q4 |
| Multi-track chapters, all-takes analysis | v1 is one track per chapter (D5), active take only; Q5 and Q9 |
| Fixing or replacing the marker alignment in Transcript Compare | Coverage is additive; the marker output must not change |
| Reusing the live teleprompter tracker for coverage | Different tokenization and a cursor-based `done`; Q8 |
| A background job that transcribes on every project save | Cost is minutes of ASR (TBD - measure); evaluation is on demand and reads cached results on Home load |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Incomplete chapters classified complete (false "met") | Proposed 0 (assumption, calibrate); a nonzero count blocks shipping defaults | Annotated corpus, held out from tuning; conditions listed in Phase 1 |
| Complete chapters classified complete | Proposed 90% or better (assumption, calibrate) | Same corpus; each miss is inspected and its cause recorded (ASR drop, threshold, alignment) |
| Missing-region localization | Right paragraph for every labeled region; word-level error TBD - set from the corpus | Corpus labels per paragraph |
| Chance-match resistance | 0 present tokens credited to unrelated speech of the same length as a missing paragraph beyond the anchor rule | Text-only fixtures (Phase 2), then corpus |
| Retake and refrain handling | Documented result per fixture; SequenceMatcher kept only if it passes the fixtures or its under-coverage is acceptable and stated | Phase 2 spike |
| Reproducibility | Identical items, cache and parameters give an identical report | pytest and Go tests |
| Transcription avoided | 0 transcription calls when only thresholds change or no item changed; 1 item's worth after a one-item edit | Go tests with a fake sidecar counting calls; corpus run |
| Progress honesty | Monotonic, derived from decoded or transcribed seconds, cancel leaves finished items cached | Go and pytest tests (ADR 0015) |
| Analysis time per hour of audio | TBD - depends on model and hardware | Measured in Phase 8; sets guidance, never invented here |
| `recordedFraction` | Set from measurement for every chapter with a `complete` analysis at the current fingerprint; absent otherwise | Go payload tests, UI tests |
| Gate | `pnpm check` green each phase; visual suite reviewed at four viewports for UI phases | CI and PNG review |

## Open Questions

- [x] **Q1. At what unit is coverage reported?** Options: (A) word-level alignment, reported per paragraph with region first and last words; (B) sentence-level; (C) word only. Recommendation: A. Sentence units are recomputed with no stable ids (`compare.py:314-337`); paragraph ids `p-NNNNNN` are stable within a `documentId` and already carried (`compare.py:792`). **Answered 2026-09-23:** A: word-level alignment, reported per paragraph by the stable `p-NNNNNN` ids, each region naming its first and last words.
- [x] **Q2. Is `SequenceMatcher` good enough for coverage, or is a true DP/LCS alignment needed?** Options: (A) reuse the existing opcodes; (B) a word-level DP alignment (semi-global, banded around the SequenceMatcher path to bound cost); (C) both, keep whichever is more conservative. Recommendation: decide in the Phase 2 spike on the fixtures (retake beats good read, repeated refrain, pickup at the end, unrelated speech). Default A, because one alignment means coverage and markers cannot disagree; move to B only if A under-covers on fixtures or the corpus. Under-coverage is the safe direction, so A failing means noise, not false "done". **Answered 2026-09-23:** A: reuse `SequenceMatcher` unless the Phase 2 spike fixtures fail, then move to the DP alignment (B).
- [x] **Q3. What are the thresholds and their defaults?** Options: (A) two narrator-facing settings, `min_paragraph_present` and `max_missing_run`, plus two alignment settings, `max_misread_run` and `min_anchor_run`; (B) one percentage; (C) constants. Recommendation: A, conservative starting values labeled Proposed (assumption, calibrate on the corpus): 0.95, 3 words, 8 words, 3 words. One percentage cannot separate a 20-word skipped block from scattered ASR drops. Settings live in the layered store (D10) using DX-2's numeric kind, not a duplicate. **Answered 2026-09-23:** A: the four settings `min_paragraph_present`, `max_missing_run`, `max_misread_run` and `min_anchor_run`, starting at 0.95, 3, 8 and 3; the values stay Proposed and uncalibrated (see Q15).
- [x] **Q4. Can Front Matter (`opening`) be a target?** Options: (A) no, narration chapters only; (B) yes, by loosening the filter for coverage. Recommendation: A for v1: the compare filter excludes it (`compare.py:784`), the estimate panel filters to narration (`AudiobookEstimatePanel.tsx:63`), and a status recommendation has no surface for it. **Answered 2026-09-23:** A: narration chapters only; Front Matter is not a target.
- [x] **Q5. Active take only, or all takes?** Options: (A) active take of each item; (B) all takes. Recommendation: A. The chapter as heard is the active takes; Lua does the same (`narration_ui_bridge.lua:139`). Needs EL's active-take parse; until then a multi-take item is `unknown`, not guessed. **Settled:** A, by EL's delivered active-take parse: ADR 0100's item fingerprint includes the active-take index, and `apps/desktop/internal/evidence/staleness.go` analyzes `item.Active()` and reports a `take_switched` reason.
- [x] **Q6. Precedence between the standalone (saved `.rpp`) path and a live Transcript Compare run?** Options: (A) the signal uses only the standalone path; a Compare run never feeds it; (B) also accept `COVERAGE|` lines from a Compare run; (C) prefer live. Recommendation: A for v1: one manifest builder, one basis ("saved project, file modified <time>", D6). B is a Could once the mode exists (a flag that emits coverage lines from the existing run), with its own basis label. **Settled:** A, by ADR 0100 and the recorded "No new Lua in the MVP" decision: the signal reads the saved `.rpp` only.
- [x] **Q7. Which Whisper model, and what time budget?** Options: (A) the narrator's configured `model_size` (`apps/desktop/app.go:645`); (B) a coverage-specific setting; (C) a fixed model. Recommendation: A, with the model recorded in every ledger record and evidence line. Phase 8 measures `small` against one larger model on the corpus for both missing-word rate and time and records the result; no time figure is claimed here. **Answered 2026-09-23:** A: the narrator's configured `model_size`, with the model recorded in each ledger record; Phase 8 compares one larger model.
- [x] **Q8. Reuse the teleprompter tracker for coverage?** Options: (A) no; (B) yes for a cheap live estimate. Recommendation: A. Its tokenization lacks homophone, number and hyphen handling, and its `done` is a cursor position (Evidence). A separate estimate that disagrees with this one would make a second, contradictory "done". **Answered 2026-09-23:** A: the teleprompter tracker is not reused.
- [x] **Q9. Multi-item and multi-track chapters.** Options: (A) many items on one track, concatenated in position order (as `prepare_compare` does), overlaps and gaps reported in evidence; multi-track chapters `unknown`; (B) also merge several tracks. Recommendation: A, v1 = one track per chapter (D5). Overlapping items are reported, not merged. **Settled:** A, by D5 and ADR 0100: many items on one track are concatenated in position order; a multi-track chapter is `unknown`.
- [x] **Q10. Muted items.** Options: (A) exclude muted items and list them in evidence; (B) include them as `prepare_compare` does. Recommendation: A: a muted item is not part of the chapter as heard. Needs EL to parse item mute (D6 fingerprint includes it); the Lua and standalone paths then differ and the evidence says so. **Answered 2026-09-23:** A: muted items are excluded and listed in evidence. EL now parses mute (`tracks.Item.Muted` in `apps/desktop/internal/tracks/tracks.go`, `LedgerItemFact.Muted` in `apps/desktop/internal/evidence/ledger.go`, and the `item_muted` reason in `staleness.go`).
- [x] **Q11. Spoken title and subtitle.** Options: (A) optional and excluded from the denominator, never counted as extra; (B) required; (C) title optional, subtitle required. Recommendation: A. Narrators differ; `compare.py:1514-1522` already treats the title as optional. Missing head text after the title still counts. **Answered 2026-09-23:** A: spoken title and subtitle are optional, excluded from the denominator and never counted as extra.
- [x] **Q12. What fills `recordedFraction` for a chapter with no measurement?** Options: (A) leave it absent and keep the status guess as a labeled "estimated from status" fallback (`diagnostics-delivery-and-cleanup-tools.prd.md` DX-8 keeps its own fallback); (B) drop the guess (unmeasured chapters count zero); (C) fill it from recorded duration. Recommendation: A, with measured values winning and the row labeled "measured" or "estimated". B changes every existing user's headline number; C divides a measured duration by an estimated duration, which is still a guess (ADR 0015). `recordedFraction` means share of the chapter's words present; DX-8 should expose recorded seconds separately. **Settled:** A, by `apps/ui/src/components/home/AudiobookEstimatePanel.tsx`, which already falls back with `recordedFraction ?? RECORDED_FRACTION[status]`; the measured or estimated label is still Phase 6 work.
- [x] **Q13. Is a record valid when parameters differ from the current settings?** Options: (A) any `complete` record at the current item fingerprint counts, labeled with its model and parameters; (B) parameters must match. Recommendation: model and language: A (they describe how, not what, and evidence names them); alignment parameters (`max_misread_run`, `min_anchor_run`): B, because they change which words count. Re-aligning from cached words is cheap CPU (cost TBD - benchmark); the narrator triggers it, it is not silent. **Answered 2026-09-23:** model and language need not match (the record is labeled with them); alignment parameters must match. Implemented by keeping model and language out of RC's parameter hash, because EL's `EvaluateFingerprints` (`staleness.go`) marks any parameter-hash difference stale; see Phase 4.
- [x] **Q14. When does a coverage run start?** Options: (A) on demand only ("Check recording", and SR's "Check now"); Home load reads cached results and recomputes staleness cheaply; (B) automatic after project save; (C) a background job. Recommendation: A, because a run costs minutes of ASR (TBD - measure) and the saved-file basis makes an automatic run surprising. **Answered 2026-09-23:** A: on demand only; Home reads cached results.
- [x] **Q15. Where is the annotated corpus stored?** Options: (A) audio outside the repo behind a directory variable (as DX-3 gates the EBU files), labels and expected results committed; (B) audio in the repo. Recommendation: A: permissions, size, and the manuscripts may be copyrighted. Committed text-only fixtures use public-domain text (the repo's Alice mock, `apps/ui/src/api/aliceManuscript.ts`). **Answered 2026-09-23:** synthetic fixtures for now, overriding the recommendation of an owner-supplied corpus. Phases 1 and 8 build on constructed fixtures, thresholds ship as Proposed defaults labeled uncalibrated, and a real permissioned corpus (audio outside the repo, as in A) can replace them later.

## Users & Context

**Primary User**

- **Who**: A narrator (often also the editor) recording in REAPER on Windows, chapter by chapter, with retakes, false starts and edits inside the same track.
- **Current behavior**: Reads back through the chapter or trusts memory, then moves the status dropdown by hand.
- **Trigger**: A recording session ends, or the narrator wants to know what is left before editing.
- **Success state**: The app says how much of the text is on the track and names the missing passages; when nothing is missing, it suggests moving on and the narrator confirms.

**Job to Be Done**: When I think a chapter is recorded, I want the app to check the text against what is on the track and show me what is missing, so that I stop editing a chapter that has a hole and stop re-listening to a chapter that is complete.

**Non-Users**: Reviewers receiving reports; anyone expecting the app to judge the reading; narrators not using REAPER (no other DAW parser exists).

## Solution Detail

### Definitions (proposed; the Phase 1 fixtures set the numbers, Q15)

- **Body tokens**: the chapter's paragraph tokens after `tokenize` and `merge_number_words`, excluding the title tokens (unit `-1`). A spoken subtitle is not in the token stream at all (canonical `subtitle` is not read).
- **Present**: a body token in an `equal` block of at least `min_anchor_run` tokens (a shorter block with non-equal neighbors on both sides is a chance match and does not count), or in a `replace` block of at most `max_misread_run` tokens, where up to `min(doc_len, audio_len)` tokens count as present (a misread is present; a larger `replace` block is treated as different text, not a misread).
- **Missing**: a body token in a `delete` block, the surplus of a `replace` block, or a chance match. Head and tail deletes count as missing here, unlike today's markers.
- **Extra**: transcript tokens in `insert` blocks or a `replace` surplus; a false start, retake, aside or spoken subtitle. Never counted against the narrator.
- **In order**: the alignment is monotone, so a paragraph found only out of place (a pickup recorded at the end) is not present in place.
- **Regions**: `head` (missing run before the first present body token), `tail` (after the last), `skip` (a `delete` block inside the aligned span), `short_read` (a `replace` surplus inside the span), `different_text` (a `replace` block above `max_misread_run`). Each region carries paragraph ids, token count, first and last missing words, and the position of the neighboring present words as item GUID plus source time.
- **Per paragraph**: present fraction and the longest consecutive missing run. Runs are counted in chapter order across paragraph boundaries.
- **Chapter `text_complete`**: every body paragraph has present fraction at or above `min_paragraph_present`, and no missing run, including head and tail, exceeds `max_missing_run`. The chapter present-word fraction is reported on every `complete` record and feeds `recordedFraction`.

### Signal semantics (D2)

| State | When |
| --- | --- |
| `met` | Confirmed track-to-chapter mapping; `complete` record at the current item fingerprint and manuscript-chapter hash; alignment parameters match (Q13); `text_complete` true |
| `not_met` | Same, but a threshold is violated; the reason names the largest region (for example "paragraph 12: 14 words not read") |
| `unknown` | Never analyzed; stale fingerprint or manuscript; `partial` or `failed` record; unconfirmed or missing mapping; item source missing or undecodable; model not installed; multi-take item before EL's active-take parse (D2: `unknown` is never `met`) |

Evidence entries are typed: `coverage` (present, missing and extra token counts), `region` (kind, paragraph ids, first and last words, source file and time range), `items` (count, total played seconds, muted or overlapping items skipped), `analysis` (model, language, alignment parameters, thresholds). The basis is ledger record ids, the fingerprint, and the project file's modified time. The stage is `recording`; the umbrella evaluates it only while the chapter status is `recording` (D3).

### Core Capabilities (MoSCoW)

| Priority | Capability | Notes |
| --- | --- | --- |
| Must | Per-paragraph present fraction, longest missing run, typed regions | Phases 2-3 |
| Must | Head and tail counted as missing; misreads, extras and title/subtitle not counted against | Definitions |
| Must | Additive sidecar mode; marker output unchanged | Phase 3 |
| Must | Per-item persisted transcript words, keyed through the EL cache | Phases 3-4 |
| Must | Standalone Go manifest from the saved project; no REAPER | Phase 4 |
| Must | Job with real progress and cancel; ledger record per run | Phase 4 |
| Must | `recording` signal, tri-state with evidence and basis | Phase 7 |
| Must | Synthetic fixture set and calibration before defaults ship, labeled uncalibrated (D12, Q15) | Phases 1, 8 |
| Must | Fix the untrue test claim in `transcript-compare.md:49` and add the missing tests this feature needs | Phase 2 |
| Should | `recordedFraction` filled from measurement (D11) | Phase 5 |
| Should | Home "Check recording" action and region detail | Phase 6 |
| Should | DP alignment if the spike shows SequenceMatcher under-covers | Phase 2 |
| Could | `COVERAGE|` lines from a live Compare run (Q6 B) | After Phase 3 |
| Could | Play from a region via `/media` | Phase 6 follow-up |
| Won't | Status changes, accuracy judgment, forced alignment, Lua, pickup relocation | See table above |

### MVP Scope

Phases 2 to 5 and 7 deliver the signal and the measured fraction; the umbrella's Home UI renders the evidence and its "Check now" calls this PRD's binding. Phase 1 (the synthetic fixture set) gates defaults and is the precondition to shipping any threshold; shipped thresholds are labeled uncalibrated (Q15). Phase 6 (this PRD's own Home action and detail dialog) can follow.

### User Flow

1. The narrator records and saves the REAPER project. The saved file is the basis; the UI says "saved project, file modified <time>".
2. In the Home breakdown the narrator presses Check recording for a chapter (or the umbrella's Check now). If the track is not mapped, the narrator confirms the mapping first (EL); an unconfirmed fuzzy match is never used.
3. Progress is real: decoding and transcribing each item that is not already cached, then aligning. Cancel leaves finished items cached.
4. The result reads "text present: N of M words" with regions: "paragraph 12: 14 words not read", "tail: paragraphs 38 to 40 not read". Each names the manuscript paragraph and the audio position.
5. The narrator records the missing text, saves, and checks again; only the changed item is transcribed.
6. When every paragraph passes, the umbrella can suggest moving the chapter to Editing; the narrator confirms or dismisses.

## Technical Approach

**Feasibility**: MEDIUM. The alignment and tolerances exist (HIGH). Cost is transcription time and correctness of the "complete" call, which the corpus decides (MEDIUM). The standalone manifest depends on EL's parser extension, which needs a REAPER-saved multi-take fixture (TBD - needs one from the user).

**Architecture**

- **Sidecar mode.** New module `sidecars/transcript-compare/core/coverage.py` imported by `compare.py`, entered by an additive flag in the same argparse block as `--extract-hints` (`compare.py:1598-1626`); `run()` and the marker path are untouched. Input: the manifest (`index|source_file|startoffs|length` per item plus a words-cache path per item), the manuscript, a chapter id (the `--chapter-title` bypass at `:1463-1468` is the precedent for skipping name matching), alignment parameters. Behavior: for each item, reuse the words file if it exists, else decode (`decode_segment`, `:386`) and transcribe (`transcribe` or `transcribe_chunked`) and write it atomically (temporary file then rename), so a cancelled run keeps finished items. Then align, then write results.
- **Words file.** One JSON per item: schema version, words as `(word, start, end)` with times relative to the played range start, and the parameters that shaped them (model, language, hotwords hash from `vocabulary_hints.txt` at `compare.py:1478-1485`, VAD flag, chunk parameters). The file name is the cache key computed by Go (D8: source identity, played range, analyzer version, parameter hash), so the sidecar never interprets key semantics. Storage location, retention and `resetDerived` handling are EL's (proposed `narration-utils/analysis/`).
- **Output.** A results file separate from the compare results, one JSON payload per line after a tag: `COVERAGE|{chapter summary}`, `COVERAGE_PARAGRAPH|{...}`, `COVERAGE_REGION|{...}`. JSON payloads avoid the field-count hazard ADR 0008 records for `MARKER`. Existing readers ignore unknown tags (`narration_ui_bridge.lua:200-204`).
- **Progress and cancel.** Same `stage|pct|message` progress file and `.cancel` file protocol (`compare.py:122-126`); stages DECODE, TRANSCRIBE (seconds processed over total played seconds), ALIGN, WRITE. Exit code 2 on cancel (`:1654`).
- **Go service.** New `apps/desktop/internal/coverage` package: builds the manifest from EL's extended parser (active take, `SOFFS`, `PLAYRATE`, mute, item GUID, source identity; played range `[SOFFS, SOFFS + LENGTH * PLAYRATE]`, D6), mirroring `prepare_compare`'s `length*rate` (`narration_ui_bridge.lua:151`); resolves cache keys and paths through EL; launches the sidecar the way the transcript service does (`service.go:388-409`); tails progress; writes one ledger record per run (analyzer id and version, parameter hash, scope of chapter id, track guid and item guids, fingerprint at run time, times, outcome `complete | partial | failed`, summary counts; D7); evaluates thresholds on read. One job at a time. Only the active take's chapter items are analyzed.
- **Manuscript basis.** The record stores `documentId`, chapter id and a hash of the chapter's paragraph ids and text. A re-import or text change makes the record stale (chapter ids are positional and reset, `service.go:403`, `:434-441`).
- **Bindings.** `CoverageStart`, `CoverageState`, `CoverageCancel`, `CoverageResult(chapterId)`, contract `coverage.ts`, mock, `wailsClient` adapter. The manuscript chapter payload gains `recordedFraction` from the stored result through a small provider interface (the manuscript package does not import coverage).
- **Signal.** A pure Go function from (record, current fingerprint, mapping state, settings) to the umbrella's `Signal`, table-tested. `unknown` is the default branch.
- **Settings.** The four thresholds in the layered store (D10) using DX-2's numeric kind; conservative built-in defaults mirroring `config/defaults.json`; no numbers claimed until Phase 8.
- **Media.** `/media` authorizes only the first `<SOURCE>` per item (`apps/desktop/media.go:51-64`); play-from-region works for the active take only if that is the first source. EL's active-take parse must extend this if they differ.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| False "complete" from chance matches or different text of the same length | Medium | `min_anchor_run`, `max_misread_run`, unrelated-speech fixture, zero-false-met corpus gate (Q3) |
| SequenceMatcher greedy anchoring drops a good later pass (under-coverage) | Medium | Phase 2 spike with DP comparison; the failure is a false "not met", the safe direction |
| Whisper drops or garbles words (invented names, numbers, quiet speech, VAD filtering, `compare.py:513`) so text looks missing | High | Existing equivalences and vocabulary hints; region evidence lets the narrator judge; measure on corpus; never auto-decide |
| Saved `.rpp` lags the open project | High | Basis label; EL fingerprint; tell the narrator to save before checking |
| Transcription time on hour-long chapters | High | Per-item cache, real progress, cancel, model choice (Q7), measure in Phase 8 |
| Chapter ids and `documentId` reset on re-import | Medium | Manuscript hash in the basis; stale becomes `unknown` |
| Coverage and marker alignments disagree | Medium | Reuse the same opcodes if SequenceMatcher suffices (Q2) |
| Multi-take items or a wrong first-take source in the static parser | Medium | `unknown` until EL's active-take parse and fixture exist |
| A precise-looking percentage overstates accuracy | Medium | Show counts and regions first; label "text present", not "correct" |
| Merge conflicts in `compare.py`, `bindings.go`, `AudiobookEstimatePanel.tsx` | High | New module for logic; see the compatibility table |

## Implementation Phases

Every phase follows the `CLAUDE.md` workflow: plan (find or open the tracking issue first and put `Closes #<n>` in the PR, `docs/operations/github-workflow.md`), `change-impact-scan` (before touching `apps/desktop/internal/tracks`, `compare.py` or shared UI), TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard` for primitives or `styles.css`, `feature-cleanup`. No phase adds Lua, so no manual REAPER checklist is required; one optional user-run cross-check is in Phase 8. Phases that add a host binding bump `hostAPIVersion` in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:39-42` and `apps/ui/src/hostApi.ts:2` (5 at d5cc994; a phase landing second increments again, so check at merge) and regenerate `apps/ui/wailsjs/go/main/Host.{js,d.ts}`. UI phases add rows to `apps/ui/tests/visual/state-catalog.ts` and drivers in `app.drivers.ts`, pass the Playwright visual suite at desktop, small-desktop, tablet and mobile with every PNG opened and reviewed, add Storybook stories for new primitives and refresh doc screenshots. ADRs are written with `adr-author` after code lands; take the next free number at merge time (0027 at d5cc994; PR #44 uses 0027-0035).

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Synthetic fixture set and harness | Constructed chapters with per-paragraph labels and expected results, committed (Q15: synthetic for now); a harness that reports verdict and region accuracy and can later take a permissioned corpus behind a directory variable | complete | 2, 3, 4 | - | [protocol](../research/recording-coverage-fixtures.md), [ADR 0125](../adr/0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) |
| 2 | Coverage model and alignment spike | Pure Python coverage over opcodes, text-only fixtures, SequenceMatcher vs DP decision; partial-recording and title-read tests; correct `transcript-compare.md:49` | complete | 1 | - | [spike](../research/recording-coverage-alignment-spike.md), [ADR 0126](../adr/0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md) |
| 3 | Sidecar coverage mode | `--coverage` flag, per-item words files, `COVERAGE|` output, progress and cancel; hand-made manifests in tests | pending | 1 | 2 | - |
| 4 | Go coverage service | Manifest from the saved project, cache keys via EL (model and language kept out of the parameter hash, Q13), job, ledger record, results reader, manuscript hash basis | pending | 1 | 3, EL-1, EL-3, EL-4 | - |
| 5 | Bindings, contract and recordedFraction | Start/state/cancel/result bindings, `coverage.ts`, mock, `recordedFraction` on the chapter payload, host API bump | pending | 1 | 4 | - |
| 6 | Home check action and region detail | Check recording per chapter row, progress, detail dialog with regions, measured vs estimated label, visual states, docs | pending | 7, 1 | 5, EL-5 | - |
| 7 | `recording` signal and settings | Pure signal function, threshold settings, staleness and mapping rules, unknown reasons | pending | 6, 1 | 5, DX-2, EL-6, EL-5, SR-1 | - |
| 8 | Calibration, defaults and close-out | Run the synthetic fixtures end to end, ship Proposed defaults labeled uncalibrated, record model and time findings, ADRs, docs, optional manifest cross-check | pending | - | 1, 4, 7 | - |

### Phase Details

**Phase 1 - Synthetic fixture set and harness**
- **Goal**: Ground truth before any threshold is set (D12), built from constructed fixtures (owner decision 2026-09-23, Q15).
- **Scope**: A protocol note in `docs/research/` and a harness over synthetic fixtures: public-domain chapters rendered or assembled into constructed recordings (and text-only variants), each with per-paragraph labels `present | partial | missing` and the expected chapter verdict, all committed. The harness keeps a directory-variable hook (skipped when unset) so a real permissioned corpus, audio outside the repo, can replace or extend the synthetic set later. Conditions: complete; truncated tail; late start; mid-chapter skipped paragraph; skipped sentence; retakes and false starts left in; repeated refrain; title omitted, title read, subtitle read; a pickup recorded at the end; several items with trimmed dead air; invented names and spoken numbers. Size TBD - Proposed 3 to 5 constructed chapters plus per-condition variants (assumption; ER needs its own editing corpus, so agree the harness layout once). The committed text-only fixtures for Phase 2 use public-domain text.
- **Success signal**: The harness runs on the synthetic fixtures with a stub analyzer and reports the label table; no owner-supplied audio is required.
- **Delivered 2026-09-23**: 4 chapters (3 public-domain *Alice* excerpts, 1 constructed), 16 text-only cases (9 `tune`, 7 `held_out`) covering every condition above plus misread, unrelated speech and trimmed-out text; `sidecars/transcript-compare/tests/coverage_harness.py` with the order-blind `presence_stub` and the `NARRATION_COVERAGE_CORPUS` hook; protocol and baseline table in `docs/research/recording-coverage-fixtures.md`; format in ADR 0125 (Proposed). Audio rendering (for example Piper) is left to Phase 8, outside the repo.

**Phase 2 - Coverage model and alignment spike**
- **Goal**: A tested pure function and a decision on the alignment.
- **Scope**: `coverage.py` computing present, missing and extra tokens, per-paragraph figures and regions from `(chapter_norm, unit_idx, paragraph ids, opcodes)` per the Definitions; text-only fixtures generated from public-domain text by programmatic drop, swap and insert; fixtures for retake-beats-good-read, repeated refrain, pickup at the end, unrelated speech, omitted and read title, read subtitle, number and hyphen tolerance; a DP prototype benchmarked on a full-chapter-size input (runtime TBD); the decision recorded. Adds the partial-recording and title-read tests missing today and rewrites `docs/utilities/transcript-compare.md:49` to state what is actually tested.
- **Success signal**: Every fixture has an expected result; the spike records SequenceMatcher-or-DP with the measurements; the marker output of `diff_and_build_markers` is byte-identical before and after.
- **Delivered 2026-09-23**: `sidecars/transcript-compare/core/coverage.py` (pure, over the markers' own alignment, which now also carries `doc_tokens` and `audio_tokens`); chance matches fold into the gap around them and the misread bound applies per gap (ADR 0126, Proposed); title and subtitle are optional heading tokens (Q11). Spike: SequenceMatcher kept (Q2 A) with 0 false met and 0 false not met on the 16 committed and 104 generated cases, every committed label agreed; the LCS prototype had the same verdicts, worse labels, twice the time (118 ms against 62 ms on 6,000 tokens) and a 66 MiB matrix. Both misplace a pickup longer than the text after its place (verdict still not complete). Markers held byte-identical by `tests/test_marker_golden.py`; partial-recording, title-read, number, homophone, compound and invented-name marker tests added; `transcript-compare.md:49` rewritten. Record: `docs/research/recording-coverage-alignment-spike.md`.

**Phase 3 - Sidecar coverage mode**
- **Goal**: The sidecar can produce a coverage report from items without REAPER.
- **Scope**: The flag and mode per Technical Approach; words files written atomically and reused when present; `COVERAGE|`, `COVERAGE_PARAGRAPH|` and `COVERAGE_REGION|` lines; progress stages and cancel; a documented exit-code contract; pytest with a fake transcriber so no model is needed in CI.
- **Success signal**: A hand-made manifest and pre-written words files give the expected report with no transcription call; cancel mid-run leaves finished words files and exits with code 2; existing `compare.py` tests are unchanged and green.

**Phase 4 - Go coverage service**
- **Goal**: The host runs a coverage analysis end to end from the saved project.
- **Scope**: `apps/desktop/internal/coverage`: manifest builder over EL's extended parser and played ranges, cache-key computation and lookup through EL, one job at a time, sidecar launch and progress tail, results reader, ledger record on every outcome, manuscript hash basis, tests with a fake sidecar; no binding yet. Multi-take items and unmapped tracks return a typed `unknown` reason. The parameter hash passed to EL's `EvaluateFingerprints` covers only the alignment parameters (`max_misread_run`, `min_anchor_run`) and what shapes the words; model and language stay out of it and are recorded on the record instead, because any parameter-hash difference marks a record stale and Q13 says a different model or language must not.
- **Success signal**: Service tests pass for fresh run, all-cached run (no sidecar transcription work), one-item edit (only that item recomputed), cancel (partial record, finished items cached), failed sidecar, missing source, re-import, a model or language change (still current) and an alignment-parameter change (stale).

**Phase 5 - Bindings, contract and recordedFraction**
- **Goal**: The UI can start, watch and read a coverage run, and the panel gets a measurement.
- **Scope**: Bindings, `contracts/coverage.ts`, `mockApi.ts` and `mockFixtures.ts`, `wailsClient` adapter and test, the provider that sets `recordedFraction` in `chapterPayload` only for a `complete` record at the current fingerprint, host API bump, regenerated Wails bindings.
- **Success signal**: Contract, adapter and payload tests; `recordedFraction` absent when stale, partial or unmapped; the mock exercises the same states as the host.

**Phase 6 - Home check action and region detail**
- **Goal**: A narrator can run the check and read the result.
- **Scope**: A per-row "Check recording" action and progress on the Home breakdown, a measured or estimated label on the recorded column, a detail dialog listing regions with paragraph and audio position and a link to the paragraph in the Manuscript page, the mapping prompt (EL's flow), empty, running, error, stale and unknown states, `state-catalog.ts` rows and drivers, stories for any new primitive, `docs/guides/using-the-app/home.md` and screenshots.
- **Success signal**: All states reviewed as PNGs at four viewports with no sideways overflow; the visual suite and `pnpm check` green.

**Phase 7 - `recording` signal and settings**
- **Goal**: The umbrella gets a correct, conservative signal.
- **Scope**: The pure signal function and its table tests; the four settings via DX-2's numeric kind with validation and defaults; stale and unknown reasons; evidence typing; no UI beyond the settings screen rows.
- **Success signal**: The table covers met, not met and every unknown cause (never analyzed, stale fingerprint, manuscript change, partial or failed record, unconfirmed mapping, multi-take, model missing); `unknown` is never `met`; the same inputs give the same signal.

**Phase 8 - Calibration, defaults and close-out**
- **Goal**: Defaults that the synthetic fixtures support, labeled uncalibrated, and an honest account of cost.
- **Scope**: Run the synthetic fixtures through the shipped path; choose defaults and ship them as Proposed, labeled uncalibrated in settings and docs until a real permissioned corpus recalibrates them (Q15); record the false-met and false-not-met tables, the model comparison (Q7) and the measured time per audio hour; record the Q2 outcome; ADRs (coverage definition as an additive sidecar mode that extends ADR 0008, and any alignment change) written with `adr-author`; `docs/utilities/transcript-compare.md` and the Home guide updated; optional user-run check that the standalone manifest matches a Lua `manifest_<run>.txt` for one chapter (read-only, needs the user's go-ahead to run REAPER); `feature-cleanup`.
- **Success signal**: Zero false "met" on the held-out synthetic fixtures, or defaults tightened until it is zero and the remaining cost stated; the defaults are labeled uncalibrated; measured results written down; docs and ADRs consistent.

### Parallelism Notes

Phase 1 builds constructed fixtures and runs beside everything. Phases 2 and 3 are a chain in the sidecar; 3 needs the definitions from 2. Phase 4 needs EL's parser, ledger and cache and can start against fakes. Phases 6 and 7 both need 5 and touch different files, so they run in parallel; 7 also needs the umbrella's contract and DX-2. Phase 8 is last.

### Parallel-session compatibility

| Phase | Files touched | Who else collides |
| --- | --- | --- |
| 1 | `docs/research/` (protocol note), corpus manifests and gated harness under `sidecars/transcript-compare/tests/` | `editing-readiness-analysis.prd.md` builds its own corpus; agree one harness layout |
| 2 | New `sidecars/transcript-compare/core/coverage.py` and tests, `docs/utilities/transcript-compare.md` | TR phase 3 and TM phase 6 also add or touch modules in the same folder; keep new logic in new files |
| 3 | `compare.py` `main()` argparse block (next to `--extract-hints`), `coverage.py`, `libs/python/tests` | TM phase 6, TR phases 3 and 9 edit `compare.py`; the addition is a few lines, rebase is trivial |
| 4 | New `apps/desktop/internal/coverage/*`, `apps/desktop/app.go` construction, EL packages (read only) | EL phases (parser, ledger, cache); RD phase 2 edits `apps/desktop/app.go:173` constructor area |
| 5 | `apps/desktop/{bindings.go,app.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/*}`, `Host.{js,d.ts}`, `chapterPayload` in `apps/desktop/internal/manuscript/reader.go` | Every binding phase (host API number); DX-8 also fills the chapter payload (Q12) |
| 6 | `AudiobookEstimatePanel.tsx`, new coverage dialog component, `tests/visual/*`, `docs/images/ui/*`, `docs/guides/using-the-app/home.md` | SR's Home UI phase (same panel, badge and Confirm), DX-8 (same panel), any PRD adding a nav item (regenerates screenshots) |
| 7 | New signal file in `apps/desktop/internal/coverage`, `apps/desktop/app.go` `fieldSchemas` (`:678`), `config/defaults.json`, `Settings.tsx`, `mockFixtures.ts` | DX-2 (same numeric kind and maps), TM settings phases, SR engine |
| 8 | `docs/utilities/transcript-compare.md`, `docs/adr/`, `docs/research/` | ADR numbering across PRs; ER and PS close-outs |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Suggestions only; the narrator confirms (recorded user decision, D1) | Computed on read, never stored as truth | Auto-advance status | User request; draft ADR 0031 (PR #44) |
| Product boundary (recorded, `docs/roadmap.md:10`) | No comping, no acting judgment, no cloud | - | Roadmap |
| Real progress only (ADR 0015) | Progress from decoded and transcribed seconds; `recordedFraction` only when measured | Placeholder or status guess | ADR 0015 |
| No new Lua in the MVP (recorded decision) | Standalone Go path from the saved `.rpp` | Lua manifest | Works without REAPER; verified by hand later |
| Tri-state signal (D2) | `unknown` for never run, stale, unmapped, partial, unavailable | Boolean | A false "done" is worse than a false "not done" |
| Confirmed mapping is an input (D5) | Unconfirmed fuzzy match gives `unknown` | Trust `find_chapter_by_track_name` | `compare.py:900-955` can pick a wrong chapter |
| Played range and fingerprint (D6), ledger (D7), per-item cache (D8) | Consume EL's; ranges from `SOFFS` and `PLAYRATE` | Whole-file hash | Non-destructive edits do not change source media |
| D9 open-finding semantics | Not applicable in v1: coverage is a measurement, not a review item; if regions later become findings, D9 applies | Emit findings now | Avoids a contract amendment and a category |
| Thresholds in layered settings (D10) | Four numeric settings, conservative defaults | Constants | Narrator tuning; DX-2 provides the kind |
| Replace the guess (D11) | `recordedFraction` = share of chapter words present | Duration-based fraction | Measurement, not another estimate (Q12) |
| Validation fixtures before thresholds (D12, amended by Q15) | Phase 1 synthetic fixture set is the precondition, Phase 8 calibrates on it; defaults ship Proposed and labeled uncalibrated; a real permissioned corpus (audio outside the repo) can replace it later | Owner-supplied annotated corpus first | ADR 0008's gate for alignment changes; owner decision 2026-09-23: synthetic fixtures for now |
| Detector location (proposed) | Additive sidecar mode plus Go host | Go re-implementation | Tokenization lives in Python (`compare.py:216-311`) |
| Output format (proposed) | Tagged lines with JSON payloads in a separate results file | Extra `MARKER` fields | Field-count hazard (ADR 0008) |
| Threshold evaluation (proposed) | Go, on read | In the sidecar | A threshold change never re-runs ASR or alignment |
| Alignment (Q2) | SequenceMatcher unless the Phase 2 spike fixtures fail, then DP | DP now; both | Owner decision 2026-09-23; one alignment for markers and coverage |
| Misreads count as present, bounded by `max_misread_run` (Q3) | Bounded | Unbounded or accuracy floor | User: "even if there are mistakes"; bound stops different text of equal length from passing |
| Title and subtitle optional (Q11) | Excluded from the denominator, never counted as extra | Required; title optional and subtitle required | Owner decision 2026-09-23; narrators differ |
| Active take only (Q5) | Active take | All takes | Chapter as heard; settled by EL's active-take parse (ADR 0100, `staleness.go` `take_switched`) |
| On-demand evaluation (Q14) | Explicit run; Home reads cache | Automatic after save; background job | Owner decision 2026-09-23; minutes of ASR per run (TBD) |
| Coverage unit (Q1) | Word-level alignment reported per paragraph (`p-NNNNNN`), regions with first and last words | Sentence-level; word only | Owner decision 2026-09-23; paragraph ids are stable within a `documentId` |
| Threshold settings (Q3) | `min_paragraph_present` 0.95, `max_missing_run` 3, `max_misread_run` 8, `min_anchor_run` 3, Proposed and uncalibrated | One percentage; constants | Owner decision 2026-09-23; one percentage cannot separate a skipped block from scattered ASR drops |
| Targets (Q4) | Narration chapters only | Front Matter too | Owner decision 2026-09-23; the compare and estimate filters already exclude it |
| Model (Q7) | Narrator's configured `model_size`, recorded per record; Phase 8 compares one larger model | Coverage-specific setting; fixed model | Owner decision 2026-09-23; no second model setting to keep in step |
| Teleprompter tracker (Q8) | Not reused | Cheap live estimate | Owner decision 2026-09-23; a second, contradictory "done" |
| Muted items (Q10) | Excluded and listed in evidence | Included as `prepare_compare` does | Owner decision 2026-09-23; a muted item is not the chapter as heard; EL parses mute |
| Record validity (Q13) | Model and language may differ (labeled, kept out of the parameter hash); alignment parameters must match | Everything must match; nothing must match | Owner decision 2026-09-23; model and language describe how, alignment parameters change which words count |
| Corpus (Q15) | Synthetic fixtures for now; a permissioned corpus can replace them | Owner-supplied corpus, audio outside the repo | Owner decision 2026-09-23; unblocks Phases 1 and 8 without owner audio, at the cost of uncalibrated defaults |

## Research Summary

**Market Context**: No external product survey was done for this PRD (TBD - needs research). Prior art in the repo: Transcript Compare's markers, the live teleprompter's cursor (`script_tracker.py`), and the alignment trials planned under the local-dependency protocol (`docs/research/local-dependency-evaluation.md`, MFA and VAD sections, per docs). The RF and TR PRDs describe proofer-service pickup workflows; none reports chapter completeness.

**Technical Context**: The word alignment and tolerance machinery ships and is proven on discrepancy review, but its outputs for the head, the tail and per-paragraph presence are discarded, and transcript words are never persisted. Coverage is therefore mostly reuse plus three additions the repo lacks: a manifest built from the saved project, a per-item words cache, and a definition of "present" that resists chance matches. The main unknowns are measurable and are gated on a corpus: how often Whisper drops words in a clean read, how a greedy alignment behaves on retakes and refrains, and what a chapter costs in minutes. Forced alignment stays deferred under ADR 0008. Everything a narrator relies on for "done" stays a suggestion they confirm.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
