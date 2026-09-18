# Pronunciation provider choice (default + per-entry override)

**Status: Planned — not implemented.**

## Problem

The app does not yet have a real, swappable pronunciation-lookup integration. **Piper** is the local TTS/voice engine used for audio preview and playback (`shell/internal/tts`, `shared/python/.piper/voices`) — it is not a pronunciation-lookup provider, and today's `GuidePronunciation.source` field (`shared/ui/src/api/contracts/storyBible.ts`) is populated by whatever heuristic `manuscript_guide.py`'s `pronunciation()` function currently does (see that function for the mechanism — IPA generation, not provider lookup). There is no existing multi-provider abstraction to compare against; this doc scopes what one would look like built from scratch.

## Problem this solves

A single pronunciation source is sometimes wrong for a specific name (fictional names, unusual spellings). The user wants the ability to choose a provider — as an app-wide default, and/or per pronunciation when the default result looks wrong.

## Proposal sketch

1. **Provider abstraction**: define a small interface the pronunciation step can call through (e.g. a Python-side `PronunciationProvider` protocol: `def pronounce(name: str) -> Pronunciation`), with the current heuristic becoming the first/default implementation.
2. **Default setting**: a global setting (`Settings.tsx`, Story Bible or a new "Pronunciation" category) picks the default provider.
3. **Per-entry override**: `GuideEntity`/`GuideAlias`'s `pronunciation` object already carries a `source` field — extend the entry/alias edit flow (`GuideDetail.tsx`) with a "try another provider" action next to the pronunciation preview button, calling `guideEdit` (or a new dedicated binding) with an explicit provider choice for that one name, persisting the override so a later rebuild doesn't clobber it (the existing `merge_locked()` "user-authored material is never replaced" pattern is the right precedent to follow).
4. **What "provider" concretely means here** needs research before implementation: candidates include a second local phonemizer/espeak backend (already vendored — `phonemizer`/`espeak_library` appear in `manuscript_guide.py`'s function signatures), a hosted dictionary/IPA API, or a curated pronunciation dictionary the user can edit directly. This doc does not pick one — that decision needs a short spike comparing accuracy/latency/licensing before committing.

## Out of scope for this doc

Choosing the actual second provider — that's a research task, not a design decision yet.
