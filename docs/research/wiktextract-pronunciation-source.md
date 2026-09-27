# Wiktextract offline pronunciation source: dataset and licence verification

**Date:** 2026-09-27. **Stream:** N-B29, [prep-depth](../prds/prep-depth.prd.md) Phase 8. **Answers:** Q8 (does Wiktextract ship as a filtered pronunciation-only extract or the raw dump) at the level of an exact catalog row, and the licence check [ADR 0405](../adr/0405-pronunciation-stays-local-first-behind-cmu-wiktextract-and-espeak-with-merriam-webster-as-the-one-narrator-keyed-online-source.md) already scoped.

**Verdict: go, with the exact pin still pending.** Register a new `wiktextract` `PronunciationSource` between `cmu` and `espeak` (Q7), backed by a derived, install-time-built `word -> {ipa, audio}` index (Q8) kept as a small JSON file, never the raw multi-gigabyte Wiktextract dump. The catalog row and its Go asset-manager wiring in this PR are written to the same shape as the Open English WordNet dictionary ([`config/dictionary-assets.json`](../../config/dictionary-assets.json), [ADR 0097](../adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md)) and the FFmpeg encoder build ([`ffmpeg-encoder-build.md`](ffmpeg-encoder-build.md)), but **the exact release file name, size and SHA-256 are not filled in**, for the reason below, and the catalog row is left in a state the asset manager refuses to install rather than guessing.

## What this session could and could not reach

Repeating the check [ADR 0405](../adr/0405-pronunciation-stays-local-first-behind-cmu-wiktextract-and-espeak-with-merriam-webster-as-the-one-narrator-keyed-online-source.md) already recorded (`EGRESS_BLOCKED`, checked again today, same result):

| Host | Reached | Result |
| --- | --- | --- |
| `kaikki.org` | No | `CONNECT tunnel failed, response 403` |
| `en.wiktionary.org` | No | `CONNECT tunnel failed, response 403` |
| `dictionaryapi.com` | No | `CONNECT tunnel failed, response 403` (Phase 9's host; checked here since it shares this PRD's egress posture) |
| `dumps.wikimedia.org` (the raw wikitext dump, not a Wiktextract extract) | No | `CONNECT tunnel failed, response 403` |
| `huggingface.co`, `archive.org`, `kaggle.com` (candidate third-party mirrors of a Wiktextract release) | No | `CONNECT tunnel failed, response 403` |
| `pypi.org`, `files.pythonhosted.org`, `github.com`, `api.github.com`, `raw.githubusercontent.com` | Yes | `200`/`404`/`400` (reachable; 404/400 are the bare host's own response, not a proxy refusal) |

The FFmpeg encoder build note found an alternate, pinnable, reachable mirror for its asset (the same GPL build republished on PyPI) and used that. No equivalent exists here: the Wiktextract project publishes its structured JSON extracts only from kaikki.org, generated from Wiktionary's own dump; nothing on PyPI, GitHub or another host this session can reach republishes a pre-built release archive of it. `tatuylonen/wiktextract` on GitHub (reachable) is the *extractor's source code*, not a hosted data release, and running that extractor over a multi-gigabyte Wiktionary XML dump from `dumps.wikimedia.org` (also blocked) is out of scope for a catalog Phase 0 note.

## What is true per Wiktextract's and Wiktionary's own public documentation (not re-read live in this session)

This restates, without adding anything unverifiable, what [ADR 0405](../adr/0405-pronunciation-stays-local-first-behind-cmu-wiktextract-and-espeak-with-merriam-webster-as-the-one-narrator-keyed-online-source.md) already recorded from public documentation:

- kaikki.org's Wiktextract project (Tatu Ylönen) republishes Wiktionary's content as structured per-language JSON Lines files, one JSON object per headword/sense, updated on a rolling basis as Wiktionary is re-dumped. The English extract is published at a URL under `kaikki.org/dictionary/English/`.
- Each Wiktextract entry for a word that has one carries a `"sounds"` list, where an IPA transcription appears as `{"ipa": "...", ...}` and a Wikimedia Commons audio recording (when Wiktionary has one) appears as `{"audio": "<Commons file name>", ...}` in the same list (used later by Phase 10, not this phase).
- Wiktionary's own text (and therefore Wiktextract's extraction of it) is dual-licensed CC BY-SA 4.0 (for edits since the licence migration) and GFDL; Wiktextract's own distribution terms republish under the same share-alike terms, crediting Wiktionary and its contributors. This is the licence class [`local-dependency-evaluation.md`](local-dependency-evaluation.md#license-classes) previously deferred and ADR 0405 now accepts, scoped to displayed IPA only.
- The English extract's raw JSONL is on the order of several gigabytes; a derived pronunciation-only index (word, IPA, optional Commons audio filename) is on the order of the WordNet index's own installed size (tens of MB), which is why Q8's recommendation (A) — derive at catalog-build time, ship only the derived file — is what this PR's Go asset-manager code builds against, exactly as `internal/dictionary`'s own Derive step already does for WordNet ([ADR 0136](../adr/0136-an-asset-may-keep-only-a-file-built-at-install-from-its-verified-archive.md)).

**None of the above is re-verified against the live site in this session.** No exact release file name, byte size or SHA-256 is stated here, because none of those is published anywhere prose documentation would state it from memory or otherwise reach this session without downloading the file itself — and unlike the FFmpeg build, no reachable mirror publishes that hash either. Writing a plausible-looking URL or hash into the catalog without having actually fetched and checked it would be worse than leaving the row incomplete: a wrong pinned hash fails installs silently confusing, or (worse) is trusted by a later session as already verified.

## What this PR does instead

- **`config/wiktextract-assets.json`** carries the real, stable metadata this session can state accurately without a download: the row's `id`, `provider`, `displayName`, `description`, `license`, `licenseUrl`, `provenanceUrl` and CC BY-SA `attribution` string. Its one file's `url` and `sha256` are the literal sentinel `PENDING-PHASE-0-VERIFICATION`, and `internal/wiktextract`'s catalog loader refuses to construct a `Manager` over a row carrying that sentinel (`ErrPendingVerification`), with a message naming this note and #510. Nothing can silently attempt a download against a guessed URL or a guessed hash.
- **The rest of the pipeline is fully built and tested** against a hand-built tiny fixture in the exact shape of a real Wiktextract JSONL entry (a handful of words, each a `{"word", "sounds": [{"ipa", "tags"}], "audio"}` line), the same "test against a tiny fixture" instruction this project's asset catalog work already follows when a source is unreachable. The Derive step, the compact `word -> {ipa, audio}` JSON index it builds, `WiktextractSource.pronounce()`'s reading of that index, the `cmu -> wiktextract -> espeak` registration order (Q7), and the eSpeak relabel (Q9) are all exercised this way, in both Go and Python.
- **Filed on #510**: a future session that can reach `kaikki.org` (or is handed a downloaded copy some other way) fills in the real file name, size and SHA-256 in `config/wiktextract-assets.json` — a catalog-row edit, not a code change — and removes the sentinel guard's early return once a real hash is present. Nothing else in this PR's code needs to change for that follow-up.

## Derived index shape

```json
{
  "catalogFormat": 1,
  "words": {
    "<lower-cased word>": { "ipa": "<IPA string>", "audio": "<Commons file name, or \"\">" }
  }
}
```

Built once at install time from the unpacked JSONL release (one entry per input line with a non-empty `sounds[].ipa`), then the unpacked release is removed, mirroring `internal/dictionary`'s own `deriveIndex` exactly (unpack under the staging root, build the derived file, delete the unpacked tree, keep only the derived file).
