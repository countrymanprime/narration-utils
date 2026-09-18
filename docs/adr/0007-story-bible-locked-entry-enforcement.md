# 0007. Story Bible locked-entry enforcement is server-side authoritative

**Status:** Accepted
**Date:** 2026-09-17

## Context

Locking a Story Bible entry only hid the Delete button and disabled "Merge into current entry" in the UI (`GuideDetail.tsx`) — every other field (name, category, description, personality, context, aliases, relationships) remained fully editable and saveable, and the Python backend's `edit()` (`tools/manuscript-guide/core/manuscript_guide.py`) never checked the `locked` flag at all. A locked entry was locked in appearance only.

## Decision

`edit()` is the single point of truth: it rejects any field mutation except the `locked` field itself (to allow unlocking) when `entity.get("locked")` is true, raising a `ValueError`. `GuideDetail.tsx`'s UI-level `disabled` attributes (on every editable control, gated by `editingDisabled = locked || isNewDraft`) are a **convenience**, not the enforcement — they exist so the user gets an immediate, obvious signal, but the backend guard is what actually prevents a bypass (e.g. a stale UI, a replayed request, or a future consumer of `guideEdit` that doesn't render this form at all).

## Consequences

- Any new UI surface that can call `guideEdit`/`GuideEdit` (Go binding) inherits the protection automatically — the guard lives in the one Python function every edit path funnels through.
- A future feature that needs to bypass the lock for a specific, narrow reason (e.g. an internal rebuild reconciliation step) must do so explicitly and document why, not by routing around `edit()`.
