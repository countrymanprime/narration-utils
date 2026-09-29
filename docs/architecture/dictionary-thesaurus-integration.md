# Dictionary look-up

A "Look up" action on a selected word in the manuscript reader, answered from a local dictionary index the host reads
directly (never a Python server or a cloud API). Delivered by the story-bible-and-import-ux-briefs PRD's D brief
(phases 6-8): a docs-only spike choosing the dataset, then the asset-backed backend, then the reader UI. This page
replaces that PRD (its Open Questions D1-D2 hold the licensing and scope decisions) now that it is deleted.

## The dataset

**Open English WordNet (OEWN), 2025 Edition, CC BY 4.0** ([ADR 0097](../adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md)),
chosen over Princeton WordNet (same permissive license class, stale since 2011) and Wiktionary extracts (share-alike,
not a reviewed license class for this purpose). `config/dictionary-assets.json` pins the release
(`english-wordnet-2025-json.zip`), its SHA-256 (downloaded and verified against GitHub's own digest) and size,
following the same asset-provisioning path as every other optional dataset
([first-use provisioning](first-use-dependency-provisioning.md)): nothing downloads before the narrator's Download
click, and it is registered as the `dictionary` provider in the one asset/provider registry.

## The path

1. The install builds a 17 MB lookup index from the verified release.
2. `apps/desktop/internal/dictionary` reads that index from Go, per lookup — no persistent Python sidecar
   ([codebase map](codebase-map.md)'s standing "no Python server" rule). `Host.SystemLookup`
   (`apps/desktop/dictionarylookup.go`) answers `asset_required` (never downloads on its own) or `ok`; measured p95
   is 1.0-1.5ms on the real release, well under the 250ms budget.
3. "Look up" appears in `SelectionMenu.tsx` for a one-word selection only (the host's own `Normalize` rule). The
   answer opens a `SlideOver` ("Look up: <word>") in `apps/ui/src/components/manuscript/WordLookup.tsx`: every part of
   speech, numbered definitions, examples, synonyms and antonyms, all rendered as plain text (never as markup — the
   dataset is data, not HTML), with the CC BY 4.0 attribution under every answer, found or not.
4. `asset_required` opens the standard first-use question; a damaged index (failed its own check) is asked as "Repair
   the dictionary?" instead, still never downloading before the narrator's click. A successful download answers the
   lookup that asked for it.

## Tests

Go: `apps/desktop/internal/dictionary` package tests (index build, lookup latency, a corrupted index reported as
damaged, not silently empty). Vitest: `WordLookup.test.tsx` (found, not-found, not-installed, damaged, and the
CC BY credit on every branch). Visual: `script/word-lookup-definition`, `-not-found`, `-not-installed`, `-damaged` and
`selection-popup`, reviewed at desktop, small-desktop and tablet (the suite has no phone viewport,
[ADR 0037](../adr/0037-visual-suite-captures-no-phone-viewport.md)); aria snapshots pin the panel and the question's
role tree.
