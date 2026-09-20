# Proofing Vocabulary Hints

**Source:** user requests of 2026-09-20 (items 13, 14, 15). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. Note: the user described these as Story Bible items, but the Suggest button, the pills box and the hint input all live on the **Proofing** page (`apps/ui/src/components/proofing/Transcript.tsx`); the Story Bible (`GuideDetail.tsx`, `Guide.tsx`) has none of them. The visual catalog files the hint-chips state under `home` "for historical reasons" (`apps/ui/tests/visual/state-catalog.ts:29-32`). Related: [ui-primitives-and-headless-library.prd.md](ui-primitives-and-headless-library.prd.md) (a tag-input primitive and `IconButton`).

## Problem Statement

- **"Suggest from manuscript" does not work** for the user, still, after an earlier fix, and no doc or PRD records it as a defect.
- Vocabulary hints take two rows: a box of pills and, below it, a separate input with "Add" and "Suggest from manuscript" buttons. The user wants one control: the pills box is the input.

## Evidence

- **Suggest trace (fully wired, Go only, no stub).** Button `Transcript.tsx:363-366` calls `suggestHints` (`:140-156`), then `api.transcriptSuggestHints` (`wailsClient.ts:119`, `contracts/transcript.ts:53`) and `Host.TranscriptSuggestHints` (`apps/desktop/bindings.go:475-494`), which calls `guide.VocabularyCandidates` (`apps/desktop/internal/guide/service.go:207-263`). That reads `<project>/ManuscriptGuide/manuscript_guide.json` directly with no Python; it uses the `vocabulary_candidates` array **if the key is present** (`:228`) and derives names from entities only if the key is absent (`:234-256`). The result is filtered against saved hints case-insensitively (`bindings.go:483-491`), joined with ", ", split on "," in the UI and re-filtered case-sensitively (`Transcript.tsx:142-147`); survivors become dashed pending "+ term" pills (`:331-340`). No disabled state or job. The mock works (`mockApi.ts:598-601`, `Transcript.test.tsx:12-31`).
- **Likely reasons it fails for a real project (from reading; not run):**
  1. **Empty list short-circuits the fallback.** `create()` seeds a new guide with `"vocabulary_candidates": []` (`manuscript_guide.py:868-875`); import seeds checked characters through `create` without building (`bindings.go:286-330`), so Go sees the key present but empty and the entity fallback (`service.go:234`) never runs. Only `build()` recomputes the list (`:755`); `create`, `edit`, `merge`, `delete` and `rescan` never do, so names added after the last build are never suggested.
  2. **The precision filter empties the list in rules-only mode.** `is_vocabulary_worthy` excludes every Needs Review entity first (`:600-612`, `:603-604`); in rules-only mode every lone-word name is Needs Review (ADR 0020, `docs/architecture/story-bible-entity-accuracy.md:33`), and spaCy is not provisioned (`release-readiness...prd.md:11`), so most invented single-word names never reach Suggest.
  3. **Weak feedback.** An empty result toasts "No new suggestions — everything found is already accepted." (`Transcript.tsx:148-152`), which is false when nothing was found at all; the toast is a fixed 2.4 s (`layout/Toast.tsx:8-9`) keyed by its text, so a second click gives no new signal (`interaction-feedback-audit.prd.md:33`).
  4. **Minor:** a term containing a comma breaks the join/split round trip; the binding read `h.guide` and `h.transcript` unlocked (fixed by the host binding concurrency work, `docs/architecture/host-binding-concurrency.md`); a missing guide toasts "build the Story Bible before requesting vocabulary suggestions" (`service.go:212`).
  - What would settle it: the project's `manuscript_guide.json` `vocabulary_candidates` value and the exact toast text.
- **No PRD or doc records it.** Grepping `docs/prds`, `docs/architecture`, `docs/adr`, `docs/guides` for suggest, vocab and hint finds only descriptions of the feature as working or filtered by design (ADR 0020:18, `story-bible-entity-accuracy.md:33`, `guides/using-the-app/proofing.md:17-21`); the comment at `service.go:235-237` records an earlier "looks dead" fix (b3c3a07) that covered only a missing key. The interaction audit covers Story Bible action feedback but never mentions Suggest.
- **Current UI** (`Transcript.tsx:314-368`): label and info Tooltip (`:315-318`); box `div.flex.min-h-11.flex-wrap` (`:319-346`); accepted pills as inline spans with a remove button `aria-label="Remove {term}"` (`:320-330`, not the `Pill` primitive); pending pills in a `TooltipTarget "Suggested — click to accept"` (`:331-340`); empty hint text (`:341-345`); the separate row: a `w-48` input, placeholder "Add a term…", Enter handled (`:347-359`), an "Add" ghost Button (`:360-362`) and the text Suggest Button (`:363-366`).
- **State and handlers.** `acceptedHints`, `pendingHints`, `manualHint` (`:63-65`); hints load once on mount and errors are swallowed (`:75-83`); `saveHints` is optimistic and toasts only on error (`:121-128`); `addManualHint` trims, ignores empty input, clears, and skips exact-case duplicates (`:134-139`); `acceptHint`/`removeHint` `:129-133`. Pending suggestions are UI-only and lost on navigation. The duplicate check is case-sensitive but the server dedupes case-insensitively and keeps the first spelling (`apps/desktop/internal/transcript/service.go:155-`, `service_test.go:86-101`), so "alice" beside "Alice" shows two pills until reload. No length or comma guard.
- **Storage and use.** `TranscriptSaveHints` (`bindings.go:501-506`) writes `<project>/TranscriptCompare/vocab_hints.json`, sorted and deduped (`Hints()` `service.go:144-154`); `Start` writes the comma-joined hints to `TranscriptCompare/vocabulary_hints.txt` (`:80-85`); `compare.py:1478-1483` reads it and passes it as faster-whisper `hotwords` (`:506-515`).
- **Primitives.** `Pill` (`primitives/Pill.tsx`) is a toggle button (`label, active, disabled, title, onClick`), not a removable chip; there is no Chip or Tag primitive; `Field` has only `label, value, onChange, onBlur, disabled, textarea` (no `onKeyDown`, `placeholder`, `ref`, `children`), so it cannot host an inline chip input; input classes are duplicated in `ScopedSetting` and `AddNoteDialog` (`component-a11y...prd.md:17`).
- **Test and driver coupling.** `Transcript.test.tsx:23,28` and `app.drivers.ts:114` find the button by `/Suggest from manuscript/`; the drivers click `Add` (`:276`, `:527`) and use `getByPlaceholder('Add a term…')` (`:273`, `:524`); `global/toast` is `sameAs proofing/toast` (`state-catalog.ts:191-196`); `addManualHint` never calls `notify`, so what the toast state actually shows should be verified first. Docs and screenshots: `docs/guides/using-the-app/proofing.md:17-21`, `proofing-hint-chips` (`doc-screenshots.json:94`).
- **Design notes for the chip input.** The input already keeps focus after Enter, so "cursor after the pill" is just placing the input inline after the last pill. Blur-commit interacts with clicks on Remove, the Suggest icon and Start comparison: Start reads `acceptedHints` from its closure (`:160`), so the blur-driven state update must land before the click. `faWandMagicSparkles` is already imported (`:3`).

## Proposed Solution

1. **Make Suggest work and say what it did**, then
2. **consolidate the UI:** the pills box is the input (type, Enter to add, the cursor sits after the new pill, blur turns pending text into a pill), and the Suggest button becomes an icon inside that box.

## Key Hypothesis

We believe reliable suggestions plus a single tag-input box will make vocabulary hints quick to build before a Proofing run. We'll know we're right when Suggest returns names on a freshly imported, unbuilt project and on a rules-only build, the toast tells the truth, and adding a hint is type-and-Enter in one place.

## What We're NOT Building

- A new suggestion algorithm beyond fixing the two empty-list paths (ADR 0020's precision rule stays for the Story Bible; only the Suggest source rules may relax).
- Changing how hints are passed to faster-whisper.
- Persisting pending suggestions across navigation.
- The Story Bible vocabulary UI (none exists).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Suggest after import (no build) | Returns names derived from the entities | Go test on the seeded-empty-list case |
| Suggest in rules-only mode | Returns locked, manual and character entities even when Needs Review, per the chosen rule (V3) | Go test |
| Truthful feedback | "Nothing found" and "already accepted" are different messages, and the second click gives a signal | Vitest |
| Type-and-Enter | Enter adds a pill and keeps focus after it; blur commits pending text; Backspace on empty removes the last | Vitest |
| Blur races | Clicking Remove, the Suggest icon or Start after typing does not lose or duplicate the term | Vitest |
| Duplicates | Case-insensitive, one pill | Vitest |
| Driver names | `Suggest from manuscript` accessible name kept; drivers updated for the removed Add row | Playwright suite |
| Visual | PNGs at four viewports for empty, typing, many pills wrapping, pending suggestions | Playwright suite |

## Open Questions

- [ ] **V1. What is in `vocabulary_candidates` for the user's project, and what did the toast say?** This selects among the causes. Ask before building.
- [ ] **V2. Where to fix the empty list.** Options: (a) Go always derives candidates from entities and the stored list is only additive (recommended); (b) Python recomputes `vocabulary_candidates` in `create`, `edit`, `merge`, `delete` and `rescan`; (c) both.
- [ ] **V3. Needs Review rule for Suggest.** Relax for locked, manual and character entities, or when spaCy is absent? Recommendation: include locked and manual entities and characters; keep the exclusion for auto-extracted Needs Review non-characters.
- [ ] **V4. Icon placement.** Inside the box at the trailing edge (recommended) or inline after the pills? At 390 px the box wraps; the icon must not cover text.
- [ ] **V5. Tag-input keyboard.** Backspace on empty removes the last pill, comma also commits, paste splits on commas and newlines. Recommendation: yes to all three, and a length limit (Q: 64 characters).
- [ ] **V6. Pending suggestions** stay dashed pills inside the same box, or become a "Suggested" row? Recommendation: stay inside the box.
- [ ] **V7. Primitive or local component?** A `TagInput` primitive (with stories and an atlas entry) versus a local component. Recommendation: the primitive, per the primitives PRD, since Pill groups and tag inputs recur.
- [ ] **V8. Load errors** are swallowed (`:75-83`); surface them? Recommendation: yes, a non-blocking message.

## Users & Context

**Primary User**: a narrator running Proofing against a recording, with names the speech model mishears, Windows first.
**Current behavior**: types names into a separate input, presses Add, and presses Suggest, which returns nothing or a misleading message.
**Trigger**: setting up a Proofing run.
**Success state**: hints are accepted by typing or one-click suggestions and the run uses them.
**Job to Be Done**: When I set up Proofing, I want to list the odd names in the book quickly, so the transcript matches them.
**Non-Users**: narrators who skip Proofing.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Suggest returns names on unbuilt and rules-only projects (V2, V3) | 1 |
| Must | Distinct messages for "no names found" versus "all already accepted"; toast identity that re-fires | 1 |
| Should | Case-insensitive duplicate check in the UI; comma guard | 1 |
| Must | Pills box is the input: Enter adds, focus stays after the last pill, blur commits, Backspace removes | 2 |
| Must | Suggest is an icon (`aria-label` "Suggest from manuscript") inside the box; the Add row is removed | 2 |
| Should | Pending suggestions as dashed pills inside the box; load errors surfaced | 2 |
| Could | A `TagInput` primitive shared with other pill inputs | 2 |
| Won't | New algorithms, persistence of pending suggestions | - |

**User flow**: click into the box, type "Juno", press Enter (a pill appears, the cursor is after it); type "Zeph" and click elsewhere (it becomes a pill); click the sparkle icon at the end of the box; dashed suggestion pills appear inside the box; click one to accept.

## Technical Approach

**Feasibility**: HIGH; the source fix is in Go and Python, the UI change is local.

**Architecture notes**
- Source: change `guide.VocabularyCandidates` (`service.go:207-263`) so it merges the stored list with entity-derived names under the V3 rule instead of choosing one; if V2(b) is chosen also recompute in the Python commands. Tests: `service_test.go` (currently the fallback test only), `test_manuscript_guide.py:196-222,439-452,481`.
- UI: replace `manualHint` state and the second row with a controlled tag-input; a pure `commitPending()` used by Enter, blur and Start so the closure-staleness in `Transcript.tsx:160` cannot drop a term; keep `saveHints` optimistic behavior.
- Feedback: two toast messages with distinct text, or the interaction audit's toast queue when it lands; do not change the 2.4 s fixed duration here.
- Drivers: update `app.drivers.ts:112-119,273,276,524,527` and the `global/toast` row; the tooltip on pending pills uses `TooltipTarget` (Tooltip PRD Phase 1 may change its markup).
- Docs: `proofing.md:17-21` and the `proofing-hint-chips` screenshot (`doc-screenshot-sync`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The real cause is neither of the two empty-list paths | Medium | V1 first; the Go and Python tests cover both; add a logging line to the toast for the count found |
| Blur commits fire before a click on Remove/Start | Medium | Commit through one function; test with `userEvent` pointer sequences |
| Drivers and doc screenshots break | High | Update in the same phase (`visual-catalog-sync`) |
| Relaxing the Needs Review rule adds noise | Medium | V3 keeps auto-extracted Needs Review non-characters out; hints are reviewable |
| Collisions on `Transcript.tsx` | Medium | Interaction audit phase 3, briefs Phase 2 and release-readiness edit it; small hunks |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Make Suggest work and honest | Source fix, messages, duplicate check, tests | pending | - | V1 | - |
| 2 | Tag-input box and Suggest icon | Pills box as input, Suggest icon, removed Add row, drivers and docs | pending | - | 1 | - |

**Phase 1.** Goal: Suggest returns useful names and reports truthfully. Success: Go and Vitest tests for the empty-list, rules-only and message cases.
**Phase 2.** Goal: one control. Success: Vitest for Enter, blur, Backspace, races and duplicates; PNGs reviewed at four viewports.

**Parallelism Notes**: sequential; Phase 2 can start after Phase 1's messages settle.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/internal/guide/service.go` and tests, `manuscript_guide.py` (only if V2(b)), `Transcript.tsx` messages | Interaction audit Phase 3 (toasts), briefs PRD Phase 2 (`Transcript.tsx`) |
| 2 | `Transcript.tsx`, optional new primitive and story, `app.drivers.ts`, `state-catalog.ts`, `proofing.md`, `doc-screenshots.json` | Primitives PRD, Tooltip PRD, test-stability PRD (drivers) |

Cross-cutting: `hostAPIVersion` unchanged (no binding change); each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`; `visual-catalog-sync`, `doc-screenshot-sync`, the Playwright suite with PNG review at four viewports.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Precision over recall for Story Bible entities (prior, ADR 0020) | Kept for the Story Bible; Suggest may include locked, manual and character entities (proposed) | Relax everywhere | Suggest is user-reviewed |
| Local-first, no cloud (prior) | Suggestions come from local project data only | - | Standing scope |
| Where Suggest sources names | Go merges stored list and entities (proposed) | Python recompute | One place, no sidecar cost |
| Input model | Tag input (proposed) | Separate input row | Requested |

## Research Summary

**Technical Context**: verified in code on this branch: the full Suggest trace, both empty-list paths, the UI and handlers, hint storage and use, primitives, tests and drivers, and PRD/doc coverage (none).
**Not verified**: the user's actual data or toast text, and whether the mock's `addManualHint` toast is what `global/toast` shows.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
