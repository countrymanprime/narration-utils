# LibriVox Alice: real narration of the demo script

Public-domain LibriVox readings of *Alice's Adventures in Wonderland*, the same Project Gutenberg text as the demo
manuscript (`apps/ui/src/api/fixtures/alice-in-wonderland.txt`), plus the tools that cut and mix them into test corpora
with known defects. The recordings are downloaded from archive.org when they are used; the repository holds where every
paragraph and sentence sits in them and the recipes for each test state
([ADR 0416](../../../../docs/adr/0416-librivox-readings-of-the-demo-script-are-fetched-from-archive-org-and-only-their-markers-and-recipes-are-committed.md)).

## What is here

| Path | What |
| --- | --- |
| `sources.json` | The seven recordings: archive.org URL, reader, chapter, MD5 (as archive.org publishes it) and SHA-256. All are unmodified LibriVox 64 kbps mono MP3s (22.05 kHz). `kara_01`, `02`, `07`, `09`, `10`, `11`: Kara Shallenberg's solo reading (2010). `leach_01`: Eric Leach's Chapter I (2010), whose head also holds the prefatory poem, which is not in the script. |
| `alignment/*.words.json` | Whisper `large-v3-turbo` word timings for each recording (`transcribe.py`, a maintainer step that needs the model). |
| `alignment/*.markers.json` | The markers: each paragraph's id, start and end, the cut points between paragraphs and between sentences, and whether each cut is in a real pause (`cuts_clean`, `sentence_cuts_clean`). `cuts_s[0]` ends the LibriVox preamble and title; the last cut starts the closing credit. |
| `recipes/coverage.json` | Recording-check cases: which paragraphs, sentences, room tone and foreign text each item holds. |
| `recipes/signal.json` | Signal defects and where they go: clipping, level shift, clicks, dead air, dropouts, hiss, room-tone change, head and tail. |
| `build.py` | Fetches the recordings and builds all three corpora into a directory outside the repository. |
| `sources.py` | Where the recordings are kept, and the checksum-verified download. |
| `alice_text.py`, `paragraph_spans.py`, `audio.py` | The manuscript, the alignment of script to audio (cuts land in the reader's pauses) and its markers, decoding, joining and writing. |
| `coverage_corpus.py`, `characters_corpus.py`, `signal_corpus.py` | One builder per corpus; each module's docstring is its recipe format. |

`sidecars/transcript-compare/tests/test_librivox_alice_corpus.py` checks, in `pnpm check` and with no network, that
at least 95% of each chapter's words are found in order, that the markers place every paragraph and sentence in order,
and that every coverage recipe builds a case the harness accepts. Once the recordings are fetched it also checks their
checksums, that the committed markers are the ones the recordings give, and that a signal edit is labelled where it was
made.

## Fetch the recordings and build the corpora

Needs only the sidecar's environment (numpy and PyAV), and archive.org the first time: no model, no GPU.

```bash
uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/build.py all --out ../narration-corpus
```

The first run downloads the seven recordings (about 45 MB) into `NARRATION_LIBRIVOX_DIR`, or
`~/.cache/narration-utils/librivox-alice` when it is unset, and keeps each only if its SHA-256 matches `sources.json`.
After that a build takes about 10 seconds. `build.py fetch` only downloads. `--out` must be outside the repository
(about 620 MB of WAV). Build one corpus with `coverage`, `characters` or `signal` in place of `all`. The build is
deterministic: the same recordings give byte-identical files.

## What each corpus is for

### `coverage/`: the recording check on real speech ([#425](https://github.com/countrymanprime/narration-utils/issues/425) item 3, ADR 0125, ADR 0132)

14 cases in ADR 0125's layout, 9 `tune` (Kara) and 5 `held_out` (Kara's Chapter X and all of Leach): complete chapters,
a skipped paragraph, a skipped sentence, a pickup read at the end, a truncated tail, a late start, a false start and
retake, three items, a paragraph replaced by another chapter's text, and a whole chapter whose script has editorial
notes the reader's edition does not (`notRead`). Every item keeps its LibriVox preamble or closing credit, which is
real unrelated speech. Labels follow the rules in
[recording-coverage-fixtures.md](../../../../docs/research/recording-coverage-fixtures.md) and are derived from the
recipe, so they are exact.

```bash
NARRATION_COVERAGE_CORPUS=../narration-corpus/coverage uv run --project sidecars/transcript-compare python sidecars/transcript-compare/tests/coverage_harness.py --corpus-only
uv run --project sidecars/transcript-compare python sidecars/transcript-compare/tests/coverage_calibration.py audio --corpus ../narration-corpus/coverage --model small=<model dir> --model medium=<model dir> --work ../narration-corpus/work
```

The first command validates the labels. The second runs the shipped sidecar and Whisper over the audio. Results are in
[recording-coverage-calibration.md](../../../../docs/research/recording-coverage-calibration.md#librivox-real-speech-2026-09-27).

### `characters/`: the character-continuity trial on one reader (N-D22)

462 clips from Kara Shallenberg's six chapters, in the trial's `manifest.json` layout: narration plus 11 characters.
A line is labelled only when the text names its speaker next to it ("'…,' said the Hatter"), and untagged lines are
left out. Alice, the Hatter, the March Hare, the Dormouse, the Gryphon, the Mock Turtle and the Queen appear in two
chapters or more, so leave-one-chapter-out has references for them.

```bash
cd scripts/research/character-continuity-acoustic-trial
uv run --no-project --with numpy --with praat-parselmouth python run_trial.py ../../../../narration-corpus/characters
```

Results are in [character-continuity-acoustic-trial.md](../../../../docs/research/character-continuity-acoustic-trial.md#real-speech-re-run-librivox-2026-09-27).

### `signal/`: the audio diagnostics on real narration (diagnostics, delivery and cleanup PRDs; ADRs 0158, 0236, 0238)

11 cases over the first 20 paragraphs of Kara's Chapter IX (3.8 minutes): an unedited control and one defect each.
`labels.json` gives every defect's time in the built file, and `<id>.words.json` the transcript words for pacing.

```bash
NARRATION_SIGNAL_CORPUS=../narration-corpus/signal go test ./internal/measure -run TestLibriVoxSignalCorpus -v   # from apps/desktop
```

The same corpus is the editing check's real-speech click evaluation (`go test ./internal/editing -run
TestClickBreathOnLibriVoxSignalCorpus`), reported in
[editing-click-breath-validation.md](../../../../docs/research/editing-click-breath-validation.md#real-speech-the-librivox-signal-set).

## Findings from the first run (2026-09-27)

`TestLibriVoxSignalCorpus`, with `measure.DiagnoseFile` and `measure.AnalyzeFile` at their defaults:

- **Found where they were put:** both clipped stretches, the -9 dB level shift (-8.8 LU, within 2 s), both dead-air
  gaps, both dropouts (as digital-silent windows), the -50 dBFS noise floor, the 0.15 s head and 12 s tail, and 2 ms
  clicks at -6 and -24 dBFS peak in the middle of a pause.
- **The unedited control** has no clipping, level shift or digital silence. It has 3 click candidates (real mouth
  noise or false positives, not yet listened to) and 12 room-tone segments over 3.8 minutes with no change in the
  room: the 6 dB step splits real narration many times.
- **Known issues** (logged, not failed; each case's `knownIssue` says why):
  - A click in a pause whose room tone sits at the -50 dBFS floor in 10 ms windows has no silent flank, so it is not
    offered (`kara_09-clicks`, the pause after paragraph 17).
  - A click just before a breath is folded into one breath candidate (`kara_09-click-before-breath`).
  - A rise in room tone under the silence floor is not seen: a silence's level is its mean, set by breath tails at
    -53 to -59 dBFS, so noise 11 dB over the -67 dBFS room moves it about 3 dB (`kara_09-room-tone-change`).
  - With a noise floor at or above -50 dBFS nothing is silence, so head and tail room tone read 0 s
    (`kara_09-noise-floor`, logged by the edge check).

## Add a case

Add a recipe to `recipes/coverage.json` or `recipes/signal.json` and rebuild. Edits land only at clean cuts: a
paragraph whose boundary is not in a real pause (`paragraph_spans.CLEAN_CUT_DB`) is refused with a message naming it.
If a check misses a defect because of a known limit, add `knownIssue` to the edit instead of deleting the case.

## Re-transcribe (maintainers only)

```bash
uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/transcribe.py --model <large-v3-turbo model dir>
```

This took 15 minutes on 16 CPU threads. Then rewrite the markers from the recordings and run the tests, since the
recipes' edit points depend on the cut points:

```bash
uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/build.py markers
```

Do the same if archive.org ever replaces a recording: its SHA-256 stops matching, the build refuses it, and
`sources.json`, the word timings and the markers are regenerated together.
