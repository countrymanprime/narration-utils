# 0091. Story Bible pronunciation is a narrator-edited value the preview speaks directly

**Status:** Proposed
**Date:** 2026-09-21
**Supersedes:** (none)

## Context

`docs/prds/story-bible-and-import-ux-briefs.prd.md` Phase 9 (open questions P1-P2) asks what a pronunciation "provider"
means for Story Bible entries, and whether the preview can be made to speak a chosen pronunciation at all before any
implementation work (Phase 10-11, deferred past this stack) starts.

Today, `pronunciation(name, espeak_library)` in `sidecars/manuscript-guide/core/manuscript_guide.py` already computes an
IPA string per entity (`cmu` then `espeak`, and a narrator can choose either through `pronounce()`/`GuidePronounce`,
delivered by stack S19a). The preview path ignores it: `render_audio` speaks the entity's spelled name through Piper,
which runs its own espeak-based text-to-phoneme step every time. A narrator who corrects a pronunciation hears no
difference when they press Preview — the PRD's stated motivation for this phase ("the preview ignores IPA today,
providers later").

Four options were on the table (full detail in
[the pronunciation provider spike](../research/pronunciation-provider-spike.md)): (a) a second local G2P engine; (b) a
narrator-edited project pronunciation dictionary; (c) a hosted IPA API; (d) making the preview speak the pronunciation
that already exists. The owner's decision for this stack picked (b) plus (d) and explicitly excluded (a) and (c) for
now.

## Decision

"Provider" for this PRD means the pronunciation value the narrator already edits through `edit()`/`GuideEdit` (option
b), not a second engine and not a hosted API. The Story Bible preview will be changed (Phase 10, not this stack) to
speak that value directly, using Piper's phoneme-input path (`phonemize()`/`phonemes_to_ids()`/`phoneme_ids_to_audio()`
in `OHF-Voice/piper1-gpl`, confirmed to exist by reading the upstream API in this session) instead of re-running
espeak's own guess over the spelled name every time.

No second local pronunciation engine is added by this PRD. `phonemizer`, eSpeak NG and Piper are already GPL-3.0-or-later
components recorded in [model provenance](../architecture/model-provenance.md) under owner decision D17, and this
project's own AGPL-3.0-or-later licence ([ADR 0039](0039-the-project-is-licensed-agpl-3-or-later.md)) is already
compatible with them; reusing them introduces no new licence question (P2). A licence review is a standing checklist
item for whichever later stack adds a genuinely new engine (the PRD's "Could" row), not a new artifact evaluation this
ADR performs, because there is no new artifact yet.

## Consequences

- Phase 10 (narrator pronunciation storage and preview) has a settled target: change `render_audio` to prefer the
  stored pronunciation's phoneme path when one exists and is compatible, falling back to speaking the spelled name
  otherwise (an entity with no pronunciation, or a pronunciation source whose symbol set does not map cleanly).
- The `espeak`-sourced pronunciation (already IPA from the same espeak-ng library Piper embeds) is the more likely
  compatible path; the `cmu`-sourced pronunciation (ARPABET, a different symbol set) is a compatibility risk this ADR
  does **not** resolve — Phase 10 needs a real trial (synthesize and listen) before deciding whether `cmu` pronunciations
  need a conversion step or are excluded from "the preview speaks what you wrote" until they have one. That trial is
  Phase 10's job, not this spike's.
- No engine addition needs its own licence review yet, because none is added; a future PRD that proposes MFA G2P or
  any other second engine must still re-read `docs/architecture/model-provenance.md` and
  `docs/research/local-dependency-evaluation.md#license-classes` first, unchanged from the standing policy.
- This ADR is Proposed pending the owner's review of the Piper phoneme-input approach and, more importantly, pending
  Phase 10's real trial of whether an edited pronunciation is actually audible and correct through that path — a desk
  check of the API surface is not the same as hearing it work.
