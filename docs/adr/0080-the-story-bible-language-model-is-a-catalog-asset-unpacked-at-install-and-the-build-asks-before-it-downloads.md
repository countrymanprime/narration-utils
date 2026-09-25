# 0080. The Story Bible language model is a catalog asset unpacked at install, and the build asks before it downloads

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

The Story Bible extracts names with a spaCy language model when one can be loaded and with a rules-only fallback when not (`spacy_candidates` logged a warning and used the rules). No model is in the release, none was ever downloaded by the app, the choices were a list in `app.go`, and `startGuideBuild` had no gate: every narrator got the lower-quality extraction unless a developer had installed a model by hand, and nothing told them. The [phase 4 spike](../research/spacy-model-provisioning-spike.md) verified that the frozen sidecar imports spaCy and loads a model from an unpacked directory with the same output as the development environment, and pinned the two official wheels (`en_core_web_sm` 12.8 MB, `en_core_web_lg` 400.7 MB).

Owner decisions (Q1, Q2 of the release-readiness PRD): decline offers Download, rules-only for this run, or Cancel, with no bundling; the wheel is cataloged, unpacked into the cache, and its directory passed to `spacy.load`.

## Decision drivers

- No model was in the release or ever downloaded by the app, so every narrator got the lower-quality rules-only extraction unless a developer had installed a model by hand, and nothing told them.
- The phase 4 spike verified that the frozen sidecar loads a model from an unpacked directory with the same output as the development environment, and pinned the two official wheels.
- The owner's decisions (Q1, Q2): decline offers Download, rules-only for this run, or Cancel, with no bundling; the wheel is cataloged, unpacked into the cache, and its directory passed to `spacy.load`.

## Considered options

1. A cataloged spaCy model, unpacked at install, with a build that asks before it downloads
2. Bundle a model in the release
3. Keep the status quo: a silent rules-only fallback unless a model was installed by hand

## Decision outcome

**Chosen option: a cataloged spaCy model, unpacked at install, with a build that asks before it downloads**, because every narrator otherwise got the lower-quality rules-only extraction without being told, and the owner chose a cataloged wheel unpacked into the cache, with no bundling.

- **A third kind of asset**, `spacy`, with a catalog (`config/spacy-assets.json`), a manager (`apps/desktop/internal/spacy`) and a provider in the registry ([ADR 0079](0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)). Each catalog entry pins the wheel's URL, size and SHA-256, its exact version, `spacyVersion` (the range it was trained for), the `modelPath` inside the unpacked folder and the unpacked size. A test holds every `spacyVersion` against the locked spaCy in `uv.lock`, so a spaCy upgrade cannot leave a model that does not load.
- **Archives are unpacked at install and not kept** (`assets.File.Extract` and `Expand`, `extract.go`). After the wheel is downloaded and checked against its hash it is unpacked into the install folder and deleted, and the manifest records every unpacked file (path, size, SHA-256 and modification time), so listing trusts the manifest and Verify re-reads the unpacked files ([ADR 0078](0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md)) and a 400 MB wheel costs 445 MB of disk, not 845. The unpack refuses what a hostile or broken archive could do: a path that is absolute, climbs out, names a drive, uses a backslash or an empty or dot segment, is a Windows device name, is a link or a special file, appears twice, more than 10,000 entries, or more data than the catalog says (declared and actually written). The install then fails and nothing is kept. The disk check counts the download and the unpacked size.
- **The build is gated** (`guidegate.go`, `spacyForBuild`). `GuideBuild(rulesOnly)` reads the selected model. Installed: its unpacked folder goes to the sidecar as `--spacy-model`. Approved but not installed: nothing starts and the answer is `asset_required` with the model, its download and disk sizes and where it would be stored. `rulesOnly` builds with the sidecar's explicit `rules-only` choice for that run, and the job ends saying it was rules-only and lower quality. A name the app does not manage (a developer's own install) is passed through as it is. There is no silent fallback: the sidecar keeps its warning for a model that was asked for and could not be loaded, and logs a different line for the choice.
- **The UI asks three ways** (`Guide.tsx`, `AssetInstallPrompt` with an `alternative`, `ConfirmDialog` with a `secondary` action): Download model (the shared install job, then the build with the model), Build with rules-only, Cancel. The first-use question is the same for every asset (`AssetFacts`): what it is, version, publisher, download size, disk needed, where it is saved, licence, model card and provenance. The voice and Whisper prompts gained the same facts (`asset_required` carries `diskSize` and `installPath`).
- **Settings choices come from the catalog.** The `spacy_model` choice is the approved models, installed or not, so a narrator can select one before downloading it and selecting never downloads.
- **Wire changes:** `GuideBuild` takes `rulesOnly` and answers a `started` or `asset_required` union (`guideBuildResultSchema`, golden files), so `hostAPIVersion` is 12.

### Consequences

- **Good:** The first build on a clean install asks once; after a download, or once the narrator has chosen, it never asks again for that model. A narrator who never builds a Story Bible never downloads spaCy.
- **Neutral:** The default stays `en_core_web_sm` (the smaller download). Whether either model beats rules-only for a given book is the narrator's judgement: the counts in the spike differ a lot and are not obviously better, and every entry stays reviewable.
- **Neutral:** A model that was installed by pip for development is not used when the setting names a catalog model: the app asks to download its own. A developer selects their own name in a project settings file to keep the old behaviour.
- **Neutral:** To bundle a model, or to make a model the default silently, write a new ADR that supersedes this one.

### Confirmation

A test holds every `spacyVersion` in `config/spacy-assets.json` against the locked spaCy in `uv.lock`, and the `GuideBuild` answer is a wire contract (`guideBuildResultSchema`, golden files).

## Pros and cons of the options

### A cataloged model, unpacked at install

- Good, because the wheel is deleted after it is unpacked, so a 400 MB wheel costs 445 MB of disk, not 845.

### Keep the status quo: silent rules-only fallback

- Bad, because every narrator got the lower-quality extraction unless a developer had installed a model by hand, and nothing told them.
