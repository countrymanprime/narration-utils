# Manuscript Reader: Search and Controls

**Source:** user requests of 2026-09-20 (items 3 reader side, 4-12). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. Nothing here is built yet. The import side of item 3 (what the importer produces for Contents and Characters) is in [import-structure-toc-and-characters.prd.md](import-structure-toc-and-characters.prd.md).

## Problem Statement

The Manuscript page's "Chapters & Search" panel and controls bar work but read poorly and hide bugs:

- Search fires on every keystroke and its result rows are misaligned, wrap oddly, show no highlighted match, and show a line number that is wrong for collapsed chapters.
- Selecting a result leaves the query in the box, there is no clear button, and the jump highlight stays for a full minute.
- The bookmark icon is a different colour in the chapter list than on the chapter header, and chapter results omit subtitles.
- The controls are spread over two rows with a text "Text size" label, and the imported table of contents shows up as a readable chapter that is not part of the recording.

## Evidence

- **Search runs per keystroke in Go over the whole file.** `SearchBar.tsx:13` fires `onChange` on every keystroke into `runSearch` (`apps/ui/src/components/manuscript/Manuscript.tsx:221-234`), then `manuscriptSearch` (`wailsClient.ts:132`, `apps/desktop/bindings.go:345-347`) to `Service.Search` (`apps/desktop/internal/manuscript/reader.go:59-78`). `Search` calls `Load()` (`service.go:302-321`), which re-reads and unmarshals `manuscript.json` every time, lower-cases every paragraph, and returns every match with the whole paragraph as `excerpt` (`reader.go:71-74`): no cap, no offset, no title or note search. No debounce hook exists (`src/hooks/` holds only `useTextSelection`). Latency is now measured: a search that matches every paragraph of an 88,000 word manuscript takes about 3 ms at p50 and 8 ms at p95 in Go ([latency baseline](../research/interaction-latency-baseline.md)), so the cost of a search per keystroke is the render, not the call.
- **Result row** (`ChapterNav.tsx:63-80`): a `<button class="w-full">` with a magnifier icon and `<span class="truncate">Line {n} · {excerpt}</span>`. The button is not a flex container and has no `text-left`, so browser default centering applies, and `truncate` on an inline span does nothing, so long text wraps. This is the likely cause of the misalignment; it is inferred from the code, and no screenshot with a query exists.
- **Line numbers are wrong for collapsed chapters.** `chapterLineNumbers` covers only loaded (expanded) chapters (`Manuscript.tsx:62`, `state.ts:99-107`); `ChapterNav.tsx:35` falls back to the global paragraph index. `chapter.paragraphIds` (`{id, index}`, `reader.go:346-353`) already carries the in-chapter position.
- **Empty panel.** `ChapterNav.tsx:42` shows "No matches" only when `searchResults.length === 0`; if every hit is in a hidden reference chapter, the panel is blank (`reader.go:69-77` does not filter kinds).
- **Highlight primitive.** `Highlight` has kinds `Character|Place|Organization|Lore|Item|Event|Review|Note|Cursor` (`Highlight.tsx:5`) and no search or match kind. `highlightTerms(text, terms)` (`state.ts:58-70`) already splits text into match segments and is the precedent (`EntitySummary.tsx:139-147`, `GuideDetail.tsx:746-754`). No text-windowing helper exists; the only ellipsis is CSS `truncate`. The panel is `w-[min(20rem,100vw)]` with `p-[1.1rem]` (`SlideOver.tsx:30,45`), so a hit row has about 220-230px, roughly 35-40 characters at `0.74rem`.
- **Jump highlight.** `JUMP_HIGHLIGHT_MS = 60_000` (`Manuscript.tsx:31`), used once (`:158`); the tint class is `JUMP_TARGET_CLASS` (`ParagraphView.tsx:62`) with a 1.6 s pulse animation (`styles.css:160-169`). Documented as 60 s / "about a minute" in `docs/design/design-system.md:42`, `docs/guides/using-the-app/manuscript.md:8,52,54`, `state-catalog.ts:62` and `doc-screenshots.json:268-274`. The same `showChapter` (`Manuscript.tsx:139-167`) serves search results, Story Bible "Go to line", Proofing, `EntitySummary` and `#p` deep links, so the change affects all of them.
- **Search does not clear.** `searchQuery`/`searchResults` (`Manuscript.tsx:58-59`) are never reset; `closeSheet()` (`:72-75`) and Escape (`:131-137`) leave them. The result `select` (`:469-475`) closes the sheet and jumps. `SearchBar.tsx:1-17` takes only `{query, onQueryChange}` with no clear affordance. The Story Bible search has a hand-positioned clear button to copy (`Guide.tsx:188-205`).
- **Bookmark colours differ.** Header: `text-[var(--bookmark)]` (`Manuscript.tsx:350`), `#3b6fc4` light / `#6e9fdb` dark. Chapter list: `text-[var(--accent)]` (`ChapterNav.tsx:58`), `#b85c1e` / `#e2903f`. Line and note bookmark rows inherit muted text (`:89`). `--bookmark` is not in the token list of `design-system.md:9`. ADR 0017 (`:13`) records an earlier bug from two conflicting colour utilities, so classes must stay mutually exclusive.
- **Subtitles.** `ManuscriptChapter.subtitle?` exists (`contracts/manuscript.ts:6`, `reader.go:343-345`) and the reader header shows "title - subtitle" (`Manuscript.tsx:363-370`), but chapter rows in the panel are single-line title only (`ChapterNav.tsx:52-62`), and titles and subtitles are not searched.
- **Controls bar** (`Manuscript.tsx:274-333`): row 1 has the heading and the Chapters & Search icon button on the left and the category legend on the right (`:279-303`); row 2 has "Text size" plus an info Tooltip, three Pills, then expand-all and collapse-all icon buttons, all left-aligned with no `ml-auto` (`:304-331`). Content width is about 1216 / 968 / 712 / 358 px at 1440 / 1024 / 768 / 390; row 2 is about 355px, so one more control wraps at 390. The Tooltip's explanation ("always uses the full reading width", `:305-307`) is attached to the label being removed. Drivers and tests click by accessible name (`app.drivers.ts:146-161,189-192`, `Manuscript.test.tsx:166,177,183`), so `small|medium|large`, `Chapters & Search` and the expand/collapse names must not change.
- **Icons.** FontAwesome only (`package.json:23-26`); `faFont`, `faCircleXmark`, `faParagraph`, `faAlignLeft`, `faHashtag`, `faQuoteLeft` exist. There is no `IconButton`; one 32px class string is pasted about 31 times (`Manuscript.tsx:285,316,325` and others). Result types today: line hit `faMagnifyingGlass` + "Line {n} ·" (`ChapterNav.tsx:71-76`), chapter rows have a status dot and word count (`:56-61`), line/note bookmarks a bookmark icon plus `Line {n}` or `Note` (`:88-94`, unreachable in the mock because `mockFixtures.ts:369-380` sets no `chapterId`).
- **Contents on the page.** The reader renders every chapter (`Manuscript.tsx:335`); Contents is `reference` (`apps/desktop/internal/importer/model.go:94`), which `isListableChapter` hides only in the panel (`state.ts:7`, `ChapterNav.tsx:38`). The page can open on it (`Manuscript.tsx:101`), "Expand all" loads it (`:317`), and `#p` links resolve against unfiltered chapters (`:188`). [ADR 0005](../adr/0005-reference-material-excluded-from-chapter-nav.md) says the continuous reader deliberately does not filter and the backend never filters; hiding Contents in the reader reverses that half and needs a superseding ADR. Totals already exclude it (`AudiobookEstimatePanel.tsx:63`, `apps/desktop/app.go:596`).
- **Tests and states.** `Manuscript.test.tsx:197-207,209-228` do `fireEvent.change` then `findAllByRole` (1 s default timeout), so a 2 s debounce needs fake timers or an exported delay constant (pattern: `Tooltip.test.tsx:6-12`). `ChapterNav.test.tsx:19-33` covers only the reference filter. No test or visual row types a query, shows a long excerpt, the clear button, subtitles or bookmark colours; `chapters-overlay-open` has no query (`app.drivers.ts:158-161`). A search state needs a wait, and `freezeClock` has a known React 19 transition caveat (`app.drivers.ts:10-14`). The mock's search returns whole paragraphs with no `chapterId` (`mockApi.ts:615-622`), and the Alice text is fetched over the network with a seed fallback (`mockApi.ts:124`).

## Proposed Solution

Five steps, smallest first: fix the search defects and small items; debounce with a cheap pre-debounce subset; redesign the result rows; rework the controls bar on a shared `IconButton`; hide non-recorded material (Contents) from the reader under a new ADR.

## Key Hypothesis

We believe a debounced, left-aligned, highlighted search with correct line numbers, and one right-aligned controls cluster, will let a narrator find and land on a line without noise. We'll know we're right when a query shows nothing for the line hits until the debounce elapses, every row reads `[icon] Line n: ...match...` with the match visible, selecting a result clears the box, and the page no longer opens on the table of contents.

## What We're NOT Building

- Full-text search across notes, Story Bible entries or bookmarks (rows may show them only if Q6 says so).
- A new search backend (an index or persistent cache) beyond removing the per-keystroke file parse if measurement shows it matters.
- Changes to the jump-to-line mechanism itself, only its highlight duration.
- Read-aloud or teleprompter buttons in the chapter header (`teleprompter-manuscript-integration.prd.md` Phase 2).
- Filtering reference material in the backend (ADR 0005 stays for the backend).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| No line results before the debounce | 0 line hits render within the debounce window; chapter-title matches render immediately | Vitest with fake timers |
| Requests per typed word | 1 (after the debounce), stale responses still discarded | Vitest counting `manuscriptSearch` calls |
| Row format | `[icon] Line n: text` left-aligned, match highlighted, match always visible after right-then-left truncation | Vitest on the windowing helper; PNG review at four viewports |
| Line numbers | In-chapter number for collapsed and expanded chapters | Vitest |
| Clearing | Selecting a result empties the query and results; the clear icon empties them and refocuses the input | Vitest |
| Jump highlight | 30 s tint (half of 60 s); constant, docs and catalog agree | Grep plus test on the constant |
| Bookmark colour | One token for header and panel in light and dark | Vitest class assertion; PNG review |
| Controls | One right-aligned cluster, no wrap at 390 px, no sideways overflow | Playwright visual suite (a failing gate) |
| Contents | Reader neither opens on nor lists Contents; audio totals unchanged | Vitest with a reference-kind fixture |

## Open Questions

Decided 2026-09-21 (owner instruction, `docs/prds/implementation-plan.md` D22): every recommendation below is adopted as written, with two clarifications the plan makes explicit. R4 takes the dedicated `Search` highlight kind, not the "or a local `<mark>` style" fallback - the palette PRD's colour-mix work is delivered, so a local style would duplicate it. R13's three follow-on decisions (default open chapter, "Expand all", `#p` links to a hidden target) are settled in Phase 5 below rather than left to the recommendation's parenthetical, and are recorded in the superseding ADR, not here.

- [x] **R1. Debounce length.** The request says line options should not appear for "about 2s at least". Options: 2 s flat; 2 s but Enter fires immediately; shorter (500 ms) with the chapter subset in between. Recommendation: 2 s constant `SEARCH_DEBOUNCE_MS`, Enter fires now, and a visible "Searching..." hint so "No matches" never flashes.
- [x] **R2. Pre-debounce subset.** Chapter titles and subtitles filtered client-side from `chapters` state (free, no request). Recommendation: yes, immediately per keystroke.
- [x] **R3. Windowing.** Character budget (approximate, no measuring) or pixel measurement (`canvas.measureText`, or a `ResizeObserver` on the row)? The request shows ASCII `...`. Recommendation: character budget from the measured row width, `...` on either or both ends only when text is cut, first match only, and the match term alone wider than the row truncates the term.
- [x] **R4. Match highlight.** Add a `Search` kind to `Highlight` (union, `TOKEN`, story) or reuse an existing kind? The palette work is delivered: a new kind needs a colour with a dark value, a derived `--<kind>-text` and pairs in `paletteContrast.test.ts` ([colour and contrast](../design/colour-and-contrast.md)), and the tint nests with other highlights. Decided: a dedicated `Search` kind, built on the delivered colour-mix infrastructure (not a local `<mark>` style).
- [x] **R5. Line number source.** `paragraphIds` position (recommended) versus loading paragraphs.
- [x] **R6. Result types and icons.** Line (`faParagraph`?), chapter title, note, bookmark: which icon each, and are notes searchable? Recommendation: line, chapter-title hits only in this PRD.
- [x] **R7. Jump highlight scope.** Halve the 60 s tint only, or also the 1.6 s pulse? "Halve it for now" reads as the tint. Recommendation: 30 s tint, pulse unchanged.
- [x] **R8. Clear on Escape and close.** Only on selecting a result and the clear icon, or also on close and Escape? Recommendation: clear on select and icon; Escape clears first, closes second; autofocus the input on open.
- [x] **R9. Bookmark colour.** Unify on `--bookmark` (blue, as the docs say) or `--accent`? Recommendation: `--bookmark`, add it to the token table, and colour line/note bookmark rows the same.
- [x] **R10. Subtitles in browse mode too?** Recommendation: yes, second line, truncated.
- [x] **R11. Text-size tooltip.** Where does "always uses the full reading width" go once the label is a `faFont` icon? Recommendation: on the icon (its accessible name "Text size"), delivered with the Tooltip PRD's button-based tooltip.
- [x] **R12. Controls grouping at 390 px.** Order and wrap: recommendation text-size group left, chapters/search plus expand/collapse right, wrapping to a second line only below 400 px.
- [x] **R13. What to hide (item 3).** Contents only, or all `reference` sections (Characters, Glossary)? Recommendation: all reference sections, since none is recorded; the ADR supersedes only the reader half of ADR 0005. Also decide the default open chapter, "Expand all", and `#p` links to hidden paragraphs (recommendation: a hidden target redirects to the reference chapter's own view or is a no-op with a message).
- [x] **R14. Existing imports.** Contents stays visible until re-import (ADR 0013). Recommendation: the reader filter covers existing manuscripts too, since it keys on `contentKind`.

## Users & Context

**Primary User**: a narrator reading a manuscript on the Manuscript page while preparing to record, Windows first.
**Current behavior**: types a name, gets a jumble of full paragraphs, mentally scans for the match, jumps, and finds the query still in the box and the line highlighted for a minute.
**Trigger**: looking for a line, a name or a chapter.
**Success state**: results are short, aligned and highlighted; picking one lands on the line and resets the search.
**Job to Be Done**: When I need a specific line, I want compact results showing where my term is, so I can jump straight there and keep reading.
**Non-Users**: narrators who never open the reader; the Story Bible search (separate, already has a clear button).

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | In-chapter line numbers from `paragraphIds`; "No matches" when all hits are hidden | 1 |
| Must | Clear query and results on selecting a result; clear (x) icon in the search input | 1 |
| Must | `JUMP_HIGHLIGHT_MS` halved; docs and catalog updated | 1 |
| Must | Bookmark colour unified on one token | 1 |
| Must | Debounce with chapter-title subset before it, "Searching..." state, stale-response guard kept | 2 |
| Should | Server: cache the loaded manuscript across calls, cap results, return the match offset | 2 |
| Must | Rows `[icon] Line n: ...text...`, left-aligned, match highlighted, right-then-left truncation | 3 |
| Must | Subtitle under the chapter title in the panel | 3 |
| Must | Controls bar: chapters/search inline with the other controls; font icon in place of "Text size"; chapters/search and expand/collapse right-aligned with space from text size | 4 |
| Must | Reader hides reference (and Contents) chapters, default chapter, Expand all and hash links handled; superseding ADR | 5 |
| Could | Notes and bookmarks as search results | 3 |
| Won't | New search index, teleprompter buttons, backend filtering | - |

**User flow**: open Chapters & Search; typing shows matching chapter titles at once; after the pause the matching lines appear as `[icon] Line 2: ...fly away.' **Juno** said, checking...`; choosing one closes the panel, clears the box, jumps and highlights for 30 s.

## Technical Approach

**Feasibility**: HIGH; every part has an in-repo precedent except text windowing and the top-layer/tooltip interaction.

**Architecture notes**
- Split `searchQuery` into the live input text and the committed query; add `useDebouncedValue(value, ms)` (and an exported `SEARCH_DEBOUNCE_MS`) in `src/hooks/`; keep the `searchRequest` ref guard (`Manuscript.tsx:43`).
- Add a pure `windowExcerpt(text, matchStart, matchLength, budget)` helper next to `highlightTerms` in `state.ts` with unit tests (ellipsis on the right first, then the left; never cut the match); render segments through `highlightTerms` and a highlight.
- `SearchHit` gains an optional `matchStart`; no binding signature change and no `hostAPIVersion` bump (`SearchHit` is inside a `map[string]any`-style payload, verify at the time). Cache the parsed manuscript in the service keyed by file mtime.
- Extract the row into a small component so the two-line chapter row, the hit row and the bookmark rows share structure and the same left-aligned flex layout (button `flex text-left`).
- Controls bar uses the shared `IconButton` and `SearchField` (delivered by the UI primitives stack S10, [ADR 0053](../adr/0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)); the reader's search box already is a `SearchField` with a clear button.
- Reader filtering: a shared helper (`isRecordedChapter`) for the page, default chapter, Expand all, hash resolution and Home counts, so the four gates stay in sync. New ADR (next free number, 0037 at dc9d01a) supersedes the reader half of ADR 0005; `design-spec-guard` applies.
- Update: `Manuscript.test.tsx` (fake timers for debounce), `ChapterNav.test.tsx`, new tests for windowing, clearing and line numbers; visual rows `chapters-overlay-search`, `chapters-overlay-long-results`, `chapters-overlay-clear`, controls at four viewports; `docs/guides/using-the-app/manuscript.md`, `design-system.md:42`, `doc-screenshots.json` (most manuscript screenshots change with the controls bar).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Debounce breaks two existing tests and slow visual states | High | Fake timers or an injected delay; a driver that advances the clock only where safe |
| Renaming accessible names breaks tests and drivers | High | Keep `Chapters & Search`, `small/medium/large`, `Collapse all chapters` and the result aria-label shape |
| Control-bar change regenerates about 10 doc screenshots | High | `doc-screenshot-sync` in the same PR |
| A new Highlight kind needs the palette pairs | Low | Add the tokens and pairs (colour-and-contrast) or use a local style |
| Reader filter reverses part of an accepted ADR | Certain | New superseding ADR; do not edit ADR 0005 |
| Tooltip inside the panel or controls hidden after the dialog/tooltip PRDs land | Medium | Verify in the same PR; Tooltip PRD Phase 1 first |
| Mock search does not mirror the real payload | Medium | Fixture with `chapterId`, in-chapter positions and long paragraphs |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Search defects and small fixes | Line numbers, empty state, clear on select and clear icon, 30 s highlight, one bookmark colour, docs | complete | - | - | - |
| 2 | Debounce and subset | Debounce hook, chapter-title subset, searching state, server cache/cap/offset, tests, visual state | complete | - | 1 | - |
| 3 | Result rows | Left-aligned rows, `[icon] Line n: text`, windowing helper, match highlight, subtitle line, states | complete | - | 2 | - |
| 4 | Controls bar | Inline chapters/search, font icon, right-aligned cluster, tooltip home, screenshots | complete | 3 | primitives Phase 1 (soft) | - |
| 5 | Hide non-recorded chapters | `isRecordedChapter`, ADR, default chapter, Expand all, hash links, tests | complete | 3, 4 | import-structure Phase 2 (soft) | - |

**Phase 1 - Search defects and small fixes.** Goal: correct behavior before restyling. Scope: `paragraphIds`-based numbering, "No matches" when hits are hidden, `select` clears (bump `searchRequest`), `SearchField` clear icon (copy `Guide.tsx:188-205`), `JUMP_HIGHLIGHT_MS = 30_000` with the docs at `design-system.md:42`, `manuscript.md:8,52,54`, `state-catalog.ts:62`, `doc-screenshots.json`, `ChapterNav` bookmark to `--bookmark`. Success: Vitest for each; PNGs reviewed.

**Phase 2 - Debounce and subset.** Goal: no per-keystroke Go scans and no line options before the pause. Scope: as above; measure `ManuscriptSearch` latency with and without the cache and record it. Success: request count test; `manuscriptSearch` called once per settled query.

**Phase 3 - Result rows.** Goal: readable, aligned rows. Scope: windowing helper, highlight, icons, subtitle line, row extraction. Success: PNGs at 1440/1024/768/390 with a long paragraph and the term near the start, middle and end.

**Phase 4 - Controls bar.** Goal: one right-aligned control cluster. Scope: markup change, `faFont` icon with accessible name, tooltip re-homed, all screenshots regenerated. Success: no wrap or overflow at 390 px in the suite.

**Phase 5 - Hide non-recorded chapters.** Goal: the reader shows only what is recorded (and opening material if kept). Scope: helper, gates, ADR, tests including a reference-first manuscript. Success: audio totals unchanged; page opens on the first recorded chapter. Delivered: reused the existing `isListableChapter` (`state.ts`) rather than a second `isRecordedChapter` helper, since the two checks were already the same rule; `Manuscript.tsx`'s render loop, default active chapter (on load and when a saved reader state points at a now-hidden chapter, R14), and "Expand all" all filter through it, and a `#p`/`#c` link into a reference chapter is a no-op with a `notify` message rather than a redirect (no per-chapter reference view exists to redirect to). `AudiobookEstimatePanel.tsx` needed no change (its own `narration`-only filter is already stricter). See [ADR 0090](../adr/0090-the-page-flip-reader-hides-reference-chapters-superseding-the-reader-half-of-adr-0005.md).

**Parallelism Notes**: Phases 1-3 edit `ChapterNav.tsx` and `Manuscript.tsx`, so serialize them; Phase 4 touches the controls markup and can run beside Phase 3 with a rebase; Phase 5 is independent of 2-4 apart from `Manuscript.tsx` conflicts.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1-3 | `Manuscript.tsx`, `ChapterNav.tsx`, `SearchBar.tsx`, `SlideOver.tsx`, `state.ts`, `Highlight.tsx`, `reader.go`, `contracts/manuscript.ts`, mock, catalog/drivers, `manuscript.md` | Palette PRD Phase 4 (`Highlight.tsx`), Tooltip PRD Phase 1, `chapter-stage-recommendations.prd.md` Phase 9 (`ChapterNav.tsx`), interaction audit (search latency), test-stability PRD (drivers) |
| 4 | `Manuscript.tsx` controls, `Pill.tsx`, doc screenshots | `teleprompter-manuscript-integration.prd.md` Phase 2 (chapter header button), primitives Phase 1 (`IconButton`), every screenshot |
| 5 | `Manuscript.tsx`, `state.ts`, `AudiobookEstimatePanel.tsx`, `App.tsx` hash effect, ADR | ADR 0005, import-review and import-structure PRDs, `Home.tsx` count |

Cross-cutting: re-check ADR numbering and `hostAPIVersion` at merge time; `visual-catalog-sync`, the Playwright suite with PNG review at all four viewports, `doc-screenshot-sync`, `design-spec-guard`; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Reference material filtered only at the listing layer (prior, ADR 0005) | Reader half reversed by a new ADR; backend never filters | Keep the reader unfiltered | Requested; nothing reference is recorded |
| Highlights use the `Highlight` primitive (prior, ADR 0016) | Match highlight through it | A separate mark style | One highlighted-text primitive |
| Mutually exclusive state classes (prior, ADR 0017) | Bookmark colour as one class | Base plus override | Recorded bug class |
| Debounce | 2 s, Enter immediate (decided 2026-09-21, D22) | Shorter | Requested "about 2s at least" |
| Highlight halving | 30 s tint, pulse unchanged (decided 2026-09-21, D22) | Also the pulse | "Halve it for now" |
| Bookmark token | `--bookmark` (decided 2026-09-21, D22) | `--accent` | Docs already call it blue; added to the palette's AA token-pair test (`paletteContrast.test.ts`), passes 3:1 in both themes with no colour change needed |
| Match highlight kind | A dedicated `Search` kind on `Highlight`, not a local `<mark>` style (decided 2026-09-21, D22) | Reuse an existing kind; a local mark style | The palette's colour-mix Highlight work (S12a) is delivered; reusing it keeps one highlighted-text primitive (ADR 0016) |
| Reference chapters in the reader (R13) | All `reference` chapters hidden from the page-flip view, reusing `isListableChapter`; a hidden-target link is a no-op with a message (decided 2026-09-21, D22; [ADR 0090](../adr/0090-the-page-flip-reader-hides-reference-chapters-superseding-the-reader-half-of-adr-0005.md)) | Contents only; redirect a hidden link to a per-chapter reference view | Nothing reference is recorded; the reader has no standalone reference-chapter view to redirect to |

## Research Summary

**Technical Context**: verified in code on this branch: the search path from UI to Go, the row markup, `Highlight`/`highlightTerms`, the jump-highlight constant and every doc that cites it, the bookmark tokens, the controls bar markup, the icon set, tests, visual rows and doc screenshots, and the ADR and PRD overlaps.
**Not verified**: the misalignment cause (no screenshot with a query exists), real search latency, the dialog-top-layer/tooltip interaction, and how a long tail of results behaves in the panel.

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
