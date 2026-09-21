# 0079. Every downloadable asset is listed, installed, verified and removed through one registry of providers

**Status:** Accepted
**Date:** 2026-09-21

## Context

The voice and Whisper downloads each had their own bindings (`TtsCatalog`, `TtsInstall`, `WhisperRemove` and so on), their own manager, and a manager that `configureLocked` rebuilt on every project attach although a downloaded voice belongs to the machine and not to the project ([host binding concurrency](../architecture/host-binding-concurrency.md), [ADR 0041](0041-host-bindings-read-project-services-through-one-snapshot-accessor.md) left this out of scope). A page that lists every download (the Manage local assets page, the next phase) would have had to know each kind, and each later kind (spaCy models, the Story Bible dictionary, Moonshine) would have added another set of bindings and another copy of the UI.

## Decision

- **One provider per kind of asset** (`apps/desktop/assetregistry.go`, `assetproviders.go`). `assetProvider` says what the registry needs of a kind: its `kind` word, its label and noun in sentences, the `job:ended` kind its install ends with, its items (identity, publisher, licence and provenance links, files, install folder), its state, `install` (which repairs a damaged asset and leaves an installed one alone), `verify` and `remove`. The voice and Whisper managers each get a thin provider; a later kind implements the interface and is registered, and the list, the bindings and the page serve it without another binding.
- **The registry is built once and never replaced.** `Startup` builds it after the first `configureLocked` (`buildAssetRegistry`: the per-user cache folder, then one manager per approved catalog, the checkout's or the packaged one), and `configureLocked` no longer touches an asset manager. `Host.assets` is set once and read with `registry()` (a read lock around one pointer), so nothing that holds a manager can see it swapped; `tts` and `whisper` left `hostServices` and the swappable-field list of `hostguard_test.go`. When the cache folder cannot be named the registry holds no provider and says why (`unavailable`), and every asset binding reports that reason.
- **Six generic bindings** (`bindings_assets.go`): `AssetsList`, `AssetsInstall(kind, id)`, `AssetsInstallState(jobId)`, `AssetsInstallCancel(jobId)`, `AssetsVerify(kind, id)` and `AssetsRemove(kind, id)`. `AssetsList` reads no file contents: state comes from the manifest ([ADR 0078](0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md)) and `installedAt` and `verifiedAt` from the manifest file. Each entry carries `activeJobId` so a page opened while a download runs can follow it. `AssetsInstall` on a damaged asset repairs it; `AssetsRemove` refuses while the asset downloads and touches nothing else (not another asset, a setting or a project). The job is the one of [ADR 0077](0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md), now naming its `kind` and `assetId`.
- **The `Tts*` and `Whisper*` bindings stay as thin wrappers** over the same functions (they answer with `voiceId` or `modelId` besides `assetId`), because the three pages that use them and the settings choices are not migrated by this decision; they are removed in a later change when nothing calls them.
- **The payloads are wire contracts** ([ADR 0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)): `assetCatalogSchema`, `assetInstallJobSchema` and `assetVerifyResultSchema`, golden files written by a Go test (`assets-list.json`, `asset-install-downloading.json`, `assets-verify.json`), and a mock that passes the same schemas. `hostAPIVersion` is 11.

## Consequences

- The Manage local assets page needs one call to list everything and one job type to follow, and adding spaCy is a catalog file, a provider and a page row.
- A project switch cannot rebuild, and so cannot race, an asset manager; the two managers hold a catalog read once at start (a catalog changed on disk is picked up at the next launch, as a release catalog only changes with a release).
- The registry lists the providers in a fixed order (voices, then models); a page that wants another order sorts.
- To let an asset kind bring its own bindings, or to build the registry per project again, write a new ADR that supersedes this one.
