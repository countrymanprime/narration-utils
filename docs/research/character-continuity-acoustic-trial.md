# Character Continuity Review: Phase 1 acoustic feature trial

Follow-up to [Local Dependency Evaluation and License Plan](local-dependency-evaluation.md)'s
[Evaluation protocol](local-dependency-evaluation.md#evaluation-protocol), run for Phase 1 of
[`docs/prds/character-continuity-review.prd.md`](../prds/character-continuity-review.prd.md)
("Acoustic feature trial and decision record"). Part of the
[agent train](../operations/agent-train.md) (stream N-D22), see
[#509](https://github.com/countrymanprime/narration-utils/issues/509).

**Status: provisional.** This trial ran on a synthetic corpus, not a real LibriVox reading
(see [Corpus route](#corpus-route)). It clears Phase 1's reject gate and gives the calibrated
numbers Phase 4/5 need to start, but every number here must be re-run on a real corpus - the
owner's own recordings, or a permissioned LibriVox reading once the sandbox can reach it -
before the thresholds ship. The exact command is in [Re-running this trial](#re-running-this-trial).

## Corpus route

The PRD's Phase 1 scope calls for a LibriVox solo dramatic reading: one reader voicing several
distinct characters, public domain, with hand-checked timestamps. Two attempts:

1. `curl` to `https://librivox.org/` and `https://archive.org/` through the sandbox's egress
   proxy both returned `403` at the CONNECT step. The proxy's own status endpoint
   (`http://127.0.0.1:41465/__agentproxy/status`) recorded both as
   `connect_rejected` / "gateway answered 403 to CONNECT (policy denial or upstream failure)" -
   not a certificate, proxy-configuration, or client bug the documented fixes in
   `/root/.ccr/README.md` address. That README is explicit that a 403/407 is an organization
   policy denial to report, not retry or route around.
2. No proxy fix applied, because none of the documented failure classes (cert trust, `405`,
   client ignoring the proxy, git config) matches a `403` policy denial. Reported here per the
   worker's instructions rather than worked around.

Per the owner's fallback rule, the trial therefore uses **a synthetic corpus**: controlled
pitch/rate/formant variants of one source voice, clearly labelled as synthetic throughout. It
is not real speech and not a Resemblyzer-style "voice" in any biometric sense - it is a
glottal-pulse-plus-formant-resonator signal model (`synthetic_corpus.py`) with independently
controlled fundamental frequency, three formant frequencies, speaking rate, and amplitude per
"character". Six voices: `narration` plus five characters (`the_captain`, `young_ellen`,
`old_marlow`, `widow_hart`, `page_boy`), each a deterministic parameter set (see the script's
`VOICES` table). Four synthetic "chapters", each narration plus 4 of the 5 characters (chosen
per chapter, so every chapter leaves at least one character out - closer to how a real solo
reading doesn't repeat every character every chapter). 108 lines total, 5-13 syllables each.
Seed `20260927`; regenerating with the same seed reproduces byte-identical WAVs.

**What this route can and cannot validate.** It can validate the *statistical method*: given
clips that really do differ per character, do the candidate feature engines recover that
difference, and can a stable threshold be calibrated? It cannot validate that a real narrator's
character voices are *this* separable - the synthesis parameters were chosen to be clearly
differentiated (the PRD's own "3-5 clearly differentiated characters" framing), which is likely
an easier case than a real narrator's subtler character work. Resemblyzer's own risk note (a
single narrator's characters will often embed as similar) is specifically about that gap, and a
synthetic corpus built for separability cannot surface it. This is the central reason the
decision below is provisional rather than final.

No real audio, no real narrator, and no LibriVox material of any kind is used or committed;
there is nothing to hand-check timestamps against because every label is exact by construction
(the generator writes both the WAV and the character/chapter/line label at synthesis time). If
the owner runs this on their own recordings, per-line hand-checked timestamps become necessary
again, exactly as the PRD's protocol describes.

## What ran

Three feature engines, one shared corpus, one shared evaluation ([`run_trial.py`](character-continuity-acoustic-trial/run_trial.py)):

| Engine | Module | Installed? |
| --- | --- | --- |
| Dependency-free baseline (Q1 option A) | [`features_baseline.py`](character-continuity-acoustic-trial/features_baseline.py) | Always (numpy only, already a repository dependency) |
| Praat via `praat-parselmouth` (candidate 6) | [`features_praat.py`](character-continuity-acoustic-trial/features_praat.py) | Yes, in an isolated venv outside the repo - `pip install praat-parselmouth` took 4s, no compiler needed |
| Resemblyzer (candidate 5) | [`features_resemblyzer.py`](character-continuity-acoustic-trial/features_resemblyzer.py) | Yes, in the same isolated venv, after two install-friction fixes (below) |

**Baseline features** (hand-written, numpy only, no scipy/librosa/torch, matching Q1 option A
and ADR 0008's "no PyTorch" constraint): per 40 ms frame at 10 ms hop, an autocorrelation pitch
tracker (60-400 Hz search range), a voiced/unvoiced gate from a per-clip RMS percentile, speaking
rate as voiced-run count per second (no aligned words available at this stage, so this is the
coarse fallback the PRD anticipates, not TR-3's aligned-word rate), RMS energy mean/std, and a
coarse spectral summary (FFT-based centroid plus low/mid/high band-energy fractions).

**Praat features**: `to_pitch()` median/10th/90th-percentile F0, `to_formant_burg()` F1-F3
means, `to_intensity()` mean - the same clips, no re-recording.

**Resemblyzer features**: `VoiceEncoder().embed_utterance()`, the 256-value embedding, per clip.

### PyTorch and Windows-build verification

The PRD's Evidence section flagged two unverified assumptions. Both are now checked against
live upstream metadata (`https://pypi.org/pypi/<pkg>/json`), not assumed:

- **Resemblyzer requires PyTorch.** Confirmed: `resemblyzer` 0.1.4's `requires_dist` lists
  `torch>=1.0.1`, `scipy>=1.2.1`, `librosa>=0.9.1`, `webrtcvad>=2.0.10` directly. Installing it
  in the isolated trial venv pulled `torch==2.14.0+cu130` (a 554.6 MB `manylinux` wheel on this
  Linux sandbox; PyPI also lists a 124.1 MB `win_amd64` wheel for the same CPython 3.12 this
  repository pins) plus `scipy`, `scikit-learn`, `numba`, `soundfile` and others - about 5.8 GB
  installed. This would be the repository's first PyTorch dependency, exactly the cost ADR 0008
  already flags as material.
- **Windows build risk is real and specific, not generic.** `librosa` itself ships a universal
  `py3-none-any` wheel (pure Python, no Windows build needed) - the earlier "Windows build
  requirements... unverified" note in the PRD's Evidence section was too broad. The actual risk
  is narrower and sharper: **`webrtcvad` 2.0.10** (a hard Resemblyzer dependency, used for its
  voice-activity trimming) **publishes no Windows wheel on PyPI at all, only an sdist**, meaning
  a Windows install compiles a C extension at install time and needs a working MSVC toolchain on
  the narrator's machine. That is a first-use blocker this app's "download a pinned binary,
  narrator clicks Download" provisioning model (`first-use-dependency-provisioning.md`) cannot
  satisfy without vendoring a prebuilt Windows wheel of its own.
- **Two install-friction findings**, for the record even though they didn't block the trial:
  `webrtcvad` imports the deprecated `pkg_resources` API at module load time and fails outright
  against current `setuptools` (which dropped `pkg_resources` by default) - the trial venv
  needed `pip install "setuptools<81"` pinned first, and `pkg_resources` "is slated for removal
  as early as 2025-11-30" per its own deprecation warning. This is an unmaintained-dependency
  signal on top of the missing Windows wheel, not a one-off sandbox quirk.
- **`praat-parselmouth`** has prebuilt wheels for `cp312-win_amd64` (this repository's exact
  Python), installs in seconds with only a `numpy` dependency, and needs no compiler on the
  narrator's machine. Its own GPL-3.0-or-later license is what argues for keeping Praat a
  separate process (per the PRD's Q1 and the dependency plan's candidate 6 note), not a build
  concern.

## Results

Leave-one-chapter-out: for each of the 4 chapters held out in turn, a per-character baseline
(median feature vector, z-scored against the other three chapters' pooled statistics) is built
from the remaining chapters, and every held-out clip's distance to its own character's baseline
("same") and to every other character's baseline ("different") is recorded. 108 same-character
comparisons and 540 different-character comparisons per engine (108 clips × 5 other characters).

| Engine | Same-character distance (median, IQR) | Different-character distance (median, IQR) | Separation ratio (diff / same median) | At the 90th-percentile-of-same threshold: false-reject / false-accept |
| --- | --- | --- | --- | --- |
| Dependency-free baseline | 0.91 (0.55-1.82) | 3.48 (2.56-4.67) | 3.81x | 10.2% / 28.7% |
| Praat (parselmouth) | 0.43 (0.19-0.68) | 2.98 (1.97-4.31) | 6.86x | 10.2% / 0.0% |
| Resemblyzer | 7.03 (5.14-10.38) | 19.88 (17.55-21.16) | 2.83x | 10.2% / 30.6% |

(Distances are Euclidean in each engine's own z-scored feature space, so absolute values are
not comparable across engines; the separation ratio and error rates are.) The 90th-percentile
threshold is deliberately conservative (it accepts a 10% false-reject rate on the reference
distribution itself by construction); a threshold chosen between each engine's same-character
75th percentile and different-character 25th percentile would cut the false-accept rate further
for all three engines, at the cost of a higher false-reject rate - the actual Phase 5 rule needs
this trade-off calibrated per narrator, not hard-coded from this trial.

**Minimum reference amount** (Q6), from the baseline engine's reference-count sweep (rebuilding
each character's baseline from only its first *N* reference clips before comparing):

| Reference clips used | Same-character distance (median) | Different-character distance (median) |
| --- | --- | --- |
| 1 | 1.20 | 2.51 |
| 2 | 1.11 | 2.51 |
| 3 | 1.05 | 2.51 |
| 5 | 0.92 | 2.51 |
| All available (≥5) | 0.91 | 2.51 |

Separation is already usable at 1 reference clip and tightens modestly through 3-5 clips, with
diminishing returns after that. This synthetic corpus's clips average 1-2 seconds; the useful
takeaway for Q6 is the *shape* (a handful of clips captures most of the benefit, so the minimum
should be small enough not to frustrate a narrator with few dialogue lines for a minor
character) rather than the raw clip count, which depends on real recording lengths.

## Decision

Per the evaluation protocol's step 6 (mark `adopt`, `defer`, or `reject`):

- **Q1 feature engine: adopt option A, the dependency-free baseline, for the MVP.** The reject
  gate ("reject if a stable threshold cannot be calibrated") does not fire: same- and
  different-character distances separate by 3.81x with a calibratable threshold and known error
  rates. This confirms the PRD's own stated recommendation (D22) rather than overriding it.
  Provisional pending a real-corpus re-run (see below).
- **Praat (candidate 6, `praat-parselmouth`): defer, but recorded as the strongest fallback.**
  It separates characters more cleanly than the baseline (6.86x vs 3.81x; 0% false-accept at the
  same conservative threshold) and installs cleanly on every platform this repository targets,
  including Windows, with no PyTorch and no compiler step. Its GPL-3.0-or-later license keeps it
  a separate-process integration per the dependency plan, and Phase 8 is conditional on the
  Go/dependency-free baseline actually proving insufficient in practice - which this trial does
  not show, but flags as the credible next step if narrator feedback ever does.
- **Resemblyzer (candidate 5): reject for this workflow**, not merely defer. It is the weakest
  performer here despite the highest cost (2.83x separation, the lowest of the three, at a false-
  accept rate comparable to the baseline's), and this synthetic corpus was built to be maximally
  differentiated - a real narrator's character work is likely to separate *less* well in
  embedding space than it does here, which is exactly the PRD's pre-registered concern that a
  speaker-identity model will often call one narrator's characters similar. Against that, it
  would add the repository's first PyTorch dependency and one hard-blocked dependency
  (`webrtcvad` has no Windows wheel). Nothing in this trial's numbers justifies that trade. This
  is a `reject`, with the evidence above as the record required before ever revisiting it.

## Q6 calibration values for Phase 5

Provisional, pending the real-corpus re-run:

- **Minimum reference amount**: at least 3 approved reference clips per character (or per
  Narration) before any `character_continuity` finding is produced; below that, show
  "insufficient reference" as unavailable evidence rather than a low-confidence flag (matching
  Q6 option A, not B).
- **Outlier rule**: a robust per-character threshold at the reference distribution's own 90th
  percentile of same-character distance (not a fixed absolute number - it must be computed per
  narrator/character from their own approved references, matching the PRD's "stable
  per-narrator threshold" framing). Phase 5 should expose the false-reject/false-accept trade-off
  this trial surfaced (tightening the percentile lowers false accepts, raises false rejects)
  rather than hard-coding the 90th percentile used here for the trial's own reporting.

## Re-running this trial

On the owner's own recordings, or once the sandbox can reach `librivox.org`/`archive.org`:

```bash
cd docs/research/character-continuity-acoustic-trial
python3 synthetic_corpus.py <scratch_dir_outside_the_repo>/corpus   # or substitute a real corpus with the same manifest.json shape
python3 run_trial.py <scratch_dir_outside_the_repo>/corpus
```

`run_trial.py` always runs the dependency-free baseline. For the Praat and Resemblyzer
comparisons, install them first in a throwaway virtualenv *outside the repository* (never added
to `pyproject.toml`/`uv.lock` - they are trial-only, per the dependency plan's provenance gate):

```bash
python3 -m venv <scratch_dir_outside_the_repo>/trial-venv
<scratch_dir_outside_the_repo>/trial-venv/bin/pip install numpy praat-parselmouth
<scratch_dir_outside_the_repo>/trial-venv/bin/pip install "setuptools<81" resemblyzer  # setuptools<81 works around webrtcvad's pkg_resources import; see "PyTorch and Windows-build verification" above
<scratch_dir_outside_the_repo>/trial-venv/bin/python run_trial.py <scratch_dir_outside_the_repo>/corpus
```

To use a real corpus instead of the synthetic one, produce a `manifest.json` with the same
shape `synthetic_corpus.py` writes (`sample_rate`, `route`, `lines: [{chapter, character,
line_index, path, duration_s, is_reference_eligible}]`) alongside the WAV files it references,
and hand-check each line's timestamps against the source text as the PRD's protocol requires -
`is_reference_eligible` should be `false` for any clip the narrator has not explicitly approved.
`run_trial.py` does not care whether the corpus was synthesized or recorded.

Posted to [#510](https://github.com/countrymanprime/narration-utils/issues/510) for the owner
per the worker instructions; see [Sources](character-continuity-acoustic-trial/SOURCES.md) for
full provenance.
