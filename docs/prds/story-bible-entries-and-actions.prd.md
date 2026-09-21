# Story Bible Entries: Properties, Actions and Pronunciation

**Source:** user requests of 2026-09-20 (items 20, 21, 22, 24). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. Related: [import-structure-toc-and-characters.prd.md](import-structure-toc-and-characters.prd.md) (properties captured at import), [the Story Bible preview](../architecture/story-bible-preview.md) (the preview error, delivered), [story-bible-and-import-ux-briefs.prd.md](story-bible-and-import-ux-briefs.prd.md) phases 9-11 (pronunciation provider), the delivered primitives (`IconButton`, `Menu`, `TextField`, `Select`, `Table`; see [design-system.md](../design/design-system.md)).

## Problem Statement

Four Story Bible frictions:

1. Entries are fixed-shape. Imported cast blocks carry labelled facts ("Codename", "Abilities", "Dossier") that have nowhere to live.
2. "Go to line" is a text button while similar actions elsewhere are icon-only with a tooltip.
3. The header mixes lock, edit and delete in every mode, so delete sits next to save and lock is offered mid-edit (which discards the draft).
4. The pronunciation play button is enabled even when no pronunciation exists, and there is no way to generate, refresh or replace one.

## Evidence

- **Entity schema** (`sidecars/manuscript-guide/core/manuscript_guide.py:579-595`, manual creation `:896-910`): `id`, `canonical_name`, `aliases[]` (`{text, pronunciation, occurrences[]}`), `category`, `occurrences[]`, `occurrence_count`, `pronunciation`, `description {text, evidence}`, `personality_notes[]`, `context`, `relationships[] {id, name, label}`, `locked`, `manual`, `review_state`; top-level `schema_version` 2 (`:32`, written `:751,:869`), `source`, `generated_at`, `entities`, `vocabulary_candidates`, `absorbed_names`. Go has no struct: `map[string]any` with `normalizeEntity` defaults (`apps/desktop/internal/guide/service.go:41-45,71-106`). TS type `apps/ui/src/api/contracts/storyBible.ts:9-25` with `normalizeGuideEntity` (`:27`); `manual` is stored but not in the TS type.
- **Edit choke point (ADR 0007).** `edit()` (`manuscript_guide.py:800-844`) rejects every field except `locked` on a locked entity (`:805`), dispatches by `if/elif`, raises "Unsupported editable field" (`:841`) and sets `review_state = "reviewed"` on every call (`:842`). `GuideEdit` (`apps/desktop/bindings.go:104-114`) runs one process per field in map order; `editArgs` at `service.go:164`; the UI Save sends four fields (`GuideDetail.tsx:304-311`).
- **Rebuild merge** (`merge_locked`, `manuscript_guide.py:646-726`): locked or manual entities are kept wholesale (`:672-679`); otherwise only description, personality_notes and context (when the new value is empty), relationships and prior-only aliases carry over (`:681-693`). A new field is silently lost on rebuild for generated entities unless added there; `pronunciation` is not carried over either (`:681-695`).
- **Header actions** (`GuideDetail.tsx:264-352`): read-only unlocked: count, Lock (`:268-286`), Edit (`:287-297`), Delete (`:330-340`); edit: count, Lock, Save and Cancel (`:298-329`), Delete; locked: count and Unlock only, no Edit, Save or Delete (`:111,:287,:330`) plus the note "Locked entries cannot be deleted..." (`:355-359`); new draft: Discard (`:341-351`). Server-side, delete of a locked entity is rejected (`manuscript_guide.py:1009-1010`). **Existing hazard:** locking while editing reloads the entity and the effect at `:85-99` resets the draft, discarding unsaved edits; `editing` resets only when the entity id changes (`:84`), so Lock then Unlock snaps back into edit mode, contrary to ADR 0018 (unlocking returns to read-only).
- **ADR conflict.** [ADR 0018](../adr/0018-story-bible-entries-read-only-until-edit.md) (`:19`) says lock/unlock and delete stay available regardless of mode; ADR 0036 (`:13`) describes the header actions in that layout. Moving Lock to read-only only and Delete to edit mode only contradicts an Accepted ADR (`design-spec-guard` flags it) and needs an amendment or a superseding ADR.
- **Danger style.** The "delete project data" button is `Settings.tsx:233`, `Button variant="danger"` "Clear derived project data..." (`Button.tsx:8`: transparent, `--danger` border and text, `--review-soft` hover); `--danger` is `#b5473c` / `#db7a6e` (`styles.css:42,98`), the same as `--review`. Also used at `Manuscript.tsx:438`, `Transcript.tsx:450`, `TeleprompterPage.tsx:316`. Confirm dialogs use a primary confirm button (`GuideDetail.tsx:825`, `Settings.tsx:362`). A red icon-only trash is a new icon-shaped danger style; contrast is unverified (palette PRD).
- **"Go to line".** The only Story Bible text button is `GuideDetail.tsx:757-762` (ghost `Button` with `faFileLines`, already in `TooltipTarget "Open this evidence in Manuscript"`); already icon-only: `EntitySummary.tsx:150-158` (`aria-label="Go to line in Manuscript"`) and `proofing/Results.tsx:150-159`. No `IconButton` primitive exists: one class string is pasted about 31 times across 10 files (14 in `GuideDetail.tsx`), with no disabled look (`styles.css:122-124` sets only the cursor; `Button.tsx:17` has `disabled:opacity-40`). `TooltipTarget` API and a11y gaps: `Tooltip.tsx:44-97` (hover 1000 ms, focus immediate, `aria-describedby` on the wrapper span, shared id, no Escape). Drivers and docs assume the name: `app.drivers.ts:216` (`/Go to line/`), `docs/guides/using-the-app/story-bible.md`.
- **Menu.** No menu or popover primitive; the only menu is the hand-rolled category menu (`GuideDetail.tsx:239-260`, `role="menu"`, no Escape, outside-click or arrow keys).
- **Pronunciation UI** (`GuideDetail.tsx:376-409`): read-only IPA `div` shows `entity.pronunciation.ipa || 'Not generated'` (`:390`) and `Source: ... · Confidence: ...` (`:406-408`); the play button is disabled only for a new draft (`:399`), enabled when IPA is "Not generated" (March Hare, `mockFixtures.ts:343`); alias play buttons are never disabled (`:439-446`). Its tooltip says "provider-generated pronunciation" (`:393`), but the preview speaks the spelled name and ignores the IPA (`story-bible-and-import-ux-briefs.prd.md:25`).
- **Generation.** `pronunciation()` (`manuscript_guide.py:439-464`): CMU via `pronouncing` (medium), then eSpeak via `phonemizer` (low), else "not generated". It is called only from `build_entities` (`:573,:587`), `edit` for aliases (`:834`) and `create` (`:891,:902`). There is no standalone "generate for this name" call, `edit()` has no pronunciation field, and a rename does not regenerate. Go never passes `--espeak-library` (`service.go:156,165-169,187`; asserted `service_test.go:119-131`), so the eSpeak fallback depends on a system libespeak and invented names likely stay "not generated" on a stock machine (inferred, unverified). `Piper.tts_provider` (`apps/desktop/app.go:677`) is a TTS provider with a single choice, unrelated to IPA.
- **Overlap with the briefs PRD.** Its P phases (`:236-249,280`) decide what a "provider" means, prove the preview can speak a chosen output, and put a pronunciation control in edit mode (a decision-log row rejects a read-only "try another provider" button). Generating and replacing are mutations, so they belong in edit mode and are blocked for locked entries (ADR 0007).
- **Tests and states.** `GuideDetail.test.tsx:60-68` asserts Delete is absent for locked entries; `App.test.tsx:84` expects "Delete entity" right after creating an entry in read-only mode; drivers `delete-confirm` (`app.drivers.ts:323-332`), `global/confirm-dialog` (`:529-535`), `storybible/entry-locked` (`:333-338`) click Delete or Lock straight after selecting; catalog `state-catalog.ts:96,201`. Mock: 8 entities (`mockFixtures.ts:226-343`), Queen of Hearts the only locked one. `docs/guides/using-the-app/story-bible.md` and doc screenshots `storybible-entity`, `-entry-editing`, `-needs-review`, `-alias-dropdown`.

## Proposed Solution

- **Properties.** An ordered list of key/value pairs on every entity, editable in edit mode, filled at import from labelled lines, preserved across rebuilds, shown in read view and in the entry summary.
- **Icon-only "Go to line"** using a new `IconButton` with a tooltip; the Story Bible button is the same as the ones elsewhere.
- **Actions by mode.** Read-only view: Lock/Unlock and Edit. Edit mode: Save, Cancel and a red Delete. Locked: Unlock only. (Alternative: one overflow menu; see Q3.)
- **Pronunciation.** Play is disabled (with a reason) until a pronunciation exists; a Generate button creates one when missing; when present a refresh/replace icon lets the narrator choose a different source. All in edit mode.

## Key Hypothesis

We believe composable properties, mode-appropriate actions and an honest pronunciation control will make entries accurate to the book and remove mis-clicks. We'll know we're right when an imported "Codename/Abilities/Dossier" block appears as properties that survive a rebuild, delete cannot be reached from read view, locking never discards an edit, and play is unavailable until a pronunciation exists.

## What We're NOT Building

- Typed or schema-validated properties (all values are text), nested properties, or per-category templates.
- A second pronunciation engine (briefs PRD Phase 9-11 own "provider"); this PRD adds the generate and replace *controls* over the existing chain.
- Making the preview speak IPA (briefs PRD Phase 10).
- Changes to the extraction precision rules (ADR 0020).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Properties round trip | Add, edit, reorder, delete persist; a rebuild keeps them on generated and locked entities | Python tests (`test_manuscript_guide.py:108-153,456-478` pattern), Go and Vitest |
| Locked entries | `edit()` rejects property changes when locked (ADR 0007) | Python test |
| Existing JSON files | Load unchanged with `properties` absent (defaults `[]`), no `schema_version` bump | Go and Python tests |
| Delete reachability | Not present in read view for any entry; present in edit mode; locked entries have neither | Vitest |
| Lock while editing | Cannot happen; Lock then Unlock returns to read-only | Vitest |
| Preview gating | Play disabled without a pronunciation, with a reason tooltip | Vitest |
| Generate | Creates a pronunciation for an entry without one; refused for locked entries; shows in-flight state | Go and Python tests |
| Go to line | Icon-only with `aria-label` containing "Go to line" and a tooltip | Vitest, driver still finds it |
| Visual | PNGs at four viewports for read, edit, locked, properties, missing pronunciation | Playwright suite |

## Open Questions

- [ ] **B1. Properties shape.** Ordered list `[{key, value}]` (recommended; Go decodes to `map[string]any` and re-marshals, which sorts object keys and would lose the user's order) versus an object.
- [ ] **B2. Which categories get properties?** All (recommendation) or Characters only.
- [ ] **B3. Actions layout.** (a) mode-based buttons (recommended: Lock in read view, red Delete in edit mode) or (b) one overflow "hamburger" menu, which needs a menu primitive with full keyboard and a11y behavior (overlaps the dialog and Tooltip PRDs). Recommendation: (a) now, (b) when the DropdownMenu primitive lands.
- [ ] **B4. ADR 0018.** Amend or supersede? Recommendation: a new ADR superseding the "regardless of mode" clause, recording the new action placement and the lock/edit interaction.
- [ ] **B5. Delete in edit mode only.** The destructive action becomes reachable only after Edit, which is the intent, but is it also easy to mis-click beside Save? Recommendation: red, separated to the far side of the header, with the existing confirm dialog kept.
- [ ] **B6. Locking rule.** Lock only in read-only view; how does a narrator lock a new draft? Recommendation: new drafts start unlocked and lock after save.
- [ ] **B7. Icon for Delete.** A red icon-only trash is a new danger `IconButton`; its icon colour is `--danger-text` (the text-safe danger colour, [colour and contrast](../design/colour-and-contrast.md)).
- [ ] **B8. Play gating meaning.** The audio speaks the spelled name and ignores IPA, so gating on IPA is a UI policy only. Options: gate on IPA existing (requested), or gate on a non-empty name. Recommendation: as requested; say so in the disabled tooltip.
- [ ] **B9. Generate and replace live in edit mode** (briefs PRD decision) but the request reads as available while viewing. Recommendation: edit mode, matching ADR 0018 and ADR 0007, and blocked for locked entries; confirm with the owner.
- [ ] **B10. Choice of service.** What is "a different service"? Today only CMU then eSpeak, in a fixed order, and no user choice. Recommendation: the replace control offers CMU and eSpeak explicitly (each may be unavailable) until the briefs PRD Phase 9 decides on providers; store the chosen source and confidence with the value.
- [ ] **B11. Rebuild.** A generated or chosen pronunciation is lost on rebuild for unlocked entities until `merge_locked` carries it (briefs PRD Phase 10). Should this PRD carry it? Recommendation: yes, for entries the narrator explicitly set.
- [ ] **B12. `review_state`.** `edit()` marks an entry reviewed on every call (`:842`); does adding properties or generating a pronunciation count as review? Recommendation: properties yes, generation no.

## Users & Context

**Primary User**: a narrator preparing character names and facts in the Story Bible, Windows first.
**Current behavior**: imports a cast list and loses the labelled facts; sees Delete beside Save; taps play on a name with no pronunciation and gets an error or nothing; cannot generate or swap a pronunciation.
**Trigger**: reviewing entries after an import or build.
**Success state**: entries carry their facts; risky actions are out of the way; pronunciation is generated on request.
**Job to Be Done**: When I review a character, I want its facts and pronunciation in one place with safe actions, so I can record it correctly.
**Non-Users**: narrators who never open the Story Bible.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | `properties` on entities: Python (`edit`, `create --properties`, `build_entities` default, `merge`, `merge_locked` carry-over), Go `normalizeEntity`, TS type and `normalizeGuideEntity`, mock | 1 |
| Must | Properties section in `GuideDetail` (edit: add, rename, reorder, delete rows; read: list), and in `EntitySummary` | 1 |
| Must | Icon-only "Go to line" (`IconButton` + tooltip) | 2 |
| Must | Actions by mode; red Delete in edit mode; lock cannot occur mid-edit; ADR | 2 |
| Must | Play disabled without a pronunciation, with a reason | 3 |
| Must | Generate (missing) and refresh/replace (present) in edit mode; binding, sidecar command, in-flight state | 3 |
| Should | Stop `edit()` marking reviewed for non-review edits (B12) | 1 |
| Could | Overflow menu variant; per-category property suggestions | 2 |
| Won't | Typed properties, new engines, IPA-speaking preview | - |

**User flow**: open an entry; the header shows Lock and Edit; the properties list shows "Codename: ..."; Edit reveals row controls, Save, Cancel and a red Delete; a name with no pronunciation shows Generate and a disabled play button whose tooltip says why; after Generate the play button enables and a refresh icon offers another source.

## Technical Approach

**Feasibility**: Step 1 HIGH; Step 2 HIGH but coupled to `IconButton`; Step 3 MEDIUM (new binding, sidecar command and the unresolved provider question).

**Architecture notes**
- **Properties**: additive, so no `schema_version` bump and old files stay valid (readers default `[]`); Python `edit()` takes a JSON value and inherits the lock guard; `create` gains `--properties`; `merge()` unions by key (pattern `:971-975`); `merge_locked` carries them (`:682-685`); host API probably unchanged if properties ride the existing `values` map. Frozen sidecars rebuild for the new arguments.
- **Actions**: split the header into a read-only action set and an edit action set in `GuideDetail.tsx`; reset `editing` on Unlock; add tests for the lock/edit interaction and keep the server-side lock guards.
- **Pronunciation**: a Python subcommand (or `edit` field) `pronounce <name> [--source ...]` reusing `pronunciation()`; `guide.Service` method; binding `GuidePronounce` (a `hostAPIVersion` bump 5 to 6 in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2`, regenerate `Host.{js,d.ts}`), contracts, `wailsClient.ts`, `mockApi.ts`; locked entries rejected (ADR 0007); real in-flight state (ADR 0015; cold start is at least 0.3 s, briefs PRD evidence); write the binding on the host accessor (`h.services()`, see `docs/architecture/host-binding-concurrency.md`).
- Gating: `GuideDetail.tsx:399,439-446` disable states, with `IconButton`'s disabled look and a tooltip on a disabled child (`Tooltip.tsx:49`).
- Tests: Python, Go `service_test.go`, Vitest (`GuideDetail.test.tsx`, drivers), visual rows for properties, missing pronunciation, edit actions; docs `story-bible.md` and screenshots (`doc-screenshot-sync`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Contradicting an Accepted ADR without recording it | Certain if skipped | New ADR; `design-spec-guard` |
| Properties lost on rebuild | Medium | Explicit carry-over and a rebuild test |
| Delete moved to edit mode breaks drivers and tests | High | Update `app.drivers.ts:323-338,529-535`, `GuideDetail.test.tsx:60-68`, `App.test.tsx:84` in the same phase |
| Host API bump collisions | High | One bump per phase; check at merge |
| `IconButton` and Tooltip contract still moving | Medium | Sequence after primitives Phase 1 and the Tooltip PRD Phase 1 |
| Generate returns nothing for invented names (eSpeak unconfigured) | High | Show "not generated" with the reason and the source attempted; do not disable retry |
| Same files edited by the interaction audit (Story Bible action feedback), dialog and briefs PRDs | High | Small hunks; rebase; audit Phase 4 first if possible |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Properties | Schema, sidecar, Go, TS, UI, rebuild carry-over, tests | pending | - | - | - |
| 2 | Actions and icon-only Go to line | Mode-based actions, red Delete, lock/edit fix, ADR, `IconButton` use | pending | 1 | primitives Phase 1 | - |
| 3 | Pronunciation controls | Play gating, Generate, replace icon, binding, API bump | pending | - | 2 (soft); briefs Phase 9 (provider question) | - |

**Phase 1 - Properties.** Goal: entries hold ordered key/value facts. Success: round-trip, rebuild, lock and old-file tests; PNGs for read and edit.
**Phase 2 - Actions and icon-only Go to line.** Goal: safe, mode-based actions. Success: Vitest and drivers updated; lock mid-edit impossible; ADR merged.
**Phase 3 - Pronunciation controls.** Goal: an honest, generatable pronunciation. Success: play gated; Generate works on a fixture name and is refused on a locked entry; API bumped and Host regenerated.

**Parallelism Notes**: Phases 1 and 2 edit different parts of `GuideDetail.tsx` and can run together with a rebase; Phase 3 waits on Phase 2's button structure.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `manuscript_guide.py` and tests, `apps/desktop/internal/guide/service.go`, `apps/desktop/bindings.go`, `contracts/storyBible.ts`, `GuideDetail.tsx`, `EntitySummary.tsx`, `mockApi.ts`/`mockFixtures.ts` | Import-structure Phase 3 (`create --properties`), briefs PRD Phases 10-11 (`edit()`, `merge_locked`), the delivered host accessor (Guide bindings now on `h.services()`) |
| 2 | `GuideDetail.tsx`, `EntitySummary.tsx`, `Button.tsx`, ADR 0018, drivers, catalog, `story-bible.md`, screenshots | Interaction audit Phase 4, dialog PRD (`ConfirmDialog`), Tooltip PRD, palette PRD (`--danger`) |
| 3 | `manuscript_guide.py`, `service.go`, `bindings.go`, `app.go`, `hostApi.ts`, `Host.*`, contracts, `GuideDetail.tsx` | Every binding-adding phase (API version), the delivered host accessor, briefs Phase 9-11 |

Cross-cutting: ADR numbering and `hostAPIVersion` re-checked at merge time; `visual-catalog-sync`, the Playwright suite with PNG review at four viewports, `doc-screenshot-sync`, `design-spec-guard`; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Entries read-only until Edit; locked entries enforced server-side (prior, ADR 0018, 0007) | Kept; the "actions regardless of mode" clause is superseded (proposed) | Keep the header as is | Requested placement |
| Pronunciation changes happen in edit mode through `edit()`-family commands (prior, briefs PRD) | Generate and replace in edit mode (proposed) | Read-view button | Single enforcement point |
| Property order | Ordered list (proposed) | Object | Go re-marshal sorts keys |
| Actions layout | Mode-based buttons first (proposed) | Overflow menu | No menu primitive yet |

## Research Summary

**Technical Context**: verified in code on this branch: the entity schema and merge behavior, the edit choke point, header layouts per mode and the lock/edit hazard, danger styling, icon-button duplication and tooltip contract, the pronunciation chain and UI, tests, drivers and mocks, and the PRD/ADR overlaps.
**Not verified**: eSpeak availability on a stock machine, contrast of a red icon button, and whether `edit()` marking every change reviewed is intended.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
