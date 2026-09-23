# Transcript Compare

Transcribes a chapter's narration track, matches it against the correspondingly-named chapter
in a Word script, diffs the two, and drops color-coded **take markers** at every
misread/skipped/extra word — plus saves a single diff file of the script text vs. what was
actually said.

## Layout

- `core/` — the DAW-agnostic Python backend (`compare.py`), plus `homophones.csv` and
  `common_words.txt`. No DAW APIs are used here; it's a plain CLI invoked by whichever DAW
  driver below is running it. Its dependencies are declared in the repo-root `pyproject.toml` and pinned in `uv.lock`.
- `core/coverage.py` — the recording-coverage model: how much of a chapter's body text the
  recording contains, in order, computed from the same alignment as the take markers. Not wired
  into a run yet; see `docs/research/recording-coverage-alignment-spike.md`.
- `tests/` — the pytest suite for the backend, plus the recording-coverage ground-truth harness
  (`coverage_harness.py`) and its synthetic labeled fixtures (`fixtures/coverage/`), and the
  alignment spike that scores `core/coverage.py` on them (`coverage_spike.py`); see
  `docs/research/recording-coverage-fixtures.md`.
- REAPER integration is centralized in `integrations/reaper/narration_ui_bridge.lua`; a future Audacity
  driver has placeholder notes under `integrations/audacity/transcript-compare/`.

## Pieces

- `core/compare.py` — the backend. Runs locally via faster-whisper (no cloud, no API key) +
  a word-level diff against the project's canonical manuscript. Runs under the repo-root shared venv (`.venv/`) so it doesn't
  depend on REAPER's or the system's Python.
- `core/homophones.csv` — the built-in homophone list (your/you're, its/it's, etc.)
  `compare.py` loads at startup. Plain text, one group per line, comma-separated - edit it
  directly if you want to add a globally-useful pair (for something manuscript-specific, use
  the per-project equivalence list instead - see "Handling invented names/words" below).
- `core/common_words.txt` — a stoplist of ordinary English words, used only by the config
  screen's **Suggest...** button (see "Handling invented names/words" below) to avoid
  suggesting common words that just happen to be capitalized mid-sentence.
- The React Narration Utils workspace owns this workflow and settings: its Settings page opens
  **Global**/**This Project** values for the default Whisper model and
  take-marker colors. Python runtimes are fixed local checkout dependencies
  managed by `pnpm run bootstrap`.
- Pick or replace the Word manuscript from the workspace Home page.

## Install as REAPER actions

In REAPER: **Actions → Show action list → New action → Load ReaScript...** and load just one
file, `integrations/reaper/NarrationUtils_Launcher.lua` (it does **not** need to live inside REAPER's
own Scripts folder) — it's the only script either tool needs imported into REAPER's Action
list. Running it opens the persistent, centered **Narration Utils** workspace.

Optionally assign the launcher a keyboard shortcut or toolbar button from the same action list
dialog.

Runtime dependencies are derived from this checkout's own location, so they
always use repo-managed local environments. Default model size is
`small`; use workspace Settings to change defaults or choose a one-run model
in the Transcript Compare page.

### Settings: global vs. this project

Everything set through the workspace (model size and marker colors) is layered:
a repo-wide
default, a per-user **Global** value, and an optional **This Project** override,
in that order. Global values live in
`%APPDATA%\narration-utils\global-settings.json`; a project override lives in
`<project folder>\narration-utils\settings.json`, alongside (not inside) the per-tool
`TranscriptCompare\` output folder. Both are DAW-agnostic plain JSON, not REAPER ExtState, so a
future Audacity adapter can reuse the same settings store instead of needing its own.

## How it's organized

**One track = one chapter.** The track's name is matched (exact, or closest fuzzy match)
against a heading in the Word document — so name your tracks to match your chapter headings
(e.g. track "Chapter 1" ↔ Word heading "Chapter 1"). Chapters are detected from Word's built-in
**Heading** styles; if none are found, you'll get a clear error listing what the doc actually
contains instead of silently comparing against the whole document. If the track name doesn't
confidently match any heading, the run pauses and the window shows a clickable list of every
detected chapter to pick from instead of failing outright — this check happens *before*
decoding/transcribing the audio, so a bad match (or a bad manuscript path) doesn't cost you a
multi-minute wait first.

## Using it

1. Select the **track** for the chapter you want checked. All items on that track are picked
   up automatically, in position order — no need to glue or render first, even if the take is
   split across several items (punch-ins, retakes, etc. all get stitched together for
   transcription).
2. Run **Narration Utils** from the action list, open **Transcript Compare**, and choose
   **Start comparison**.
3. The first time you run it in a project, import a DOCX or Markdown manuscript from Home. New PDF import is fail-closed pending corpus parity; existing canonical v1 data remains readable.
   It is normalized into `<project folder>\narration-utils\manuscript\manuscript.json`; every run
   reuses that canonical data with no source-file parsing. (The project must be saved
   at least once, since the manuscript is stored alongside the project file; for an unsaved
   project it falls back to prompting every run instead.)
4. The same responsive companion window stays open for the whole run
   — it's never closed and replaced by a separate dialog. It shows the track name, item count,
   and exact selected duration (so it's unambiguous that only your selection is being
   processed) while it resolves the manuscript, then shows a **config screen** before anything
   expensive starts:
   - **Manuscript** — the resolved path, with a **Change...** button to pick a
     different/updated one on the spot (same effect as the launcher's Select Manuscript entry).
   - **Model** — chip buttons for `tiny`/`base`/`small`/`medium`/`large-v3`; hover any chip for
     a tooltip explaining its speed/accuracy/memory tradeoff. Picking one here is a one-time
     override for this run only - it doesn't change the saved default. Click **Save as
     Default** next to the chips to make the current pick the new default instead (equivalent
     to setting it via **Configure**, without leaving this screen).
   - **Chunk** — `Whole file` (default, today's behavior) or a fixed duration
     (`30s`/`1m`/`5m`/`15m`/`1hr`) to transcribe in pieces instead of one pass over the whole
     recording. Useful for very long recordings - smaller units of work are more resilient to a
     mid-run failure and give much finer-grained progress. The diff/marker step is unaffected
     either way - it still runs once, over the full assembled transcript, so chunking doesn't
     change *when* markers appear, just how the transcription itself is done internally.
   - **Workers** (only shown once a chunk duration is picked) — how many chunks to transcribe
     at once, in parallel OS processes: `1`/`2`/`4`/`8` or `Auto` (picks a safe number based on
     the selected model size, since each worker loads its own full copy of the model into
     memory).
   - **Hints** — optional vocabulary hints (see "Handling invented names/words" below), plus a
     **Suggest...** button that scans the manuscript for likely candidate terms.

   Every field above has a hover tooltip explaining it, and **Cancel** / **Start** buttons at
   the bottom - Cancel here just closes the window, since nothing has been launched yet (same
   as closing the window itself).

   Click **Start** to actually begin. From there: a live progress bar through decode → model
   load → transcribe → match → diff, elapsed time, and a scrolling log of every step taken
   (including the backend's own detailed log — decoding each item, model loading, which
   chapter matched and why, warnings, etc.). The backend runs in the background the whole
   time, so REAPER's UI stays responsive. First run of a given model size downloads model
   weights once (cached after that). There's a Cancel button while running (or just close the
   window) to abort a run cleanly — no markers get added. Overall timeout: 30 minutes. The
   progress bar disappears once the run finishes (a static full bar left sitting there reads as
   stuck) — the outcome shows instead as a small DONE/ERROR/CANCELLED label next to the elapsed
   time.
5. When it finishes, the **same window**'s elapsed timer freezes. It defaults to showing the
   discrepancy table on success (white text on a black background:
   `Track | Time | Type | Manuscript | Recorded`) and the run log otherwise, but **Log** /
   **Table** / **Diff** / **Add Equiv** tabs above that pane act at will, in any run state:
   - **Log**/**Table** switch which one's showing.
   - **Diff** opens the saved diff (see below).
   - **Add Equiv** adds the currently-selected table row (click a row to select it) to the
     per-manuscript equivalence list - see "Handling invented names/words" below.

   The Manuscript and Recorded columns are separate, each showing that row's full text with
   only the actual difference colored — green in Manuscript ("this is what it should have
   said"), red in Recorded ("this is what was actually said") — shared words stay plain white.
   Both the table and the log scroll with the mouse wheel, and clicking a table row also
   selects that item and moves the edit cursor to it, so you can jump straight to any
   discrepancy. Nothing pops up as a separate dialog; click Close (or the window's own close
   button) when you're done reading it.
6. The workspace lists each discrepancy and whether a matching take marker already exists. Click **Export markers** when you want to add the new ones. Exported **take markers** appear directly on that track's items (not across the whole project),
   colored by kind:
   - `MISREAD: 'X' as 'Y'` (default red) — manuscript said X, you said Y
   - `SKIPPED: 'X'` — in the doc, not said (default amber)
   - `EXTRA: 'Y'` — said, not in the doc (default blue)

   A result is shown as already marked when the same active take contains a marker with the same
   `MISREAD:`, `SKIPPED:`, or `EXTRA:` prefix within ~0.15s. Export rechecks that condition before
   every add, skips duplicates, and reports the added/skipped counts.
7. A single **diff file** is saved to
   `<project folder>\TranscriptCompare\diffs\<track name>_<run number>.diff` on every run (in
   real unified-diff syntax - `---`/`+++`/`-`/`+` - so it's readable on its own in any editor
   with no external tool needed), but it's only *opened* when you click the **Diff** tab - not
   automatically. That tries a real interactive two-pane view first (`code --diff` against a
   plain manuscript/recorded text pair saved alongside it, if the `code` CLI is available), then
   also opens the standalone `.diff` file with whatever's associated with it. The exact saved
   path is always in the log either way.

## Handling invented names/words

Sci-fi/fantasy narration means character names, places, and invented terms that don't exist in
any dictionary — Whisper has no way to spell those consistently, and no model size fully fixes
that (a bigger model helps with real vocabulary it's just mishearing, not words it has
genuinely never seen). Two tools for this, both stored in `<project folder>\TranscriptCompare\`:

- **Vocabulary hints** (`vocabulary_hints.txt`) — set from the config screen before a run ("Set
  hints..."). A comma-separated list of names/terms passed to Whisper as `hotwords`, nudging it
  to recognize and spell them consistently. Best-effort, not a guarantee. The **Suggest...**
  button next to it scans the manuscript for capitalized words that aren't just
  sentence-initial (a decent proxy for invented names/terms), filters out ordinary words via
  `common_words.txt`, and pre-fills the hint editor with the results for you to
  review/edit/remove before saving - it never saves anything on its own.
- **Custom equivalence list** (`equivalences.csv`) — click **Add Equiv** on a selected
  single-word MISREAD row to append that exact spelling pair (e.g. "arelian, arelion") so it's
  never flagged again, starting with the next run. Same file format as `homophones.csv`, just
  per-manuscript instead of global. Only single words work, since matching happens one word at
  a time - a multi-word MISREAD row shows a reminder in the log instead of adding anything.

## Notes / limitations

- If you only select/record part of a chapter, the unrecorded rest doesn't produce SKIPPED
  markers — only genuine mid-recording skips do. The VS Code diff's manuscript side is trimmed
  to stop a sentence or two past the last thing actually recorded (using the diff's own
  alignment, not a fuzzy guess), with `...` marking where it was cut off before/after what you
  recorded. Both files are rendered one sentence per line, using the manuscript's own sentences
  as the line boundaries on both sides — a sentence that matches the manuscript exactly
  (ignoring case, punctuation, and how it was split across lines when read aloud) shows the
  manuscript's own text on both sides, so e.g. five short one-clause sentences the manuscript
  uses for dramatic effect but the narrator reads as one flowing, comma-joined sentence don't
  show up as a false diff. A genuinely misread or extra word still shows the real transcribed
  text on its line — and even then, only the actually-wrong word(s) fall back to Whisper's raw
  rendering. The rest of that line reuses the manuscript's own words verbatim, so one real
  misread next to a quote, a capitalized proper noun, a hyphenated compound, or a spelled-out
  number doesn't also paint those as "different" just because Whisper transcribed them a bit
  differently.
- The chapter heading/title text is included in what's diffed (not just the body paragraphs),
  since narrators typically read the title aloud - so a spoken title lines up against the doc
  instead of showing as a false "EXTRA IN AUDIO". The visual diff's audio side shows its own
  heading too (separate from the body, matching the doc side's structure), always using the
  manuscript's own title text — so "Chapter One" reads the same on both sides even if Whisper
  would have rendered the spoken number as a digit. A genuinely misread title still gets
  flagged as a normal MISREAD marker.
- Numbers are normalized before diffing, so "one" in the doc won't falsely flag against Whisper
  transcribing the spoken word as "1" (handles cardinal numbers up to billions, including forms
  like "one hundred and one"). Genuine number misreads (doc says 23, you said 24) still get
  flagged.
- Case, quotation marks, and typographic ("smart") apostrophes/quotes are all ignored for
  matching purposes - a Word apostrophe like "yesterday's" lines up correctly against Whisper's
  straight-apostrophe transcript instead of splitting into two words and showing a false
  MISREAD.
- A trailing possessive-'s is treated the same as a plain plural -s for any word ("sentinel's"
  and "sentinels" sound identical, so there's no way to actually misread one as the other).
- Common homophones (`homophones.csv` - your/you're, their/there/they're, its/it's,
  miner/minor, vane/vein, and several dozen more) are treated as equivalent, so Whisper
  transcribing a correctly-spoken word with the "wrong" spelling doesn't get flagged. Excludes
  any homophone that's also a number word (one/won, to/too/two, for/four, ate/eight), since
  aliasing those could interfere with number normalization above. See "Handling invented
  names/words" above for manuscript-specific spelling variance (invented proper nouns, etc.)
  that a general homophone list can't cover.
- A hyphenated rendering of a compound word (Whisper's "super-powered" vs. the manuscript's
  "superpowered") is treated as the same word too.
- Filler words (uh/um/erm/hmm) are stripped from the transcript before diffing so they don't
  spam markers.
- Multi-item stitching assumes a constant playrate per item (no time-stretching accounted for
  beyond a simple multiply).
- Diff granularity is per contiguous mismatched word-block; Whisper's own word timestamps have
  some jitter, so don't trust marker timing to the millisecond.
- Chunked transcription (the **Chunk**/**Workers** config-screen rows) splits only the
  transcription step - the diff/marker step still runs once over the full assembled transcript,
  same as whole-file mode. Chunks overlap by ~1.5s and duplicate words in that overlap are
  de-duplicated on reassembly, but this is a heuristic, not a guarantee - a chunk boundary
  landing mid-word/mid-sentence in an unlucky spot can still occasionally produce an extra or
  missing word right at the seam. Language auto-detection runs once (on the first chunk) and is
  reused for the rest when `--language` isn't forced, but each chunk's Whisper call otherwise
  has no visibility into its neighbors.
