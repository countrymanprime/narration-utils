# spaCy model provisioning spike

**Date:** 2026-09-21. **Stack:** S16, release-readiness phase 4. **Answers:** Open Question 2 of the [release-readiness PRD](../prds/release-readiness-provisioning-and-docs-site.prd.md): how is a downloaded spaCy model loaded in the frozen Story Bible sidecar?

**Verdict: go.** Catalog the pinned official wheel, unpack it into the per-user asset cache, and pass the model directory to `spacy.load`. The frozen sidecar imports spaCy and loads a model from a directory with the same output as the development environment. No bundling, no runtime `pip install`.

## What was run

Windows 11, Ryzen 9 9955HX, Python 3.12.10, spaCy 3.8.16 (`uv.lock`), PyInstaller 6.22.3. The reference manuscript is `tests/fixtures/alice.md` (3 chapters, 807 paragraphs, 26,420 words), turned into the canonical manuscript JSON. Every download went to a temporary folder outside the repository and nothing was committed.

1. Downloaded the two official wheels from `github.com/explosion/spacy-models` releases, checked the size against the GitHub release metadata, and hashed them.
2. Read `meta.json`, `LICENSE` and `LICENSES_SOURCES` from each wheel.
3. Unpacked each wheel (a wheel is a zip) and ran `manuscript_guide.py build --spacy-model <directory>` in the development venv for three cases: rules-only (a model name that does not exist, which is today's supported fallback), `en_core_web_sm` from its directory and `en_core_web_lg` from its directory.
4. Froze the sidecar with the release script (`python scripts/release/prepare-resources.py --sidecar manuscript-guide`, 30 s, 217 MB folder) and ran the frozen executable on the same manuscript with both model directories.
5. Sent a `Range` request to the release asset URL.

## Results

| | Rules-only | `en_core_web_sm` | `en_core_web_lg` |
| --- | --- | --- | --- |
| Loaded by | (fallback) | `spacy.load(<unpacked directory>)` | `spacy.load(<unpacked directory>)` |
| Dev venv build time | 1.2 s | 5.6 s | 6.5 s |
| Entries | 48 (25 Character, 23 Needs Review) | 110 (45 Character, 39 Organization, 26 Place) | 84 (44 Character, 25 Organization, 15 Place) |
| **Frozen sidecar** | not run | **110 entries, model used, 7.3 s** | **84 entries, model used, 6.3 s** |

- **The frozen sidecar can import spaCy and load a model from a directory.** The freeze needed no change for this: `import spacy` sits inside `spacy_candidates`, and PyInstaller's analysis finds it. The frozen and development outputs are identical (110 and 84 entries), and no "spaCy model unavailable" warning is logged. A model is found by directory path only: neither wheel is installed as a package in the venv, so the by-name `spacy.load("en_core_web_sm")` is the "unavailable" case today, which is why builds are rules-only unless a developer installed one by hand.
- **The model changes the result a lot, and the difference is not obviously better.** The model finds people the rules miss and classifies places and organizations, but it also tags common words ("Adventures", "Beautiful", "Ahem", "FUL") and splits one thing across categories. `en_core_web_lg` is more conservative than `sm` (84 entries against 110) and its published entity scores are a little higher (F 0.855 against 0.843 on OntoNotes). Whether either beats rules-only for a narrator is a judgement on the narrator's own book ([ADR 0020](../adr/0020-entity-extraction-precision-over-recall.md) favours precision); the counts alone cannot say it, and the first build after a download should stay reviewable, as every Story Bible entry already is. The default stays `en_core_web_sm` (the smaller download).
- **Range works.** GitHub answers `206 Partial Content` with a `Content-Range` for the release asset, so the resume of [ADR 0078](../adr/0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md) applies unchanged.

## The two artifacts

Both are `py3-none-any` wheels, compatible with `spacy >=3.8.0,<3.9.0` (their `meta.json`), and the lock has 3.8.16. GitHub publishes no digest for release assets, so the SHA-256 below is the hash of the first download and is the pin (the same trust model as the Piper URLs: a commit or tag, an exact size, a recorded hash).

| | `en_core_web_sm` 3.8.0 | `en_core_web_lg` 3.8.0 |
| --- | --- | --- |
| URL | `https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl` | `https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.8.0/en_core_web_lg-3.8.0-py3-none-any.whl` |
| Download size | 12,806,118 bytes | 400,658,291 bytes |
| SHA-256 | `1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85` | `293e9547a655b25499198ab15a525b05b9407a75f10255e405e8c3854329ab63` |
| Unpacked | 15,251,718 bytes, 35 files | 445,159,665 bytes, 35 files |
| Model directory in the wheel | `en_core_web_sm/en_core_web_sm-3.8.0/` | `en_core_web_lg/en_core_web_lg-3.8.0/` |
| Pipeline | tok2vec, tagger, parser, senter, ner, attribute_ruler, lemmatizer | the same, with word vectors |

**Licence.** The pipelines are MIT, Copyright 2021 ExplosionAI GmbH (`meta.json` and the wheel's `LICENSE`). Their training data is recorded in `LICENSES_SOURCES`: OntoNotes 5 ("commercial (licensed by Explosion)"), ClearNLP's dependency conversion (a citation, no code packaged), WordNet 3.0 (the WordNet 3.0 License, which requires its notice to travel with the data) and, for `lg`, Explosion Vectors (OSCAR 2109, Wikipedia, OpenSubtitles, WMT News Crawl). MIT is compatible with the project's AGPL-3.0-or-later ([ADR 0039](../adr/0039-the-project-is-licensed-agpl-3-or-later.md)); the notices are satisfied by keeping the wheel's `LICENSE` and `LICENSES_SOURCES` in the unpacked install, and the catalog carries the attribution. A model is downloaded by the narrator, never shipped in the release, so the release itself carries no model licence obligation.

## What Phase 5 does with this

- **Catalog** `config/spacy-assets.json`, one entry per model with the fields above, `spacyVersion` (`>=3.8.0,<3.9.0`), the unpacked size for the disk check and the model card (`https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0`) and provenance links. A test asserts that the locked spaCy satisfies every entry's `spacyVersion`, so a spaCy bump cannot leave a model that will not load.
- **Unpack at install, keep no wheel.** The asset manager downloads and verifies the wheel against its pinned hash, extracts it into the install folder, deletes the wheel, and records every extracted file (size, SHA-256 and modification time; the wheel's own `RECORD` lists them) in the manifest. Listing then trusts the manifest and Verify re-hashes the extracted files, as for every other asset ([ADR 0078](../adr/0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md)), and the cache holds 445 MB and not 845 MB for `lg`. The extraction refuses absolute paths, `..`, links and anything larger than the catalog says, as the in-app update's unpacking does for its zip.
- **The host passes the directory.** `guide.Service.Build` passes the unpacked model directory to `--spacy-model` when the model is installed, and the model name otherwise (the rules-only path), so the sidecar needs no change: `spacy.load` already accepts either.
- **No runtime install.** Nothing runs `pip`; the wheel is read as a zip.

## Not verified

- **Whether the model beats rules-only for a narrator.** This needs the narrator's own manuscript; the reference book is public-domain prose with a few hundred names.
- **`en_core_web_md` and non-English models.** The settings offer `sm` and `lg` only, so those are the two catalogued.
- **A release build on another platform.** The freeze was run on Windows; the Linux and macOS previews freeze the same script, and the directory load does not depend on the platform.

## Incidental findings

The frozen Story Bible sidecar logged two things during the runs, unrelated to spaCy and both fixed with the packaged smoke test (phase 8): "CMU pronunciation unavailable (No package metadata was found for cmudict)" (the freeze has no `cmudict` data or metadata) and "eSpeak phonetic fallback unavailable" (the Piper data of the TTS PRD's phase 3).

## To reproduce

Download both wheels to a scratch folder, unpack them with any zip tool, then from the repository root: `.venv/Scripts/python.exe sidecars/manuscript-guide/core/manuscript_guide.py build --manuscript <canonical manuscript.json> --out <guide.json> --spacy-model <folder>/en_core_web_sm/en_core_web_sm-3.8.0`. For the frozen run, freeze with `python scripts/release/prepare-resources.py --sidecar manuscript-guide` and call `.release-build/manuscript-guide/dist/manuscript-guide/manuscript-guide.exe build ...` with the same arguments.
