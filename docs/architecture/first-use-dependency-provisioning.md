# First-Use Dependency Provisioning

**Status: Partially implemented — Piper preview voices and Whisper transcription models.**

## Problem

`pnpm run bootstrap` is a developer-checkout bootstrapper. It creates the local
environment and installs locked Python/UI/build dependencies, but it downloads
neither spaCy models nor Piper voices. That is unsuitable for a GitHub
release consumer: a compiled application must launch without a source checkout,
Node, Go, a Python bootstrap installer, or a developer bootstrap command.

The application should also avoid consuming network bandwidth and disk space
for an analyzer or voice that the narrator never elects to use.

## Intended experience

The GitHub release contains all executable code and runtime libraries required
to start the application and its local backend. On its first application launch,
the app creates only its settings and asset-cache directories, validates its
bundled runtime, and shows which optional assets are installed. It does not
download a model merely because the application opened.

When a narrator first invokes a capability that needs an optional asset, the
app checks the selected compatible asset:

1. If it is installed and valid, the capability runs immediately.
2. If it is absent, the app identifies the required model/voice, its publisher,
   version, download size, local disk requirement, license/provenance link, and
   destination. The narrator must choose **Download** before any transfer
   starts.
3. The app downloads, verifies, and installs the asset locally, then resumes
   the requested operation. **Cancel** leaves the asset uninstalled and leaves
   the rest of the app usable.

Selecting a model in Settings must not itself download it. A user can choose a
compatible model first and download it only when they use that feature (or
explicitly choose a future **Manage local assets** download action).

For example, opening the app or working only with Transcript Compare must not
install spaCy. Building a Story Bible with `en_core_web_sm` should offer that
model for download if it is absent. The same flow must permit every approved,
compatible spaCy model—not just models already present on the machine—and must
apply to Piper voices, Whisper models, and later optional tools/model packs.

## Product and implementation rules

- Treat optional model weights, voices, dictionaries, and external tool packs
  as assets, not as ordinary application-startup dependencies. The base release
  remains responsible only for code needed to start the app and display this
  flow.
- Maintain a versioned asset catalog in the release. Each supported asset needs
  a stable identifier, capability compatibility, exact version, immutable URL,
  SHA-256 (or stronger) hash, expected size, publisher, license/notice, model
  card/provenance link when applicable, and install layout. Do not use moving
  `latest` aliases or unrestricted `pip install`/tool downloads at runtime.
- The Settings and capability UI must obtain their choices from the compatible
  catalog and expose install state separately (`installed`, `not installed`,
  `downloading`, `verification failed`, or `update available`). Do not hide a
  compatible choice solely because it has not been downloaded yet.
- Put downloaded assets in a per-user application-data cache outside the
  installed release and outside a project folder. The final Windows location,
  retention policy, and any shared cache must be specified by the release
  implementation; asset paths must never be stored as checkout-relative paths.
- Download to a temporary file, verify its hash and expected content before
  atomically making it available, and remove incomplete temporary files on
  cancellation or failure. A corrupt or partial asset must never be selected.
- Show progress, allow cancellation when the upstream format permits it, and
  give an actionable offline/error state. The app may retry only after an
  explicit user action; it must not silently fall back to a different model.
- Preserve the exact installed version and provenance in the cache manifest so
  diagnostics can report it and a user can repair or remove it. Removal must
  not remove user settings, project sidecars, or the base application.
- Updates are opt-in. An available upstream version may be displayed only when
  it has been added to a reviewed release catalog; it may not replace an
  installed model automatically.

This work must follow the artifact-level license and provenance requirements in
the [local dependency evaluation and license plan](../research/local-dependency-evaluation.md).
Those records need updating because that document currently describes setup-time
downloads for a source checkout, not release-time first-use provisioning.

## Migration from the current bootstrap flow

The release build must package the compiled shell, UI assets, local backend,
and its base runtime into the GitHub release artifact. It must not call
`pnpm run bootstrap` or require developer build tooling after installation.

The developer bootstrap must not preload optional assets. Development should
exercise the same catalog and first-use installer as the released application;
an explicit developer-only provisioning command may seed assets for offline
testing or packaging verification.

Existing caches created by retired Windows bootstrap scripts should be detected only by an explicit,
documented migration/repair path. Do not silently adopt files whose version or
hash cannot be verified against the asset catalog.

## Delivery slices

1. Define the release packaging boundary and the versioned asset-catalog/cache
   manifest format; package a launchable application without developer bootstrap.
2. Add an asset manager owned by the application backend, including hash
   verification, temporary downloads, atomic install, cancellation, repair,
   removal, and diagnostics.
3. Add install-state APIs and UI for Settings and the first-use gate. Convert
   spaCy choices from the current installed-only filter to catalog-backed
   compatible choices.
4. Piper preview voices and Whisper transcription models now use the shared
   catalog/cache manager (`shell/internal/assets`, backing both
   `shell/internal/tts` and `shell/internal/whisper`). Move the spaCy Story
   Bible path and every subsequently approved optional asset through the same
   manager.
5. Change bootstrap and release documentation, migrate or deliberately reject
   legacy caches, and add release-install smoke coverage.

## Acceptance criteria

- A clean machine can install a GitHub release and open the app without a
  repository checkout, Node, Go, an external Python installer, or
  `pnpm run bootstrap`.
- First application launch performs no optional asset download.
- A narrator who never builds a Story Bible does not download spaCy; a narrator
  who never requests a Piper preview does not download a Piper voice.
- Every catalog-approved compatible spaCy model is selectable before it is
  installed and can be downloaded only after explicit confirmation.
- Invoking a feature with a missing selected asset clearly identifies it,
  supports download/cancel, verifies the completed asset, and then completes
  the originally requested operation without changing the selected model.
- Offline, cancelled, interrupted, hash-mismatched, and disk-full downloads
  leave no usable partial asset and provide a retry/repair path without
  blocking unrelated tools.
- Reopening the app recognizes a verified installed asset without downloading
  it again. Removing an asset makes only dependent capabilities unavailable.
- Automated tests cover catalog compatibility, first-use gating, no-download
  startup, verification failure, cancellation/resume behavior, and a packaged
  release smoke test.

## Out of scope

This does not authorize new models or change the product's local-first,
narrator-review boundaries. It does not require bundling optional model weights
in the GitHub release, cloud processing, background downloads, or automatic
model updates.
