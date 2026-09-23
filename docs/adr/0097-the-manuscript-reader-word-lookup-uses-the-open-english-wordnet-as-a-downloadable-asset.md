# 0097. The manuscript reader's word lookup uses the Open English WordNet as a downloadable asset

**Status:** Proposed
**Date:** 2026-09-21
**Supersedes:** (none)

## Context

`docs/prds/story-bible-and-import-ux-briefs.prd.md` Phase 6 (open questions D1-D2) asks for a local, offline
dictionary/thesaurus lookup reachable from the manuscript reader's selection menu: single-word definitions, synonyms and
antonyms, US English. Two decisions were open:

- **D1**: cloud API, local dataset, or a local-default-with-opt-in-cloud hybrid. The project's standing boundary is
  local-first processing (`docs/roadmap.md`, `docs/research/local-dependency-evaluation.md`), and the owner's decision for
  this stack is explicit: local only, no cloud API, no key management or privacy exception to design around.
- **D2**: which dataset. Two real candidates carry the exact data shape needed (definitions, synsets for synonyms, an
  explicit antonym relation): Princeton WordNet and its actively-maintained successor, the Open English WordNet (OEWN).

This PRD's own architecture notes ask for the asset to be provisioned through the same asset-install pattern as every other
downloadable dependency (`apps/desktop/internal/assets`, the S16 asset-install hook, `useAssetInstall`), registered in
release-readiness Phase 3's aggregated catalog rather than a parallel one, and gated by this project's licence policy
(`docs/research/local-dependency-evaluation.md#license-classes`) before any code downloads it.

This stack (S19d) delivers only the decision and the dependency record (Phase 6, docs-only). The Go reader, binding and
lookup UI (Phases 7-8) are explicitly out of scope and deferred to a later stack.

## Decision

The manuscript reader's word lookup, when built, reads from a local copy of the **Open English WordNet (OEWN), 2025
Edition**, licensed **CC BY 4.0**, provisioned as a downloadable asset (immutable URL, SHA-256, size to be pinned in
`config/`-style catalog JSON at Phase 7) through the existing asset-install lifecycle. No cloud lookup API is used or
designed for. Princeton WordNet was compared and rejected for this feature: same permissive licence class, but its data has
not had a major release since 2011, while OEWN republishes annually from the same lexical model. See
`docs/research/local-dependency-evaluation.md`, candidate 11, for the full comparison and the required dependency record
fields not yet pinned (exact download URL, SHA-256, measured size — these are filled in when Phase 7 writes the catalog
entry, not by this decision).

CC BY 4.0 is the **Attribution** class in this project's licence policy: allowed for a commercial workflow, with the
required attribution displayed in the lookup UI and recorded in the generated `THIRD-PARTY-NOTICES.txt`. It has no
reciprocal terms that interact with this project's own AGPL-3.0-or-later licensing ([ADR
0039](0039-the-project-is-licensed-agpl-3-or-later.md)): it is a data licence, not a software copyleft licence.

## Consequences

- Phase 7 (Go reader, `SystemLookup`-style binding) and Phase 8 (reader UI) have a settled dataset and licence to build
  against without a separate provenance debate; they still need to pin the exact release artifact's URL, SHA-256 and
  measured size before any catalog entry ships, and to write the required-attribution text into the lookup overlay.
- If OEWN's JSON release format proves awkward for a Go in-process index (Phase 7's design concern), the WNDB format is
  the documented fallback within the same licence and dataset choice — that substitution does not need a new ADR, only a
  note in Phase 7's PR.
- A future decision to add phrase lookups, non-US-English data, or a cloud fallback needs its own ADR (or an update
  superseding this one), not a silent scope creep of Phase 7/8.
- This ADR is Proposed because the exact pinned artifact (URL/SHA-256/size) has not been fetched and verified against a
  live download yet — that verification, and the owner's review of the licence conclusion above, is the open item before
  Accepted.
