# 0078. Asset state comes from the manifest, an asset is read in full once per session, and a failed download resumes

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

`assets.State` hashed every byte of every file on each call. The Whisper catalog lists five models (75 MB to 3.09 GB, 5.3 GB together), `Catalog()` called it for each, `Dir()` called it before every use, and each `asset_required` reply called it again: a full read of an installed `large-v3` on every catalog fetch and every transcription start. The manifest an install wrote held only provider, id and version, so it could not stand in for the hash, and it could not give diagnostics the exact provenance the first-use brief asks for. A download that failed at 2.9 GB of 3.09 restarted from zero, replacing a corrupt install removed the target before renaming the new one into place (a crash between the two left neither), the disk was never asked, and the cache root fell back to the temporary folder when `os.UserCacheDir()` failed, where a cleanup tool can delete a multi-gigabyte download.

Owner decisions (Q3 a, Q4, Q5 a of the release-readiness PRD): show the cache path and never delete an installed asset; resume with a `.part` file and HTTP Range if the hosts honour ranges (checked: Hugging Face answers `206 Partial Content` with a `Content-Range` for the pinned Piper and Whisper URLs); trust a manifest on listing and startup, hash in full on an explicit Verify and before the first load of a session.

## Decision drivers

- `assets.State` hashed every byte of every file on each call: a full read of an installed `large-v3` on every catalog fetch and every transcription start.
- The manifest held only provider, id and version, so it could not stand in for the hash or give diagnostics the exact provenance the first-use brief asks for.
- A download that failed at 2.9 GB of 3.09 restarted from zero, a crash while replacing a corrupt install could leave neither copy, and the disk was never asked.
- The cache root fell back to the temporary folder, where a cleanup tool can delete a multi-gigabyte download.
- The owner's decisions (Q3 a, Q4, Q5 a): show the cache path and never delete an installed asset; resume with a `.part` file and HTTP Range; trust a manifest on listing and startup, and hash in full on an explicit Verify and before the first load of a session.

## Considered options

1. Trust the manifest on listing and startup, read an asset in full once per session and on Verify, and resume a failed download
2. Keep the status quo: hash every byte of every file on each call, and restart a failed download from zero

## Decision outcome

**Chosen option: trust the manifest on listing and startup, read an asset in full once per session and on Verify, and resume a failed download**, because hashing on each call meant a full read of an installed `large-v3` on every catalog fetch and every transcription start, and the owner chose to trust a manifest on listing and hash in full on Verify and before the first load of a session.

- **The manifest holds the asset's record** (`apps/desktop/internal/assets/manifest.go`): provider, id, exact version, every file with its size, SHA-256, source URL and modification time, `installedAt`, `verifiedAt` and a `damaged` flag.
- **`State` reads no file contents.** An asset is `installed` when the manifest names exactly the catalog's files with the catalog's sizes and hashes and every file still has its recorded size and modification time. An asset whose manifest predates this (identity only), whose file changed, or whose catalog entry changed is hashed, as before. A `damaged` manifest is `verification_failed` without hashing.
- **`Verify` always reads every byte** and records the result: a success refreshes the manifest (which upgrades an old install), a failure sets `damaged`. **`Ready`** (called by the managers' `Paths` and `Dir`) does it once per asset per process and is `State` afterwards; the record is package-level so it survives the managers being rebuilt when a project is attached.
- **`Repair`** verifies, does nothing for a good asset, and otherwise installs with `Force`. **Replacing an install is a rename aside and a rename into place**, with the old copy put back if the second step fails. The aside copy's name carries the time it was renamed (a rename does not change a folder's own modification time), and `CleanStale` puts it back when the install it belonged to is missing (a crash between the two renames) and removes it only once it is an hour old.
- **One reader at a time per asset.** A Verify, the swap that replaces an install and the manifest records they leave take one lock per install folder, so a Verify of the old copy cannot mark a freshly installed one damaged, and callers that ask for the first use of an asset together (`Ready`) wait for one read of it. A listing that had to hash an old manifest's asset writes down what it found, so the next one is free.
- **Resume.** A failed install keeps `<file>.part` in the staging folder and the next attempt sends `Range: bytes=<size>-`. A `206` whose `Content-Range` starts at the offset is appended; a plain `200` starts the file over; a `416` or a mismatched range discards the part and starts over once; a part that already holds every byte is checked and used as it is. A resumed file that fails its hash is fetched again from the top once (the part may be a stale prefix of an older file), and only a file that is wrong from the top is reported as wrong. A cancel, a checksum or size mismatch, and an oversized body remove the staging folder, so bytes that failed their hash are never resumed. `Options.NoResume` keeps the app's own update on its old rule (nothing left behind on failure, [ADR 0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)). Staging folders older than a week, and the aside copy of a repair older than an hour, are removed at start (`CleanStale`).
- **The disk is asked first.** `RequireFreeSpace` is the managers' default `Preflight`: the bytes still to be downloaded (what a resumed staging folder holds is not counted) plus 64 MB must fit, and the refusal is an `InsufficientSpaceError` that names both sizes. A disk that cannot be measured does not block an install. The free-space call moved from `internal/update` to `internal/assets`; `update.FreeBytes` delegates.
- **No temporary-folder fallback.** When `os.UserCacheDir()` fails no manager is built, the host log records `asset_cache_unavailable`, and the first-use gates report the catalog unavailable.

### Consequences

- **Neutral:** Listing the five Whisper models with all of them installed takes 0.6 ms where reading them took 3.2 s (`go test ./internal/assets -run '^$' -bench State`, Windows 11, Ryzen 9 9955HX, files created at the real sizes). The first transcription of a session still reads the model once, in exchange for finding damage before the model loads it.
- **Bad:** The cheap check trusts the manifest, the file size and the modification time: a file changed in place to the same size with its time put back is not noticed until the next `Verify` or the next session's first use. That is what the owner chose (Q5 a) and it is stated in the tests.
- **Neutral:** A network failure no longer costs the bytes already fetched. A staging folder can sit on the disk for up to a week after a failed download; it is not an installed asset and is removed at start after that.
- **Good:** Every later asset kind (spaCy, dictionaries, Moonshine) gets the manifest, resume, repair and the disk check by using `assets.InstallWith`; nothing in this decision is specific to voices or models.
- **Neutral:** To trust less (hash on every listing) or more (skip the once-per-session read) write a new ADR that supersedes this one.

### Confirmation

The benchmark `go test ./internal/assets -run '^$' -bench State` measures the listing, and the cheap check's limit (a file changed in place to the same size with its time put back) is stated in the tests.

## Pros and cons of the options

### Keep the status quo: hash on each call

- Bad, because it read an installed `large-v3` in full on every catalog fetch and every transcription start (listing the five installed Whisper models took 3.2 s).
- Bad, because a download that failed at 2.9 GB of 3.09 restarted from zero.
