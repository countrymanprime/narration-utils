# Local Dependency Evaluation and License Plan

**Status: Three artifact kinds are shipped as first-use assets; every candidate below is still
a planned evaluation.** The artifacts recorded under [Shipped assets](#shipped-assets) (the
Piper preview voice, the five Whisper models and the two spaCy language models) are approved and
downloaded by the app on first use. Nothing else in this document is an implemented dependency
or an authorization to download it. It defines how Narration Utils decides whether a local tool
or model materially improves a narrator's workflow and may be offered as an optional dependency.

## Purpose and boundary

Narration Utils is a local-first review tool. An analyzer may find and explain
an issue, write a finding, or create an optional DAW navigation target. It may
not silently edit source audio, rewrite a manuscript, choose a take, diagnose
an acting performance, or identify a fictional character from voice alone.

Third-party executables, packages, and model weights are not committed to this
repository. The release bundles the code and runtime libraries the app needs to start
(the frozen Python sidecars carry their Python packages); model weights, voices,
dictionaries and external tool packs are **assets**, and an asset is provisioned at first use,
never at setup. `pnpm run bootstrap` preloads nothing. When a narrator first uses a feature that
needs an asset, the app names it, shows its publisher, version, size, source, license and where
it will be kept, and downloads the approved, version-pinned artifact directly from its upstream
publisher into the per-user asset cache only after the narrator chooses **Download**
([first-use dependency provisioning](../architecture/first-use-dependency-provisioning.md)).
The product makes the upstream name, publisher, version, source URL, license, model-card URL
(when applicable), and local install location visible to the user.

Downloading at first use avoids redistributing an upstream model in the release. It does **not**
remove the need to honor its license, preserve required notices, or check the license of model
weights separately from the license of the Python package that loads them.

This is engineering guidance, not legal advice. The release checklist must
recheck all upstream terms at the exact version being offered.

## Current baseline

| Capability | Current implementation | Consequence for evaluation |
| --- | --- | --- |
| DOCX parsing | `python-docx` is already in both tool environments. `libs/python/narration_common/docx_chapters.py` is the shared paragraph walker. | Do not add a second document parser. Test only improvements to structure heuristics. |
| Story Bible extraction | Local spaCy plus conservative name/context rules. | BookNLP and GLiNER must improve a reviewed entity, quote, or continuity task over this baseline. |
| Transcript comparison | Local `faster-whisper`, word timestamps, hotwords, normalizations, and a word diff. | Alignment tests must improve marker placement or reduce false discrepancy review, not merely produce another transcript. |
| Voice activity detection | `sidecars/transcript-compare/core/compare.py` calls faster-whisper with `vad_filter=True`. Faster-whisper's VAD path uses Silero VAD to omit non-speech before ASR. | Standalone VAD is justified only if exposing its time ranges creates useful review/recording actions. |
| Audio import | PyAV decodes audio inside Transcript Compare. No direct `ffmpeg`/`ffprobe` executable dependency is currently configured. | FFmpeg is an optional post-render inspection/export tool, not a replacement for the DAW. |

### Faster-Whisper model weights — dependency record

The `faster-whisper` package itself is an existing baseline dependency (see
table above); its downloadable CTranslate2 model weights are the first
optional-asset dependency provisioned through the
[first-use dependency provisioning](../architecture/first-use-dependency-provisioning.md)
flow, per the required record below.

- **Models**: `tiny`, `small`, `medium`, `large-v3` (publisher: Systran) and
  `large-v3-turbo` (publisher: deepdml — no official Systran turbo repo
  exists; deepdml's CTranslate2 conversion is the community-standard one).
- **Exact version**: each model is pinned to an upstream Hugging Face commit
  SHA, not a moving `main`/`latest` alias. **Immutable URL and SHA-256**: one
  entry per file, all in
  [`config/whisper-assets.json`](../../config/whisper-assets.json).
- **Code/weight license**: MIT for every listed model repository (see each
  entry's `licenseUrl`); no separate training-data license applies beyond the
  repository's own MIT terms.
- **Model card/provenance**: each catalog entry's `modelCardUrl`/
  `provenanceUrl` points at the exact pinned Hugging Face revision.
- **Runtime dependency**: none beyond the already-approved `faster-whisper`
  Python package; no additional network calls beyond the pinned download URLs.
- **Invocation**: downloaded and hash-verified by the Go host
  (`apps/desktop/internal/whisper`, sharing `apps/desktop/internal/assets` with Piper
  voices), then loaded in-process by `faster-whisper`'s `WhisperModel` with
  `local_files_only=True` (`sidecars/transcript-compare/core/compare.py`).
- **Removal/update policy**: removable from Settings ("Remove local model…");
  no automatic updates — a new pinned commit requires a reviewed catalog
  change.
- **Test result**: covered by `apps/desktop/internal/assets`, `apps/desktop/internal/whisper`,
  and `apps/desktop/bindings_test.go` (install/verify/remove and the
  `TranscriptStart` first-use gate); every catalog URL/hash was verified
  against the live upstream repository before being recorded.
- **Feature enabled**: Transcript Compare's ASR backend.

## Shipped assets

Each row below is the record the [required dependency record](#required-dependency-record) asks
for, taken from the catalogs the release carries (`config/tts-assets.json`,
`config/whisper-assets.json`, `config/spacy-assets.json`) and, for spaCy, from the
[provisioning spike](spacy-model-provisioning-spike.md). Every asset is installed by the one
lifecycle in `apps/desktop/internal/assets` (stage, check size and SHA-256, rename into place,
manifest), under the per-user cache `<user cache>/narration-utils/assets/<kind>/<provider>/<id>/<version>/`
(`%LocalAppData%` on Windows), and is removable from Settings > Local assets. **Update policy for
all of them:** none automatic. Each is pinned in the catalog to a commit or tag, an exact size and
a SHA-256; a newer version needs a reviewed catalog change, a new hash, a license recheck and a
release, and never replaces an installed asset by itself. The app's own update check
([ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md))
reads release metadata only and downloads no asset. The files were checked against the live
upstream when they were pinned; where a host publishes no digest (GitHub release assets), the
SHA-256 is the hash of the first download and is the pin.

### Piper preview voice (Story Bible name preview)

| Field | Record |
| --- | --- |
| Asset | `en_US-ljspeech-high`, kind `tts`, provider `piper` (`config/tts-assets.json`) |
| Publisher, version | rhasspy (Piper Voices), catalog version `1.0.0`, revision `375a0fe641dea077c2a47b4e9a056d6da521eed3` of `rhasspy/piper-voices` |
| URLs | `https://huggingface.co/rhasspy/piper-voices/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx` and the same path with `.onnx.json` |
| SHA-256, size | `.onnx` `5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a`, 114,199,011 bytes; `.onnx.json` `7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14`, 4,970 bytes |
| Licences | Training data (LJ Speech) is public domain; the Piper Voices repository is MIT ([LJ Speech](https://keithito.com/LJ-Speech-Dataset/)). Attribution kept in the catalog: "LJ Speech Dataset (public domain); Piper voice model by rhasspy contributors." |
| Model card, provenance | `.../piper-voices/blob/v1.0.0/en/en_US/ljspeech/high/MODEL_CARD`; `.../tree/v1.0.0/en/en_US/ljspeech/high` |
| Install location | `<cache>/assets/tts/piper/en_US-ljspeech-high/1.0.0/` |
| Runtime | `piper-tts` 1.8.0 and its phonemizer and eSpeak NG data are bundled in the frozen Story Bible sidecar (GPL-family code inside an AGPL-3.0-or-later program, [ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-0-or-later.md)); only the voice is an asset |
| Feature | Story Bible name and alias preview |

### Whisper models (Transcript Compare, Teleprompter)

All five are CTranslate2 conversions loaded in-process by `faster-whisper` with `local_files_only=True`;
the license of every one is MIT (each entry's `licenseUrl`); model card and provenance point at the
pinned revision (`https://huggingface.co/<repo>/tree/<revision>`); install location
`<cache>/assets/whisper/faster-whisper/<id>/<revision>/`. Each file has its own URL, size and
SHA-256 in `config/whisper-assets.json` (URL `https://huggingface.co/<repo>/resolve/<revision>/<file>`).

| Id | Publisher and repository | Pinned revision | Installed size |
| --- | --- | --- | --- |
| `tiny` | Systran, `faster-whisper-tiny` | `d90ca5fe260221311c53c58e660288d3deb8d356` | 78,203,619 bytes |
| `small` | Systran, `faster-whisper-small` | `536b0662742c02347bc0e980a01041f333bce120` | 486,212,372 bytes |
| `medium` | Systran, `faster-whisper-medium` | `08e178d48790749d25932bbc082711ddcfdfbc4f` | 1,530,571,735 bytes |
| `large-v3-turbo` | deepdml, `faster-whisper-large-v3-turbo-ct2` | `4df90f75321148c3a29a9e2351b7ddf8f5b115a8` | 1,621,665,983 bytes |
| `large-v3` | Systran, `faster-whisper-large-v3` | `edaa852ec7e145841d8ffdb056a99866b5f0a478` | 3,090,835,702 bytes |

The weight file of each, whose SHA-256 identifies the model (`model.bin`): `tiny`
`dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1` (75,538,270 bytes); `small`
`3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` (483,546,902); `medium`
`9b45e1009dcc4ab601eff815b61d80e60ce3fd8c74c1a14f4a282258286b51ae` (1,527,906,378); `large-v3-turbo`
`e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da` (1,617,884,929); `large-v3`
`69f74147e3334731bc3a76048724833325d2ec74642fb52620eda87352e3d4f1` (3,087,284,237). The remaining
files of each (`config.json`, tokenizer and vocabulary files) are in the catalog with their hashes.
The default is `small`; the Teleprompter defaults to `tiny`.

### spaCy language models (Story Bible)

Both are `py3-none-any` wheels from the model publisher's release, downloaded, checked against the
pinned hash, **unpacked into the install folder and deleted** (the wheel is not kept), and loaded by
directory path (`spacy.load(<folder>)`), so nothing is ever `pip install`ed at run time.

| Field | `en_core_web_sm` | `en_core_web_lg` |
| --- | --- | --- |
| Publisher, version | Explosion, 3.8.0 (compatible with spaCy `>=3.8.0,<3.9.0`) | Explosion, 3.8.0 (same range) |
| URL | `https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl` | `https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.8.0/en_core_web_lg-3.8.0-py3-none-any.whl` |
| SHA-256 | `1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85` | `293e9547a655b25499198ab15a525b05b9407a75f10255e405e8c3854329ab63` |
| Download, installed size | 12,806,118 bytes; 15,251,718 bytes unpacked | 400,658,291 bytes; 445,159,665 bytes unpacked |
| Licence | MIT, Copyright 2021 ExplosionAI GmbH. Training data notices (OntoNotes 5, ClearNLP conversion, WordNet 3.0 License) travel in the unpacked `LICENSES_SOURCES`; the catalog carries the attribution | The same, plus Explosion Vectors (OSCAR 2109, Wikipedia, OpenSubtitles, WMT News Crawl) |
| Model card, provenance | `https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0` | `https://github.com/explosion/spacy-models/releases/tag/en_core_web_lg-3.8.0` |
| Install location | `<cache>/assets/spacy/spacy/en_core_web_sm/3.8.0/` (model at `model/en_core_web_sm/en_core_web_sm-3.8.0`) | `<cache>/assets/spacy/spacy/en_core_web_lg/3.8.0/` |
| Feature | Story Bible extraction with a language model (the default); without it the build asks first and can run rules-only | The same, more accurate and slower |

### Not assets

The code the release itself carries (the frozen Story Bible, Transcript Compare and Teleprompter
sidecars, `faster-whisper`, `piper-tts`, `spacy`, `cmudict` and their data) is the base release and
not a first-use download; it is pinned by the lock files (`uv.lock`, `go.sum`), and the
[packaged smoke test](../operations/ci-and-releases.md) checks that the frozen Story Bible sidecar can start its
phonemizer and load its dictionary.

## License and provenance policy

### License classes

| Class | Examples in this plan | Commercial audiobook workflow | Repository/integration consequence |
| --- | --- | --- | --- |
| Permissive | MIT, BSD-2/3-Clause, Apache-2.0 | Allowed. | Keep copyright/license notices in the dependency manifest. Apache-2.0 also carries notice and patent terms. |
| Attribution | CC BY 4.0 model packs | Allowed. | Display and retain the exact required attribution and model card. Do not imply Narration Utils owns the model. |
| Weak copyleft | LGPL | Allowed. | Prefer a separately installed executable or dynamically linked library; preserve notices and allow replacement of the LGPL component if distributing a combined application. |
| Strong copyleft | GPL | Allowed for using the tool to make a paid audiobook. The audiobook is not made GPL by that use. | Keep it as a separate executable/process. If Narration Utils ever distributes a combined/modified GPL program, obtain a license review and meet source-offer obligations. |
| Unclear, restricted, or non-commercial | Missing license, `NC`, research-only, gated terms inconsistent with commercial use | Not approved. | Do not download automatically, list as a supported option, or use in shipped tests until the exact artifact is cleared. |

### Required dependency record

Before an optional dependency is added, create a versioned entry in a future
dependency manifest with all of the following:

- tool/model name, publisher, exact version or commit, immutable download URL,
  SHA-256, installed size, and install command;
- code license URL and the separate weight/dictionary/acoustic-model license
  URL, if there are weights or data packs;
- model card/training-data provenance and required attribution text;
- every runtime dependency that is downloaded by first run;
- whether it is invoked as a separate process, Python package, or linked
  library; and
- removal path, update policy, test result, and the Narration Utils feature it
  enables.

An update checker may report that an upstream release exists, but it must not
silently replace a model or executable just because a tag named `latest` moved.
Any automatic update needs a reviewed manifest update, a new hash, a license
recheck, and regression tests. This protects both reproducibility and license
accountability.

## Evaluation protocol

Each candidate follows the same small, reviewable trial before implementation.

1. **Provenance gate.** Record the exact upstream artifact and confirm its
   code, weights, dictionaries, and model-card terms permit this commercial
   workflow.
2. **Held-out corpus.** Use 3--5 already-recorded chapters with narrator
   permission, plus a manually annotated sample appropriate to the task.
   Audio, manuscripts, voice embeddings, and test outputs remain ignored local
   project data.
3. **Blind comparison.** Run the current workflow and the candidate workflow.
   Review without seeing which system produced the cue where practical.
4. **Measure value.** Count useful findings, false positives, missed known
   cases, processing time, setup friction, and minutes of narrator review
   saved. A new analyzer must improve a decision, not simply emit more data.
5. **Human boundary.** Every candidate result has evidence and an
   accept/dismiss/defer outcome. No test may create an active take or alter a
   render.
6. **Decision.** Mark the candidate `adopt`, `defer`, or `reject`, with the
   pinned artifact/version and trial evidence in this document or its follow-up
   implementation brief.

## Candidates requested for evaluation

### 1. python-docx — retain and improve only where needed

**What it contributes.** This is the existing structural reader for Word
manuscripts, not an LLM. It reads paragraphs, styles, and other DOCX structure.
That makes Word Heading styles, outline levels, page breaks, and document order
better evidence for chapter detection than an AI guess.

**Current use.** Already used by Manuscript Guide and Transcript Compare; no
new integration is needed.

**Trial.** Add fixture documents containing valid headings, styled but
non-chapter headings, front matter, chapter numbers/subtitles, and badly styled
documents. Measure whether a transparent score can identify low-confidence
chapter candidates and request narrator selection rather than silently divide
the manuscript incorrectly.

**License/provenance.** python-docx is MIT licensed. Keep the package version
pin and upstream license reference in each environment manifest. No model
weights are involved. [Upstream project and license](https://github.com/python-openxml/python-docx).

**Risk.** A style heuristic can still mistake a section heading for a chapter.
The safe result is `needs chapter review`, never a fabricated chapter boundary.

### 2. BookNLP — fiction-aware character and dialogue preparation

**What it contributes.** BookNLP can identify entities, cluster character
mentions such as "Tom" and "Mr. Sawyer", resolve selected pronouns, find direct
quotes, and attribute a quote to a textual speaker. That can turn a manuscript
into a narrator-facing preparation sheet: *who appears here, who is likely
speaking each quote, what aliases occur, and what nearby evidence supports it*.
It is a complement to spaCy, not a replacement for narrator-approved Story
Bible data.

**How it would help.** Before recording, surface a chapter's characters and
dialogue in order. During proofing, use text-side speaker attribution to link a
line to its approved character reference. This is the reliable direction of
inference: manuscript -> likely character. It must not claim that an audio clip
belongs to a fictional character without an approved text anchor.

**Trial.** Manually label 50--100 quotes across several genres: quote span,
expected character when known, and ambiguous/unknown cases. Compare current
spaCy/rules against BookNLP for useful quote/speaker cards, erroneous speaker
claims, and narrator corrections. Adopt only if it reduces manual preparation
time and preserves uncertainty.

**License/provenance.** BookNLP's repository is MIT licensed. Before enabling
its downloadable language-model artifacts, record the exact artifact URLs,
hashes, model/license notices, and training-data information; the repository
license alone is not sufficient evidence for a separately downloaded weight.
[Capabilities](https://github.com/booknlp/booknlp) · [MIT license](https://github.com/booknlp/booknlp/blob/main/LICENSE)

**Risk.** Book-length coreference and speaker attribution are uncertain research
problems. Misattributing dialogue can cause worse character preparation than no
suggestion. Preserve quote evidence, give an `unknown` outcome, and require a
narrator correction path.

### 3. GLiNER v2.1 — flexible candidate extraction

**What it contributes.** GLiNER is a compact, label-directed entity extractor.
Unlike a fixed spaCy NER model, it can be asked for a chosen set of labels, for
example `character`, `location`, `organization`, `invented term`, `title`, or
`pronunciation candidate`.

**How it would help.** It is useful when Manuscript Guide misses a fictional
term that a generic NER model does not recognize. Its output can become a
review queue with excerpts and a one-click addition to the Story Bible or
Whisper hotword list.

**Trial.** Build a manually reviewed list of 100 entities from varied
manuscripts. Compare spaCy/rules with GLiNER v2.1 on recall, false candidates,
and the number of accepted items per minute of review. Test each label set
separately; broad prompts such as `important thing` are not actionable.

**License/provenance.** Only choose the v2.1 artifacts explicitly listed by
upstream as Apache-2.0. Older GLiNER Base and Small artifacts are CC BY-NC and
are out of scope. Pin the exact v2.1 artifact rather than a moving alias.
[Upstream license distinction](https://github.com/urchade/GLiNER/blob/main/docs/intro.md)

**Risk.** User-defined labels make the model flexible but can produce plausible
false positives. It may never add a canonical character, pronunciation, or
hotword automatically.

### 4. Montreal Forced Aligner (MFA) — known-text word and phoneme timing

**What it contributes.** MFA means **Montreal Forced Aligner**. Given audio,
the expected written text, a pronunciation dictionary, and an acoustic model,
it forces that known text onto the audio and emits word/phoneme timing (for
example TextGrid, JSON, or CSV). It can report out-of-vocabulary words and use
G2P/dictionary support for pronunciation coverage.

**How it would help.** Transcript Compare already knows the intended manuscript.
MFA can place a suspected misread, skipped word, or pickup closer to the actual
word/phone than ASR timestamps alone. It is also useful for pronunciation
review: a custom project dictionary can represent the narrator-approved form of
an invented name.

**What it is not.** MFA does not transcribe unknown speech, decide whether a
performance is correct, identify a speaker/character, or detect emotion. If
the narrator did not say the expected word, alignment can degrade around that
point; that degradation is evidence for review, not proof of a misread.

**Trial.** Create a gold set of 100 manually verified word boundaries and 25
known discrepancy/pickup locations. Compare current faster-whisper word times
with MFA timing for median boundary error, marker usefulness, out-of-vocabulary
handling, and setup time. Use a project-owned pronunciation dictionary and
retain the output only in the project sidecar.

**License/provenance.** The MFA program is MIT licensed. Its acoustic,
dictionary, and G2P packs are distinct downloaded artifacts. MFA's current
model format includes a per-model `LICENSE` and model card; its documented
default for newly generated packs is CC BY 4.0, but that is not a blanket
license for every existing pack. The selected `english_mfa` release must be
pinned and its own license/training provenance recorded before download.
[MFA license](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner/blob/main/LICENSE) · [MFA model-version and license documentation](https://montreal-forced-aligner.readthedocs.io/en/stable/user_guide/models/model_versions.html)

**Risk.** This adds a sizeable, multi-artifact install and a dictionary/model
compatibility surface. It should be an optional backend, not a replacement for
the existing fast transcript comparison until the trial proves better marker
placement.

### 5. Resemblyzer — approved-reference voice continuity, not character ID

**What it contributes.** Resemblyzer produces a 256-value speaker embedding
and a similarity score between clips. It is designed to compare vocal identity
or timbre, not to understand dialogue, fictional roles, or acting intention.

**Could it identify characters from previous markers?** Not reliably. In an
audiobook every character is deliberately performed by the same physical
narrator, so a speaker-identity model will often say that all character clips
are similar. An accent, pitch, or placement change may move the embedding, but
that does not make a general character classifier. The safe design is:

1. BookNLP/text and narrator review identify the likely character for a quote.
2. The narrator explicitly approves one or more clean reference clips for that
   character voice.
3. Resemblyzer compares a new, text-anchored clip to that character's approved
   reference distribution and flags only an unusual distance for listening.

This can help find *possible voice-continuity drift* on a known character. It
cannot establish who is speaking, select a take, or judge whether an intentional
change is wrong.

**Trial.** For one narrator and book, collect approved references for 3--5
clearly differentiated characters plus narration. Use leave-one-chapter-out
clips to measure whether same-character comparisons cluster more tightly than
different-character comparisons. Report overlap and false alerts; reject if a
stable threshold cannot be calibrated for that narrator/book.

**License/provenance.** The Resemblyzer repository is Apache-2.0 and includes
a pretrained encoder. Still record the exact package/model hash and its stated
provenance before the app downloads it on first use. [Upstream project](https://github.com/resemble-ai/resemblyzer)

**Risk.** Voice embeddings are biometric-like personal data. Keep them local,
project-scoped, removable, and created only from narrator-approved clips. They
are unsuitable for identifying people, deanonymizing audio, or supporting
voice-cloning functionality.

### 6. Praat — objective speech measurement and inspection

**What it contributes.** Praat is an established speech-analysis application
and scripting environment. It can inspect/export pitch, intensity, formants,
spectrograms, duration, jitter, shimmer, and related voice measures.

**How it would help.** It supplies the evidence behind a neutral continuity
finding: for example, a pickup is much faster, louder, or in a different pitch
range than approved neighboring reads. It also helps visually inspect breaths,
mouth noises, clipped consonants, and suspicious waveform regions. It is not
an emotion detector or an automated acting judge.

**Trial.** Select 20 known good takes and 20 deliberately mismatched or
technically flawed examples. Define stable, narrator-meaningful measurements
(such as words/minute, pause duration, median F0, F0 range, and intensity) and
test whether they surface useful review cues beyond direct listening. Keep only
measures that survive microphone/room/chapter variation.

**License/provenance.** Praat is GPL-3.0-or-later. It may be used to make a
commercial audiobook. To keep the Narration Utils integration boundary clean,
prefer a separately installed executable invoked by documented scripts rather
than bundling it or linking its code into the desktop host. [Praat license and capabilities](https://praat.org/manual/License.html)

**Risk.** Acoustic metrics are sensitive to microphone, processing chain, and
recording conditions. They need per-project baselines and must be presented as
measurements, never as a claim about a narrator's health or emotional state.

### 7. Silero VAD — speech-region map

**What it contributes.** VAD means **voice activity detection**. It estimates,
in short audio windows, whether human speech is present. Silero VAD can return
speech start/end regions after applying configurable speech probability,
minimum speech duration, minimum silence duration, maximum segment duration,
and padding.

**How it would help beyond its current transcription use.** The current
`vad_filter=True` removes long non-speech sections before faster-whisper
transcribes. A standalone/exposed VAD pass could also create a visible region
map for:

- skipping long dead air during review;
- finding likely restarts, pickups, and false starts from clusters of short
  speech regions and pauses;
- preventing empty/noise-only sections from becoming transcription work;
- measuring pause duration and speaking-time ratio by chapter; and
- limiting later analyzers to speech-bearing windows.

**What VAD cannot do.** It does not recognize words, identify speakers or
fictional characters, distinguish a breath from every other non-speech sound,
judge a take, transcribe, or reliably classify the cause of silence. It returns
region candidates, not editorial decisions.

**Trial.** Reuse the same Silero implementation already brought in by
faster-whisper where possible rather than downloading a duplicate model. On
annotated chapters, compare generated regions with manually useful review
boundaries and measure missed speech, clipped word starts/ends, nuisance
markers, and time saved navigating silence. Adopt only if the regions are
exported as reviewable findings/labels and improve workflow beyond the current
hidden ASR filter.

**License/provenance.** Silero VAD publishes its code and model under MIT.
The existing faster-whisper dependency already uses Silero VAD for
`vad_filter`; if it is exposed independently, record the exact bundled or
separately downloaded ONNX asset and its hash. [Silero VAD](https://github.com/snakers4/silero-vad) · [faster-whisper VAD behavior](https://github.com/SYSTRAN/faster-whisper/blob/master/README.md)

**Risk.** Bad thresholds can cut quiet words, retain room noise, or turn normal
dramatic pauses into nuisance findings. Defaults must be conservative and
configurable per project.

### 8. Vale — narrator-specific manuscript linting

**What it contributes.** Vale is a local, markup-aware prose linter. It is not
a generative model. Its versioned YAML rules can check facts that matter to
narration: character spelling, preferred forms, abbreviations requiring an
expansion, unapproved punctuation conventions, numbers that need a delivery
note, and project-specific terminology.

**How it would help.** Extract manuscript text to a temporary local text view,
run a project rule set, then show suggestions with source excerpts. It is an
especially good fit for recurring author/narrator conventions that are too
specific for a generic grammar checker.

**Trial.** Write 10--20 rules from issues actually seen in finished projects.
Annotate true/false results across several chapters, then retain only rules
with high review value. Initial rules should be suggestions, not errors, and
never rewrite the DOCX.

**License/provenance.** Vale itself is MIT. Individual downloaded style packs
and dictionaries may have their own terms, so the first version should use
Narration Utils-authored, repository-owned YAML rules or separately reviewed
packs. [Vale](https://github.com/vale-cli/vale)

**Risk.** A noisy prose linter trains users to ignore all findings. Keep rules
narrow, transparent, tested, and per-project opt-in.

### 9. WhisperLive — ported streaming-inference logic for Manuscript Teleprompter

**What it contributes.** WhisperLive already solves live-chunking ASR: a
VAD-gated rolling `faster-whisper` decode loop producing real per-word
timestamps, needed for the deferred [Manuscript Teleprompter
brief](../architecture/manuscript-teleprompter.md)'s live position tracking.

**Nature of reuse — this entry differs from every other candidate above.**
It is not a downloaded dependency or a linked package; the plan is to port
its streaming-inference logic (VAD chunking, rolling decode, word timestamps)
into a repository-owned Python sidecar module, not to run its WebSocket
client/server or depend on its package at runtime. See the brief for why the
server component itself is rejected (it would reintroduce the loopback
server this app's DAW-integration boundary explicitly disallows).

**License/provenance.** WhisperLive is MIT licensed
(`Copyright (c) 2023 Vineet Suryan, Collabora Ltd.`) — same permissive class
as this repository, so porting its logic is unrestricted. The only
obligation is preserving attribution: the ported module's header must cite
the source repository and copyright holder, pinned to the exact upstream
commit ported from, since MIT's condition ("the above copyright notice and
this permission notice shall be included in all copies or substantial
portions of the Software") is not satisfied by depending on the package —
it has to travel with the ported code itself.
[WhisperLive](https://github.com/collabora/WhisperLive) ·
[MIT license](https://github.com/collabora/WhisperLive/blob/main/LICENSE)

**Risk.** Porting freezes a snapshot of upstream logic rather than tracking
its improvements. Record the exact commit ported from so a future
re-sync is a deliberate, reviewed action rather than silent drift.

**Implementation status (day-1 prototype).**
[`sidecars/manuscript-teleprompter/core/live_asr.py`](../../sidecars/manuscript-teleprompter/core/live_asr.py)
implements the VAD-gated-window / rolling-decode / word-timestamp shape
described above. This is a clean-room re-implementation against this
repository's own already-pinned `faster-whisper`/`onnxruntime` stack (reusing
faster-whisper's bundled Silero VAD via `faster_whisper.vad`, not a new
dependency) rather than a line-for-line copy of WhisperLive's own client/
server source — so there is no single upstream commit whose literal code was
copied to pin here. The attribution requirement above is for the ported
*design* (the chunking/decode/timestamp technique), which the module's own
header states, not for copied source lines. Still unresolved from this
entry's original risk list, pending the manual mic-latency measurement this
prototype exists to produce: which `faster-whisper` model size is viable at
real-time latency on a CPU-only machine.

**Second source: whisper_streaming's LocalAgreement policy.** First mic
testing showed that decoding only after a pause delivers a whole utterance at
once, which cannot drive a live highlight. The module therefore also adopts
the LocalAgreement-2 technique from
[whisper_streaming](https://github.com/ufal/whisper_streaming) ("Turning
Whisper into Real-Time Transcription System"): re-decode the growing segment
every 0.5s and emit only the words two consecutive decodes agree on, giving an
append-only stream. Same reuse class as WhisperLive above: MIT
(`Copyright (c) 2023 ÚFAL`, verified against the repository's LICENSE),
technique re-implemented from scratch rather than copied, attribution carried
in the module header, no new runtime dependency. Trade-off recorded: each
decode re-reads the whole open segment, so CPU cost grows with model size and
segment length (capped by `MAX_BUFFER_SECONDS`).

### 10. Moonshine Voice — streaming ASR candidate for the live teleprompter path

**Status: candidate under evaluation. Not a project dependency.** It is
imported only by the optional `--engine moonshine` path of
[`live_asr.py`](../../sidecars/manuscript-teleprompter/core/live_asr.py) and run in
an ephemeral `uv` environment; `pyproject.toml` and `uv.lock` are untouched.
It cannot ship until the record below is completed.

**What it contributes.** Streaming speech recognition that caches encoder state
instead of re-decoding, partial and final line events, word timestamps in
streaming mode, and `set_context()` / `set_keyterms()` biasing toward script
text. See the [Manuscript Teleprompter brief](../architecture/manuscript-teleprompter.md)
for why two live engines are supported and how they are compared.

**Record so far.**

- **Package**: `moonshine-voice` 0.1.5 on PyPI, MIT
  ([repository](https://github.com/moonshine-ai/moonshine)); pure-Python wheel
  with bundled native libraries (Windows x64 wheel 16.5 MB; Linux x86-64/arm64
  and macOS arm64 wheels exist; **no macOS Intel wheel**). Runtime dependencies:
  `numpy`, `sounddevice`, `requests`, `tqdm`, `filelock`, `platformdirs`,
  `google-crc32c`.
- **Model license**: the project states its English streaming models are MIT
  (the non-commercial Moonshine Community License covers only legacy
  non-streaming models for other languages). GitHub's license detector reports
  the repository as unrecognized, so the exact per-model license text must be
  confirmed at the pinned artifact before adoption.
- **Model artifacts** (English streaming; sizes observed downloading, about 10
  files each): Small about 215 MB including the 78 MB attention decoder that
  word timestamps require; Tiny about 74 MB. The library fetches them from
  Moonshine's own servers.
- **Missing before adoption**: immutable URL and SHA-256 for every file, model
  card/provenance, and loading from a pre-placed directory through the
  hashed, versioned asset catalog (the product must not let the library
  download models itself); PyInstaller packaging of the native libraries on
  each supported platform; removal and update policy.
- **Observed behavior** (small samples, Windows CPU): about 0.26x real time
  for Small and 0.17x for Tiny; partial updates every 0.5s; word timestamps
  noisy in partials; final line identical to the last partial in 27 of 27 lines.

## Clarifications for adjacent tools

### FFmpeg and ffprobe versus the DAW

The DAW remains the place to record, edit, comp, audition, process, and make
creative decisions. FFmpeg is a non-interactive media engine; `ffprobe` is its
inspection companion. They are useful after a render or outside the DAW because
they can consistently batch-check the actual files intended for delivery:

- format, sample rate, channels, codec, duration, and metadata;
- clipping/peak and loudness measurements;
- missing/empty audio, unexpected channel layout, inconsistent chapter
  renders, and file naming/order; and
- deterministic conversion or concatenation when explicitly requested.

They do not replace DAW meters, destructive/non-destructive editing, or human
listening. Their strongest role here is a reproducible post-render QC report:
"this is what the exported file contains," not "this is how you should mix."

FFmpeg is LGPL-2.1-or-later by default, and enabling some optional components
makes a given build GPL. For an optional external executable, download a pinned
build from an identified publisher, record whether it is LGPL or GPL, invoke it
as a process, and do not silently substitute a build with unknown options.
[FFmpeg licensing](https://ffmpeg.org/legal.html)

### WhisperX versus MFA

Both deal with **alignment**, which means attaching text to precise times in
audio. They take different routes:

| | WhisperX | Montreal Forced Aligner |
| --- | --- | --- |
| Starting point | Audio is transcribed by Whisper, then its output is aligned. | The expected source text is already known and is forced onto the audio. |
| Best use here | Exploring unknown/partially known audio and improving ASR word timestamps. | Controlled audiobook proofing, pronunciation dictionaries, word/phone timing. |
| Output | ASR transcript plus refined word times; optional separate diarization pipeline. | Word/phone times, alignment diagnostics, and out-of-vocabulary evidence. |
| Main weakness | More moving model dependencies; diarization has its own gated/model terms. | Breaks down around changed/skipped text; needs dictionary/acoustic-model compatibility. |

WhisperX itself is BSD-2-Clause, but that does not clear every alignment,
diarization, or Hugging Face asset it can download. Its diarization feature in
particular has separate model access/terms. Start the evaluation with MFA for
known-manuscript alignment; consider WhisperX only as a separately licensed,
pinned word-timestamp experiment. [WhisperX](https://github.com/m-bain/whisperX)

## Important candidates not yet in the first trial

| Candidate | Why it matters | License/provenance position |
| --- | --- | --- |
| libebur128 | A small library for integrated loudness, loudness range, and true-peak measurement. It is a stronger future building block for delivery reports than an opaque AI score. | MIT. Good candidate after the existing finding/report contract is in place. [Upstream](https://github.com/jiixyj/libebur128) |
| RNNoise | Lightweight neural noise suppression suitable for an optional preview or restoration test. | BSD-3-Clause. Never replace a source recording automatically; compare bypass/processed audio. [Upstream](https://github.com/xiph/rnnoise) |
| DeepFilterNet | More capable speech enhancement/restoration experiment than RNNoise. | Dual MIT/Apache-2.0. Test artifacts carefully; restoration may harm consonants and room tone. [Upstream](https://github.com/Rikorose/DeepFilterNet) |
| Pronunciation dictionaries/G2P | This is more important than an emotion model for avoiding repeated rerecords of names and invented terms. The project already uses `pronouncing`, `phonemizer`, eSpeak/Piper paths, and editable pronunciations. | Treat each engine and voice/dictionary pack as a separately licensed dependency. No new voice model should be implied to be commercially cleared by the engine's license. |

Audio-emotion classifiers, voice-cloning systems, and generative music/audio
models are intentionally absent. Many offer research-only or non-commercial
weights, and they provide weak evidence for audiobook performance review. If
reconsidered, they must pass the same artifact-level license and workflow-value
gate above.

## Adoption order

1. Improve current document structure tests and expose the already-present VAD
   region evidence if the trial proves it useful.
2. Trial Vale and GLiNER because they are small, transparent additions to the
   existing manuscript workflow.
3. Trial BookNLP for text-side dialogue/character preparation.
4. Trial MFA against current word timestamps for precision proofing.
5. Trial Praat and Resemblyzer only with the character-continuity workflow and
   explicitly approved reference clips.
6. Add FFmpeg/ffprobe post-render QC and libebur128 only when delivery-report
   requirements are independently specified.
