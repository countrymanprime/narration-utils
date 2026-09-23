# 0136. An asset may keep only a file built at install from its verified archive

**Status:** Proposed
**Date:** 2026-09-23
**Supersedes:** (none; extends ADR-0080, which unpacks an archive at install, and ADR-0078, whose manifest the built file joins)

## Context

[ADR 0097](0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md) chose the Open English
WordNet as the manuscript reader's offline dictionary, read from Go with no server. Its JSON release (`english-wordnet-2025-json.zip`,
9,986,555 bytes) unpacks to 73 files and 72,404,635 bytes: one entries file per initial letter and one synset file per lexicographer
file. A lookup needs a word's senses from the first and their definitions from the second, and resolves an antonym from a sense id to
a word, so reading the release as it is means parsing all of it (about 300 MB of memory and one to two seconds) at the first lookup of
every session, and keeping 72 MB on disk. The PRD's success signal is a p95 under 250 ms.

The asset lifecycle ([ADR 0078](0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md),
[ADR 0080](0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md))
downloads into a staging folder, checks size and SHA-256, unpacks an archive, records every unpacked file's hash in the manifest and
renames the folder into place; `State`, `Ready` and `Verify` read what the manifest recorded. It had no way to keep anything but the
catalog's files or what an archive unpacked to.

Three shapes were weighed: keep the raw release and build an in-memory index at the first lookup of each session (slow first lookup,
large resident memory, 72 MB on disk); build an index beside the release in a place of its own outside the lifecycle (a second
provenance and repair story for the same asset); or let the install itself build the index from the verified bytes and keep only it.

## Decision

`assets.Options` gains a `Derive` step. It runs in the staging folder after an archive has been checked and unpacked, and before
anything is recorded: it may build what the install keeps from what was unpacked and remove the rest, and it returns the files kept,
each of which must lie under that archive's own folder. The manifest records those files, with hashes taken when they were built, in
place of the unpacked ones, so `State`, `Ready`, `Verify`, `Repair` and `Remove` treat them exactly as unpacked files. A step that
fails, or returns nothing or a path outside the folder, fails the install with `ErrBadContent`, and nothing is kept for a resume (the
same bytes would fail again). The install never becomes visible until the step has succeeded, as before.

The dictionary is the one user. Its manager always sets the step (a dictionary is never installed as the raw dataset): it builds one
file, `wordnet/index.bin`, from the release and deletes the release. The index is a fixed header, a sorted key table, a synset table
and a blob of JSON records; a lookup opens it, binary-searches the keys with a few bounded reads, reads the records it needs and
closes it. Only single-word lemmas are keys (phrases are out of scope, ADR 0097), plus the irregular forms the release lists; a word
with a regular ending that is not a key is tried against WordNet's own detachment rules. The catalog carries the index's measured
size (`installedSize`) so the first-use dialog states what the dictionary takes on disk, not the download or the dataset.

## Consequences

- On the 2025 release the index is 17,174,403 bytes (a quarter of the dataset), built once in about a second; 130 lookups had a p95
  of about 1.5 ms. Nothing stays open or resident between lookups, so Settings > Local assets can remove or repair the dictionary at
  any time (Windows refuses to delete an open file).
- A change to the index format or the builder changes the bytes an existing install holds: the next Verify still passes (the manifest
  hashes are the ones the old builder wrote), so a format change must bump the catalog entry's `version`, which installs it afresh
  in a new folder. The bytes of the index are deterministic for one release and one builder (a test builds twice and compares).
- `installedSize` is measured, not computed: a new edition or a builder change must re-measure it, and the gated
  `TestThePinnedArchiveInstallsToTheCatalogsMeasuredSize` (run with `NARRATION_OEWN_ZIP`) fails when it drifts.
- The dataset is parsed inside the desktop process rather than a sidecar. It is parsed by `encoding/json` only after its hash
  matched, and every later read of the index is bounded against the file, so a damaged or hostile index is an error, not a crash or a
  large allocation (threat model row 1e).
- Any later asset that is cheaper to use in another shape (a pronunciation table, a compiled grammar) can use the same step without a
  new lifecycle.
