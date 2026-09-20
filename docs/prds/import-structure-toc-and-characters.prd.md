# Import Structure: Table of Contents and Characters

**Source:** user requests of 2026-09-20 (items 3 importer side, 18, 19, and the Characters observations). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. Related: [import-review-redesign.prd.md](import-review-redesign.prd.md) (the dialog), [manuscript-reader-search-and-controls.prd.md](manuscript-reader-search-and-controls.prd.md) Phase 5 (hiding the result in the reader), [story-bible-entries-and-actions.prd.md](story-bible-entries-and-actions.prd.md) (entry properties).

## Problem Statement

The importer treats a manuscript's front and back structure inconsistently:

- The **table of contents** is catalogued but stays a readable chapter, can be turned into a Story Bible character suggestion, and, depending on the Word layout, may not be recognised at all and leak into narration.
- The **Characters** section is a chapter-like reference section *and* the source of Story Bible suggestions, with labelled lines ("Codename", "Abilities", "Dossier") parsed as if each label were a character name.
- A real table of contents already lists the chapters, yet the importer discovers chapters only by guessing at headings.

## Evidence

- **Classification.** `contentKind` is `narration | opening | reference` (`apps/ui/src/api/contracts/manuscript.ts:2`, validated `apps/desktop/internal/manuscript/service.go:390`); Contents and Table of Contents are `reference` (`apps/desktop/internal/importer/model.go:94`, applied `:184`), separate from `opening` (Front Matter, Cover; ADR 0004). A detected Contents heading gets its own group (`isNonChapterHeading`, `model.go:105-111`; `docx.go:232,256-260`; `markdown.go:87-90`) and is not added to `titles`. Commit keeps every paragraph (`canonicalize`, `service.go:383-432`). Totals and sidecars already exclude non-narration (`AudiobookEstimatePanel.tsx:63`, `apps/desktop/app.go:596`, `manuscript_guide.py:209-219`, `chapter_script.py:65`, `compare.py:783`).
- **It still shows on the Manuscript page** because the reader renders every chapter (`Manuscript.tsx:335`); only the panel hides reference chapters (`state.ts:7`, ADR 0005). See the reader PRD.
- **Layouts where Contents is not cleanly classified (inferred from code paths; check the user's file).** Word's own TOC heading uses the "TOC Heading" style (`outlineLvl` 9), which `docx.go:190-194` does not treat as a heading, so `isNonChapterHeading` never fires. A TOC before the first chapter with no Title heading is swept into Front Matter or Cover (`docx.go:230-249,269-272`). A TOC after a `Title`-styled paragraph lands inside the Title "chapter" as narration (`Title` counts as a heading, `docx.go:191`), leaking into totals and the Story Bible scan.
- **How Contents becomes a Story Bible suggestion.** The Python extractor reads narration chapters only (`manuscript_guide.py:209-219`, pinned by `test_manuscript_guide.py:64-85`), so a correctly classified TOC cannot reach it. The importer's candidate list can: after a Characters heading a stateful `characterListActive` branch (`model.go:176,190-192,202-209`) turns any later non-narrative reference group whose title passes `looksLikeName` into a candidate. The flag ends only at a narrative marker (`isNarrativeMarker` knows chapter, part, book, prologue, epilogue, afterword, `:113-116`), and Contents groups are processed after every real heading (`model.go:166-172`), so "Contents" becomes a candidate named "Contents" with its first line as the description. The same flag can classify every later plain heading of six words or fewer as reference if chapters are not "Chapter N" style. The Python path also sees a TOC if it was misfiled as narration or the user set it to Narration in the dialog.
- **Characters today.** The review dialog lists a Characters row as Reference plus all-checked "Story Bible character suggestions" (`Home.tsx:275-307`). After import the section remains a chapter in the reader; in docx every heading is a chapter, so each per-character heading is its own reference "chapter"; in Markdown headings below the chosen level are `section` values inside the Characters chapter. Checked candidates become `manual=True` Story Bible entities via two Python processes each (`apps/desktop/bindings.go:305-330`).
- **Label parsing.** `characterLine` (`model.go:131-144`) splits on the first of ` — `, ` – `, ` - `, `: `; `looksLikeName` needs at most 6 words, at most 80 runes, letters, apostrophes and hyphens (`:118-129`); paragraphs split on `;`, lines over 240 runes are rejected. Any "Label: value" line therefore looks like "name: description": "Codename: X" yields a candidate "Codename", "Abilities: Flight; invisibility" yields "Abilities" and "invisibility", and dedupe by lowercase name keeps only the first character's "Codename" (traced by hand; no test covers `CharacterCandidates`). In the heading-per-character branch the description is the first paragraph only, uncapped; labelled lines after it stay in the reference chapter, which nothing structured reads.
- **How headings are found.** docx: style name starts with `heading`, or `title`, or own `pPr` `outlineLvl` other than 9 (`docx.go:168-176,190-194`), all levels start a chapter, custom styles' inherited `outlineLvl` is ignored (`styles.xml` is read only for names, `docx.go:49-82`); title/subtitle splitting is separate (`headings.go:52-97`, ADR 0013). Markdown: only headings at the chosen level (`markdown.go:86-93`); shallower headings are dropped silently; glued-heading repairs are not reported to `Notices` (`markdown.go:91`), against ADR 0013.
- **No TOC structure is read.** `tests/fixtures/alice.docx` has no `fldChar`, `instrText`, `w:hyperlink`, `bookmarkStart`, `_Toc`, `PAGEREF` or `sdt`; it has a `TOCHeading` style but no `TOC1`. Field and hyperlink text flows through as plain `w:t`, so a Word TOC line arrives as body text like "Chapter One 3". Markdown does not parse links or list markers; `[Chapter One](#chapter-one)` stays literal (`markdown_inline.go`) and consecutive list lines join into one paragraph (`markdown.go:49-63`). The fixture's Contents is one heading plus one "aside" paragraph (`generate_alice.py:60-63`); `tests/fixtures/README.md` and `generate_alice.py` still cite a Python `docx_chapters.py` and `NON_CHAPTER_HEADINGS` that no longer exist.
- **Tests.** `model_test.go:9-34,52-83` cover classification with synthetic drafts; `importer_test.go:12,25` use the Alice fixtures; nothing covers docx-level Contents, a real TOC, `CharacterCandidates`, or a labelled characters block. The client forwarding test is `wailsClient.test.ts:41-52`.

## Proposed Solution

Four steps: stop the leaks with tests first; decide how a Contents section is kept or dropped (and how Characters relate to chapters); capture labelled character lines as structured data; then let a real TOC be the authority for the chapter list, falling back to today's heuristics.

## Key Hypothesis

We believe a Contents section that never reaches the recording, reader or Story Bible, characters that become Story Bible entries with their labelled properties instead of reader chapters, and a chapter list taken from the manuscript's own TOC will remove the manual cleanup after import. We'll know we're right when, on the user's manuscript, no "Contents" candidate appears, Contents is absent from the reader and totals, each character arrives as one entry with Codename/Abilities/Dossier as properties, and the proposed chapters match the TOC.

## What We're NOT Building

- Any change to the Python extractor's narration-only rule.
- Editing or repairing the user's source manuscript.
- A general document-structure engine: index, glossary and figure lists are only recognised where they are TOCs.
- Back-filling existing projects; re-import ("Replace manuscript", ADR 0013) remains the path.
- Editing Story Bible properties in the UI (that is the Story Bible PRD).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| No "Contents" candidate | 0 on the fixtures and the user's manuscript | Go table tests over TOC layouts (heading, TOC Heading style, pre-first-heading, after Title) |
| TOC never leaks into narration | Contents lines are `reference` in every listed layout | `docx_test.go` cases using `docxFixture` |
| Candidate accuracy | Labelled lines become properties, not candidates; a block with Codename/Abilities/Dossier yields one candidate per character | Go tests including the "Codename" collision case |
| One process per candidate | Candidate created with properties in a single sidecar call | Go test with a fake sidecar |
| TOC-authoritative chapters | On a fixture with a real TOC, proposed chapters equal the TOC entries (Title and Contents excluded) | Go test; fallback test when the TOC is missing or unmatched |
| Notices | "TOC listed N entries, matched M" appears whenever they differ | Go test |
| Existing fixtures unchanged | `importer_test.go` results identical for correct headings | `pnpm check` |

## Open Questions

- [ ] **S1. Drop or keep Contents?** Options: (a) keep as `reference` and hide it in the reader (recommended; reader PRD Phase 5); (b) drop its paragraphs at import (simplest, but loses readable-in-place; indices are assigned after the drop); (c) a new `contents` kind (needs the `service.go:390` validator, the TS enum and `Home.tsx:266-268` options, and the denylist consumers `apps/desktop/app.go:596` and `state.ts:7`, which would count or list it unless updated; allowlist consumers are safe). Recommendation: (a) now; (c) only if a distinct label is wanted in the dialog.
- [ ] **S2. Characters as chapters.** Should an accepted Characters section stop being a chapter entirely (not stored as reader chapters), or stay stored as reference and hidden like Contents? Recommendation: stay stored and hidden; the Story Bible entries are the readable form.
- [ ] **S3. `characterListActive` scope.** Bound it to a Characters section's own subheadings (by heading level or until the next heading of equal or higher level) instead of "until a narrative marker". Recommendation: yes; it also fixes the swallow-every-later-heading case.
- [ ] **S4. Label rule.** A label vocabulary (Codename, Abilities, Dossier) or a structural rule (label lines under an open candidate)? Recommendation: structural: a bare name line or heading opens a candidate; following `Label: value` lines attach as ordered properties; with no candidate open, "Name: description" keeps today's behavior.
- [ ] **S5. Where do properties go?** `CharacterCandidate.Properties []struct{Key, Value string}` (ordered list) sent through the extended `create --properties` (Story Bible PRD Phase 1). Blocked on that PRD's schema decision.
- [ ] **S6. TOC-authority scope.** docx first or both formats? Confirm with the user's file that the TOC is a field with `_Toc` bookmarks (this repo's fixture has none). How strongly may a mismatch override heuristics? Recommendation: docx first; TOC wins only when at least a set fraction of entries match body headings (bookmark, then normalised text, then ordinal), otherwise fall back and report.
- [ ] **S7. What still needs heading detection after a TOC?** Body segmentation (bookmarks give exact boundaries even for custom styles), subtitle splitting, front-matter detection and the no-TOC fallback all remain, so "no special heading finding" is not fully true.
- [ ] **S8. Multiple TOCs, lists of figures/tables, non-English "Contents".** Recommendation: recognise TOC fields and `TOC N` styles only; treat others as ordinary content.
- [ ] **S9. Persist Notices?** Show them in the review dialog (see the import review PRD), and whether Markdown repairs are reported too (`markdown.go:91` discards the flag).

## Users & Context

**Primary User**: a narrator or self-publisher importing a Word or Markdown manuscript that has a table of contents and a cast list.
**Current behavior**: imports, then sees Contents in the reader and character-name noise ("Codename") in the suggestions, and unticks or deletes by hand.
**Trigger**: importing or replacing a manuscript.
**Success state**: the proposed structure matches the book's own TOC; the cast arrives as Story Bible entries with their labelled facts.
**Job to Be Done**: When I import a manuscript, I want the book's own structure and cast recognised, so I only correct real exceptions.
**Non-Users**: narrators importing a plain draft with no TOC or cast; developers changing the sidecar extractor.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Fix `characterListActive` so TOC groups are never candidates; scope it to the Characters section | 1 |
| Must | Recognise TOC Heading style, pre-first-heading TOC lines and Title-adjacent TOC lines as Contents/reference | 1 |
| Must | Fixtures and tests: docx TOC, labelled cast, "CHAPTER ONE / Subtitle" | 1 |
| Must | Contents and Characters not shown as readable chapters (S1, S2); ADR | 2 |
| Must | Labelled lines captured as ordered properties on the candidate; `create --properties` | 3 |
| Should | Candidate creation in one sidecar call | 3 |
| Must | TOC read from docx (field, `TOC N` style, sdt, bookmarks/hyperlinks) and used as the chapter list with fallback | 4 |
| Should | Markdown TOC (link list with anchors) | 4 |
| Should | `Notices` for mismatch, Markdown repairs | 4 |
| Could | Repair stale fixture README and generator | 1 |
| Won't | Extractor changes, source repair, index/glossary handling | - |

**User flow**: choose a manuscript; the review shows "12 chapters from the table of contents, 1 front matter, cast of 5 (Story Bible)"; nothing named Contents or Codename appears as a suggestion; after import the reader starts on Chapter One and the Story Bible has five characters with their properties.

## Technical Approach

**Feasibility**: Step 1 HIGH; Step 2 HIGH once decided; Step 3 MEDIUM (cross-PRD schema); Step 4 MEDIUM (OOXML details from Word's format, not verified in this repo).

**Architecture notes**
- **Step 1**: extend `paragraphRecord` (`docx.go:12-16`) with style name and outline level; classify `TOCHeading`/`TOC N` styles as Contents; end `characterListActive` at any heading of equal or higher level than the Characters heading; skip Contents in `looksLikeName` candidates. Build TOC XML in `docxFixture` (`docx_test.go:15-70`; its `styles.xml` needs `TOC1` and `TOCHeading`).
- **Step 2**: no new kind under S1(a); the reader helper `isRecordedChapter` belongs to the reader PRD. Record the decision in an ADR (next free number, 0037 at dc9d01a) that supersedes only the reader half of ADR 0005.
- **Step 3**: `Properties` on `CharacterCandidate` (`model.go:27-32`); block state machine in the Characters handling; `create` gains `--properties <json>` (removing the second `edit` process, `bindings.go:318,324`); frozen sidecars rebuild for the new CLI arguments. Wire and mock: `mockApi` preview candidates get properties.
- **Step 4**: read TOC entries (text with page number stripped, level, anchor) from `fldChar`/`instrText` "TOC", `TOC N` styles or an sdt with docPartGallery "Table of Contents"; match to headings by bookmark or anchor, then normalised text, then ordinal; matched headings become the chapter list (book Title, Contents and unlisted headings stop being proposed chapters; today the fixture's Title counts, `importer_test.go:28`). Subtitles still come from the heading paragraph's own split; the TOC text is flattened and can only corroborate. Markdown parses `[text](#slug)` list lines against heading slugs (duplicate-suffix and punctuation rules apply).
- Tests: Go (`docx_test.go`, `markdown_test.go`, `model_test.go`, `importer_test.go`), `wailsClient.test.ts`, mock and visual rows for the review (import-review PRD Phase 1 comes first).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| TOC entries do not match body headings (stale fields, hand-typed TOC, page numbers or dot leaders inside text) | High | Threshold plus fallback plus a Notice; never fail an import |
| Wrong candidate parsing on real casts | Medium | Structural rule plus tests built from the user's cast block; candidates stay reviewable |
| Denylist consumers count Contents if a new kind is added | Medium | Prefer S1(a); otherwise update `app.go:596` and `state.ts:7` together with tests |
| Existing manuscripts keep the old structure | Certain | Document re-import; the reader filter covers existing data by `contentKind` |
| Frozen sidecar not rebuilt for `--properties` | Medium | Release checklist; Python and Go tests |
| `Home.tsx`/importer collisions | High | Import-review Phase 1 extraction first; briefs PRD Phase 5 touches the importer too |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Stop the leaks | `characterListActive` scope, TOC layouts, fixtures and tests, stale fixture docs | pending | - | - | - |
| 2 | Contents and Characters in the reader | Decide S1/S2, ADR, coordinate the reader filter | pending | - | 1; reader PRD Phase 5 | - |
| 3 | Structured character properties | `Properties` on candidates, structural label rule, `create --properties`, single call | pending | - | 1; Story Bible entries PRD Phase 1 | - |
| 4 | TOC as the chapter list | docx TOC reader and matcher, fallback, Markdown links, notices | pending | - | 1 | - |

**Phase 1 - Stop the leaks.** Goal: no TOC-derived suggestions or narration leakage. Scope as above. Success: table tests for each layout; `importer_test.go` fixture results unchanged.
**Phase 2 - Contents and Characters in the reader.** Goal: neither appears as a readable chapter. Scope: the decision, ADR, and the reader PRD's helper. Success: reader and totals verified on a fixture with a TOC and cast.
**Phase 3 - Structured character properties.** Goal: labelled facts survive as data. Scope: schema agreed with the Story Bible PRD, parser, sidecar CLI, wire. Success: a Codename/Abilities/Dossier block produces one candidate with three properties.
**Phase 4 - TOC as the chapter list.** Goal: the manuscript's own list of chapters. Scope: docx first. Success: proposed chapters equal TOC entries on a TOC fixture; fallback and notice tested.

**Parallelism Notes**: Phase 4 is independent of 2 and 3; Phases 1 and 4 both edit `docx.go` and `model.go`, so serialize them.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/internal/importer/{docx,model,markdown}.go` and tests, `tests/fixtures/*` | Briefs PRD Phase 5 (importer), import-review Phase 2 (`model.go` `DraftSection`) |
| 2 | `state.ts`, `Manuscript.tsx`, ADR | Reader PRD Phase 5, ADR 0005 |
| 3 | `model.go`, `apps/desktop/bindings.go`, `sidecars/manuscript-guide/core/manuscript_guide.py`, `apps/desktop/internal/guide/service.go`, contracts, mock | Story Bible entries PRD, the delivered host accessor (`bindings.go`, `docs/architecture/host-binding-concurrency.md`), API bump if a signature changes |
| 4 | `docx.go`, `markdown.go`, `model.go`, notices in the preview payload | Import-review PRD (Notices display), Phase 1 |

Cross-cutting: ADR numbering and `hostAPIVersion` re-checked at merge; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`; UI-visible changes add `visual-catalog-sync` and `doc-screenshot-sync`; sidecar changes rebuild the frozen sidecars. No Lua.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Reference material excluded from totals and Proofing (prior, ADR 0005/0004) | Contents stays `reference` (proposed) | New `contents` kind, drop at import | Least churn; totals already correct |
| Detected manuscript offered, never imported silently (prior, ADR 0019) | Kept | - | Standing decision |
| Precision over recall for entities (prior, ADR 0020) | Suggestions stay reviewable | Auto-create | Standing decision |
| Label handling | Structural rule (proposed) | Vocabulary list | Works for unknown labels |
| TOC precedence | TOC wins above a match threshold, otherwise heuristics (proposed) | TOC always | Stale TOCs are common |

## Research Summary

**Technical Context**: verified in code on this branch: classification, the candidate state machine, label parsing, heading detection, Python filtering, fixtures and tests, and `alice.docx`'s XML (no TOC structure).
**Not verified**: how the user's own manuscript lays out its TOC and cast (all layout claims above are inferred from code paths), OOXML TOC details beyond Word's documented format, and Markdown slug rules for their tooling.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
