# Prep Depth: Speaker Attribution, Script Markup, Pronunciation Sources and Author Queries

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 6 ("Prep depth: Speaker attribution and a markup layer. Web lookups that open in the browser, so the app stays local-only. A narrator-edited pronunciation store with its sources. Author query export.") and §1 "Prep" (must-haves: "Hard words and character names pulled out... automatically" [L9][W20]; "A pronunciation list: the word, the chosen pronunciation, the source, a recorded snippet, and whether the author confirmed it" [W19b][W20]; "One-click lookups in Forvo, YouGlish, Merriam-Webster and Howjsay" [W19b][W20]; "Script markup (stress, pauses, character tags) that carries through to the booth view" [W24]; differentiator "Speaker attribution for each line of dialogue" and "A questionnaire of queries for the author or rights holder, exported and tracked until it is answered"). Part of the benchmark train wave 3/4 ([agent train](../operations/agent-train.md)).

**Shares ground with:** [Character Continuity Review](character-continuity-review.prd.md) Phase 2 ("Stable characters, dialogue cues, appearance maps"), which already specifies the rules-based dialogue-cue extraction this PRD's speaker attribution reads rather than re-specifying — see Evidence and Open Question Q1. **Sibling:** [Provider Ports](provider-ports.prd.md) Open Question Q5 declares a `BrowserLookup` role on `PronunciationSource` with no implementation; this PRD implements it.

Citations are `file:line` on `main` at `48a882d` for anything checked in code; "per docs" marks a claim taken from another PRD and not independently re-verified in this session.

## Problem Statement

Prep in this app stops at what the importer and Manuscript Guide already produce: a character list with evidence-backed notes, and a pronunciation the narrator can preview but that carries no source, no confirmation state and no way to ask the author about it. The benchmark's own scorecard marks "Narrator-edited pronunciation store; lookups in Forvo, YouGlish and Merriam-Webster; author queries" as **Planned / Missing** ("Only an offline WordNet lookup is shipped. There are no web-source lookups and no author-query export") and "Speaker attribution for each line of dialogue; script markup for stress and pauses" as **Missing** outright ("Reader notes and bookmarks only"). A narrator prepping a multi-character book today has to keep a separate spreadsheet or sticky notes for who is speaking each line, how a word should be stressed, and which pronunciations still need the author's sign-off — exactly the kind of bookkeeping the benchmark found narrators doing by hand [L53]-adjacent, and exactly the gap a two-way, in-app prep surface is meant to close.

## Evidence

Verified in code (`48a882d`):

- **Pronunciation already carries a source and a chosen flag, but no status or note.** `GuidePronunciation = { ipa: string; source: string; confidence: string; chosen?: boolean }` (`apps/ui/src/api/contracts/storyBible.ts:7`), one per entity name and per alias (`:11,19`). `pronounce_source(name, espeak_library, source)` (`sidecars/manuscript-guide/core/manuscript_guide.py:452-490`) only ever returns `cmu` or `espeak` (`PRONUNCIATION_SOURCES = {"cmu", "espeak"}`, `:449`); there is no `user` source, so a narrator's own edited pronunciation cannot be distinguished from a dictionary lookup, and nothing records "the author confirmed it" (the benchmark's must-have).
- **Only one offline lookup exists.** The scorecard's own line: "Only an offline WordNet lookup is shipped" (per docs, story-bible-and-import-ux-briefs PRD dictionary/thesaurus integration). A search of `sidecars/manuscript-guide` and `apps/desktop` for `forvo`, `youglish`, `merriam` and `howjsay` (case-insensitive) finds nothing.
- **Entities already carry evidence-backed personality notes and relationships, the precedent for a queries list.** `personality_notes` is a list of `{text, evidence: {chapter, excerpt}}` (`manuscript_guide.py:618`, `:903` for a user-authored note with `"User edit"`/`"User-authored note."` in place of a chapter/excerpt); `relationships` is a similar evidence-carrying list (`:620`, merge logic at `:1106-1116`). An author-query list is the same shape: a question, its evidence (the word or line in context), and a status, kept alongside the entity or the pronunciation entry it is about.
- **No dialogue, speaker or quote extraction exists today.** A search of `manuscript_guide.py` for `speaker`, `dialogue` and `quote` (case-insensitive) finds nothing (confirmed again in this session). [Character Continuity Review](character-continuity-review.prd.md) Phase 2 already specifies exactly this work — "rules-based cue extraction... (quote spans, adjacent 'said Name' and alias patterns, per-scene continuation) with `unknown` when unclear and a narrator correction path" (per docs, that PRD's Open Question Q4) — for its own purpose (locating dialogue audio to compare against a character's approved voice reference). That PRD's own Phase 2 status note (2026-09-26, stream A8, per docs) records it was **not delivered**, flagged on `#509` as lane B's (`sidecars/manuscript-guide/core/manuscript_guide.py`) rather than lane A's, and recommends it land either in lane B or as a short lane-A/C follow-up once the sidecar JSON shape is real.
- **No markup layer (stress, pauses, character tags) exists.** A search for `markup`, `stress mark` and `pause mark` in `apps/ui/src` and `sidecars/manuscript-guide` finds nothing beyond generic Markdown/inline-formatting spans (`docs/adr/0014-inline-formatting-as-offset-spans.md`, per docs — an existing precedent for *how* a span-based layer would be represented, offsets into the manuscript text, not a new text format).
- **A span-highlighting primitive and precedent already exist for rendering an overlay on script text.** `Highlight` primitive (per docs, `docs/adr/0016-highlight-primitive.md`) and the proofing diff's own word-level marks (`docs/adr/0063-the-proofing-diff-marks-its-own-words-and-adr-0016-covers-entry-highlights.md`, per docs) are the established pattern for drawing marks over manuscript text without a new rendering engine; a markup layer's stress/pause/character-tag spans are one more consumer of that pattern, not a new one.
- **The provider ports PRD already reserves the seam this PRD needs.** `provider-ports.prd.md` Open Question Q5: "Is 'web lookup opens in the browser' a `PronunciationSource`? Recommendation: yes, as a separate role (`BrowserLookup`, returns a URL the host opens, never fetched by the app). The role is declared here with no implementation; the source itself belongs to benchmark recommendation 6's PRD" — this PRD.
- **The host already opens URLs and files in the narrator's own applications, so opening a browser tab is not a new trust boundary.** Per docs (existing "open in default application" bindings used elsewhere in the app, for example opening an exported report); this PRD's web lookups reuse that same "open, never fetch" shape.

Per docs (not independently re-verified in this session): the four look-up sites' exact URL-query shapes (Forvo, YouGlish, Merriam-Webster, Howjsay) are cited by the benchmark [W19b][W20] as differentiators professionals use, but their precise URL formats are not read from each site in this session (Phase 0 verifies before shipping, mirroring how the delivery-platform-profiles PRD's own Phase 0 verified ACX's numbers before building against them).

## Proposed Solution

Deepen prep in three additive layers that never require a second import or re-extraction the narrator did not ask for:

1. **Pronunciation depth.** Extend the pronunciation entry with a `status` (`researched`, `author_confirmed`, `query_sent`) and an optional note, add a `user` source for a narrator-typed override (never silently replacing the dictionary's own answer — both stay, one `chosen`), and a **query list** derived from every pronunciation whose status is not `author_confirmed`, exportable as a plain file the narrator can send to an author or rights holder and re-import (or hand-mark) once answered.
2. **Web lookups.** A `PronunciationSource.BrowserLookup` implementation per site (Forvo, YouGlish, Merriam-Webster, Howjsay): one host call that opens the narrator's default browser to that site's search for the word, never fetched or scraped by the app.
3. **Speaker attribution and script markup.** Read the dialogue cues [Character Continuity Review](character-continuity-review.prd.md) Phase 2 already specifies (built wherever it lands, lane B or a short follow-up — Q1), and render them in the reader as speaker tags on dialogue lines. Add an independent, additive **markup layer**: narrator-placed spans over the manuscript text for stress, pause and a character tag override, stored the same offset-span way inline formatting already is (ADR 0014, per docs), rendered with the existing `Highlight` primitive (ADR 0016, per docs). The markup layer is designed to **carry through to the booth view** (the benchmark's own phrase) by being a plain, versioned, chapter-scoped data file any later booth-mode PRD can read — this PRD does not build the booth view itself.

## Key Hypothesis

We believe that a narrator-owned pronunciation status and query export, web lookups that never leave the local-only boundary, and a markup layer that reuses the existing dialogue-cue and highlight machinery will let a narrator finish prep for a multi-character book inside the app, without a side spreadsheet. We'll know we're right when: every pronunciation not yet author-confirmed appears on one exportable query list; a lookup opens the correct external site with no network call from the app itself; and a markup span placed during prep is still there, unchanged, when the same chapter is read in any later view that reads the same file.

## What We're NOT Building

| Item | Why |
| --- | --- |
| A second dialogue-cue extractor | [Character Continuity Review](character-continuity-review.prd.md) Phase 2 already specifies rules-based cue extraction; this PRD is a consumer of that output, not a second producer (Q1) |
| Fetching, scraping or caching any lookup site's content | `BrowserLookup` only opens a URL in the narrator's own browser (provider-ports Q5); the app stays local-only (roadmap product boundary) |
| The booth view itself | The booth-mode-and-companion-panel PRD (stream N-D1 of this train, per docs) builds the reading surface; this PRD only makes the markup layer a plain file that view can read |
| AI-generated pronunciations, or auto-answering an author query | Precision-first, evidence-based prep only (mirrors ADR 0020's precision-over-recall stance, per docs); a query is answered by the author or the narrator, never guessed |
| A structured questionnaire builder, ticketing or reminders for the author | The query list is an export the narrator sends by whatever means they already use (email, a shared doc); no in-app messaging |
| Tracking an author's answer automatically | The narrator marks a query `author_confirmed` by hand after hearing back; no email parsing or webhook |
| Full character-bible relationship review or export | Already out of scope in [Character Continuity Review](character-continuity-review.prd.md)'s own "What We're NOT Building" (`manuscript-guide.md` "later work"); this PRD does not reopen it |
| A pronunciation confidence score change from the existing CMU/eSpeak pipeline | Confidence stays whatever the dictionary source reports (`GuidePronunciation.confidence`); this PRD adds status and source, not a new confidence model |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Query list completeness | Every pronunciation entry not `author_confirmed` appears exactly once on the export | Go/Python table test |
| No network call from the app for a lookup | `BrowserLookup` opens a URL through the host's existing "open externally" path and makes zero HTTP requests itself | Test asserting no client is constructed; code review |
| Markup survives independent of extraction | A markup span placed by the narrator is unchanged after a Manuscript Guide rebuild that does not touch that chapter's text | Go/Python test: rebuild with unchanged text preserves markup exactly |
| Attribution accuracy (borrowed from Character Continuity Review's own Q4 gate) | Labeled-quote evaluation reported once that PRD's Phase 2 lands; this PRD's speaker tags never show a guess where the extractor said `unknown` | Shared fixture set; `unknown` renders as unattributed, never a fabricated name |
| Wire contracts | Every new payload has a Zod schema, a golden, a `wireContracts.test.ts` row and a passing mock | `pnpm check` |
| Gate | `pnpm check` (full) green; visual suite for the reader's new markup/attribution states and the pronunciation panel at every viewport | CI and PNG review |

## Open Questions

Every question takes its recommendation by default (D22, per the [implementation plan](implementation-plan.md)); anything genuinely needing the owner is filed as a Proposed ADR and a comment on #510.

- [ ] **Q1. Who builds the dialogue-cue extractor this PRD's speaker attribution reads?** (A) Wait for [Character Continuity Review](character-continuity-review.prd.md) Phase 2 to land (lane B, per its own status note) and consume its output as-is. (B) This PRD's own Phase 2 builds a minimal, separate cue extractor in lane B scope, coordinated on #509 to avoid duplicating that PRD's Phase 2. (C) Build attribution UI now against a fixture, wire the real extractor in when either lands. **Recommendation: (C).** The two PRDs need the exact same extractor; building it twice would diverge. This PRD's Phase 2 builds the reader-side attribution UI and the markup layer against a recorded fixture shape, and swaps to the real sidecar output in a follow-up phase once either PRD's cue work lands — recorded here as a Proposed ADR if the owner wants a single shared phase instead.
- [ ] **Q2. Does a narrator-typed pronunciation override replace the dictionary's answer, or sit beside it?** (A) Beside it: both `cmu`/`espeak` and `user` entries exist per name/alias, one `chosen`, so switching back never re-runs the dictionary. (B) Replace: editing overwrites the dictionary entry. **Recommendation: (A).** `GuidePronunciation.chosen` already models "one of several is picked" (Evidence); reusing it for a `user` source needs no new concept, and a narrator who mistypes an override can revert to the dictionary's answer without re-triggering a lookup.
- [ ] **Q3. Query export format?** (A) Plain text/Markdown (one line per query: word, chapter, excerpt, current pronunciation, status). (B) CSV, mirroring the proofer's own CSV import/export shape (`docs/prds/review-dashboard-and-findings-adoption.prd.md`, per docs). **Recommendation: (B)**, so the same "email or hand a file to someone outside the app" pattern the proofer CSV already established is reused rather than inventing a second export shape.
- [ ] **Q4. Which four lookup sites ship, and are more addable later?** (A) Exactly Forvo, YouGlish, Merriam-Webster and Howjsay (the benchmark's own list [W19b][W20]), each a fixed URL template verified in Phase 0. (B) A configurable list the narrator can edit. **Recommendation: (A)** for v1 (matches the benchmark's differentiator list exactly); a configurable list is a small Could if a narrator asks for a fifth site.
- [ ] **Q5. Where does markup live?** (A) A new project-scoped, chapter-keyed sidecar (`<project>/narration-utils/prep/markup.json`), spans as `{start, end, kind: stress|pause|character_tag, value?}` offsets into the chapter's own text, mirroring the inline-formatting offset-span precedent (ADR 0014, per docs). (B) Inline in the manuscript JSON itself. **Recommendation: (A).** Keeping markup in its own sidecar (like `character/references.json`) means a manuscript rebuild that only touches derived data never risks corrupting narrator-placed spans, and a later booth-mode PRD reads one small, clearly-owned file.
- [ ] **Q6. Does the markup layer validate spans against the current chapter text on read?** (A) Yes: an offset outside the current text length, or one whose underlying substring no longer matches what was recorded at placement time, is reported as "stale" rather than silently applied at the wrong position. (B) No validation; trust the offsets. **Recommendation: (A)**, mirroring [Character Continuity Review](character-continuity-review.prd.md)'s own "changed since approval" detection for regions (Q2/Q3 of that PRD, per docs) — the same discipline applied to text offsets instead of audio ranges.

## Users & Context

**Primary user:** a solo author-narrator prepping a multi-character manuscript, who wants to know who is speaking each line, how to stress and pace tricky words, and which pronunciations still need the author's sign-off before recording begins.

**Current behavior:** keeps a separate document or sticky notes for pronunciation questions to send the author, re-derives who is speaking by re-reading the surrounding paragraph each time, and marks up a printed or separately-annotated script for stress and pauses.

**Trigger:** starting prep on a new chapter or book; realizing a pronunciation needs the author's confirmation before recording; wanting the booth view to show who is speaking without re-reading ahead.

**Job to be done:** when I am prepping a chapter, I want speaker attribution, my own stress/pause markup, and a clear list of what pronunciation questions are still open, so that recording day has nothing left to figure out on the fly.

**Non-users:** readers of a single-narrator, single-voice book with no attribution need; anyone wanting the app itself to message the author.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Pronunciation status, `user` source, query list data model | 1 |
| Must | `BrowserLookup` implementations for the four sites, Phase 0 URL verification | 2 |
| Must | Query export (Q3) and a "mark answered" action | 3 |
| Must | Speaker attribution reader UI against the shared cue output (real once available, fixture until then — Q1) | 4 |
| Must | Markup layer: data model, placement UI, staleness detection (Q6) | 5 |
| Should | Query re-import (the author's answers marked back onto the list) | 6 |
| Could | A per-chapter "prep completeness" summary read by the production board (this train's Production Tracking PRD) | 7 |
| Won't | A second cue extractor, fetching lookup sites, the booth view itself, in-app author messaging | See table above |

### MVP scope

Phases 1 to 5: pronunciation depth, web lookups, the query export, and speaker attribution plus markup in the reader.

### User flow

1. In the Story Bible / pronunciation view, each entry shows its dictionary pronunciation, an optional narrator override, a status, and **Look up** buttons for the four sites — pressing one opens the narrator's browser.
2. Entries not yet `author_confirmed` collect on a **Pronunciation queries** panel; **Export** writes the CSV (Q3).
3. Once the author replies, the narrator marks each answered query `author_confirmed` (typed in, or matched against a re-imported file per Q6/Should).
4. In the reader, dialogue lines show a speaker tag (from the shared cue output, `unknown` shown as unattributed, never guessed); the narrator places stress, pause and character-tag markup spans directly on the script, rendered with the existing highlight styling.
5. A stale markup span (Q6) shows a small "text changed here" notice rather than silently landing on the wrong words.

## Technical Approach

**Feasibility: HIGH** for Phases 1, 2, 3 and 6 (additive data model, small Go/Python changes, a host "open externally" call already exists as a pattern). **MEDIUM** for Phase 4 (depends on Q1's fixture-then-real sequencing) and Phase 5 (offset-based staleness detection over manuscript text is a new but bounded algorithm, analogous to region "changed since approval").

**Architecture:**

- **Pronunciation depth.** `pronounce_source` gains a `user` branch (`sidecars/manuscript-guide/core/manuscript_guide.py`) that never calls CMU/eSpeak; `GuidePronunciation` gains `status: 'researched' | 'author_confirmed' | 'query_sent'` and `note?: string` (TS contract, `apps/ui/src/api/contracts/storyBible.ts`), additive so existing entries default to `researched`. `Service.Pronounce` (`apps/desktop/internal/guide/service.go:299`) gains the `user` source path and a status-setting call.
- **Query list.** A pure function over entities' pronunciation entries (no new store — derived, like `VocabularyCandidates` derives from entities, `service.go:385`), returning every non-`author_confirmed` entry with its evidence (chapter, excerpt) reusing the `personality_notes`-shaped evidence object already in the entity schema (Evidence). Export writes CSV (Q3), mirroring the proofer CSV shape (per docs).
- **Web lookups.** New `apps/desktop/internal/pronunciationlookup` (or a `PronunciationSource` adapter under the provider ports' registry once that PRD's Phase 3+ lands, per docs) with one URL template per site, verified in Phase 0 against each site's own search-URL shape (mirrors delivery-platform-profiles PRD's own Phase 0 verification discipline); a binding `PronunciationLookupOpen(source, word)` that calls the host's existing "open externally" path — no HTTP client is constructed in this package (Success Metrics: zero network calls, enforced by a test that fails if `net/http` is imported).
- **Speaker attribution.** Reads whichever dialogue-cue output exists at the time Phase 4 starts (Q1); until then, a recorded fixture shape (agreed with [Character Continuity Review](character-continuity-review.prd.md)'s own cue contract so the swap is a data-source change, not a UI rewrite). Rendered in the reader as a small speaker-tag chip beside each attributed line; `unknown` lines render with no tag, never a placeholder name.
- **Markup layer.** New `apps/desktop/internal/prepmarkup` (or Python-side under `manuscript-guide` if co-located with the manuscript text it annotates — decided at Phase 5 planning): `Span{Start, End, Kind: stress|pause|character_tag, Value?}` per chapter, stored in `<project>/narration-utils/prep/markup.json` (Q5), atomic temp-then-rename like every other sidecar. On read, each span's underlying substring is re-checked against the current chapter text (Q6); a mismatch marks the span `stale` rather than repositioning it. Rendered with the existing `Highlight` primitive (ADR 0016, per docs), the same pattern the proofing diff already uses for its own word marks (ADR 0063, per docs).
- **Bindings.** `PronunciationSetStatus`, `PronunciationSetUserOverride`, `PronunciationQueries`, `PronunciationExportQueries`, `PronunciationLookupOpen`, `PrepMarkupList`/`PrepMarkupSave`/`PrepMarkupDelete`. Each on `h.services()` with a `stressReaders` row; `hostAPIVersion` bumps once per phase adding bindings.
- **Wire contracts (CLAUDE.md).** `apps/ui/src/api/schemas/prepDepth.ts` (pronunciation status/source, query row, markup span); goldens `tests/fixtures/contracts/prep-*.json` written by Go/Python tests with `UPDATE_CONTRACTS=1`; rows in `wireContracts.test.ts`; mocks in `mockApi.ts`. No `as` cast or bare `JSON.parse`.
- **UI.** Extends the existing Story Bible pronunciation view (no new primitive expected beyond composing existing ones — `Table`, `Select`, `TextField`, `Pill`/`StatusBadge` for status); the reader's speaker tag and markup rendering reuse `Highlight`. Visual suite: pronunciation queries panel, a lookup button row, reader states with attribution and markup, all viewports; axe clean.
- **Trust boundary.** `prep/markup.json` and the query export file are narrator-editable-on-disk files the app reads back; rows in `docs/architecture/threat-model.md` and `SECURITY.md` (tampering only corrupts the narrator's own prep annotations, never audio). Opening a browser to an external URL is a new outbound-trust row: the app never sends the manuscript's own text to the site beyond what the narrator sees in the URL (the word itself), and never reads the site's response.
- **ADRs.** One ADR at Phase 1 or 2 (pronunciation status/source model, mirroring how [Actual Recorded](actual-recorded-column.prd.md) and the delivery profiles PRD each got an ADR for a "what does this number/status actually mean" decision) and, if Q1 resolves to a shared phase with Character Continuity Review, a coordinating note in that PRD's own Decisions Log rather than a second ADR. Next free number in lane D's block (0400-0409), checked at write time and again before the last push (D52 on #509).

**Technical risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Lookup site URL formats change or were never verified against the live site | Medium | Phase 0 verification step, same discipline as delivery-platform-profiles Phase 0 |
| Speaker attribution ships against a fixture that diverges from the real extractor's eventual output shape | Medium | Q1's shared-contract coordination with Character Continuity Review before Phase 4 starts |
| Two PRDs (this one and Character Continuity Review) both try to own `manuscript_guide.py`'s cue extraction | Medium-High | Coordinated on #509 per Q1; only one phase, in either PRD, actually implements the extractor |
| Markup staleness detection false-positives on trivial text changes (whitespace) | Low-Medium | Normalize whitespace before the substring comparison; test fixtures for common edit shapes |
| Query export drifts from the proofer CSV's own column conventions, confusing a narrator who uses both | Low | Phase 3 reviews the proofer CSV's existing columns before finalizing this export's shape |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | Ports used | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Pronunciation status and user source | `user` pronunciation source, `status`/`note` fields, bindings, ADR | pending | 2 | - | none | - |
| 2 | Web lookups (Phase 0 + implementation) | URL verification note, `BrowserLookup` adapters for the four sites, "open externally" binding | pending | 1 | - | `PronunciationSource.BrowserLookup` (`provider-ports.prd.md` Q5) | - |
| 3 | Query export | Derived query list, CSV export (Q3), "mark answered" action | pending | - | 1 | none | - |
| 4 | Speaker attribution (reader) | Reader UI against a fixture cue shape (Q1), swapped to the real extractor once available | pending | 5 | Character Continuity Review Phase 2 (soft — fixture until then) | none | - |
| 5 | Markup layer | Data model, sidecar store, placement UI, staleness detection (Q6) | pending | 4 | - | UI primitive `Highlight` (ADR 0016, per docs) | - |
| 6 | Query re-import (Should) | Match a re-imported answered-queries file back onto entries | pending | - | 3 | none | - |
| 7 | Prep completeness summary (Could) | A per-chapter rollup (open queries, unresolved markup staleness) for the Production page | pending | - | 3, 5 | none | - |

### Phase details

- **Phase 1.** Tests: a `user` override never triggers a CMU/eSpeak call; switching `chosen` back to the dictionary entry is lossless (the user entry is kept, not deleted); status defaults to `researched` for every existing entry (migration-free, additive).
- **Phase 2.** Phase 0 output is a dated note in `docs/research/` naming each site's exact search-URL template, read by hand against the live site (per the delivery-profiles PRD's own precedent for a "must verify before building" phase). Tests: the URL is built correctly for a word with spaces/punctuation (URL-encoded); no `net/http` (or Python `requests`/`httpx`) import in the lookup package.
- **Phase 3.** Tests: CSV round-trip (export then a fixture human-edited file is at least readable back by Phase 6); every non-`author_confirmed` entry appears exactly once, sorted by chapter order.
- **Phase 4.** Component tests seed `unknown`, single-speaker and ambiguous-cue fixtures; a visual state for each. Swapping to the real extractor is a data-source change behind the same component props, verified by a contract test that both shapes satisfy the same schema.
- **Phase 5.** Tests: a span surviving an unrelated chapter's edit; a span over an edited region reported `stale`; whitespace-only edits do not spuriously flag staleness; deleting a stale span works without needing the original text back.
- **Phase 6.** Tests: matching an author's answered-file rows back onto entries by word/chapter identity; an unmatched row is reported, not silently dropped.
- **Phase 7.** Reads Phases 3 and 5's own data; adds no new store.

### Standing gates

Every phase: plan, `change-impact-scan` (Manuscript Guide, the reader and the Story Bible pronunciation view are shared surfaces), TDD, `pnpm check` (full), Playwright visual suite for `apps/ui` changes (all viewports), `feature-cleanup` including the threat-model rows, `Closes #<n>` on the tracking issue.

### Parallelism notes

Phases 1, 2 and 3 are independent of every other benchmark stream and of each other's UI (data-model first). Phase 4 is soft-gated on Q1's resolution but can proceed against a fixture immediately. Phase 5 is independent of Phase 4. Phases 6 and 7 are Should/Could and can slip to filler if the train's usage band tightens.

### Parallel-session compatibility

| Phase | Files touched | Collides with |
| --- | --- | --- |
| 1 | `sidecars/manuscript-guide/core/manuscript_guide.py`, `apps/desktop/internal/guide/service.go`, `apps/ui/src/api/contracts/storyBible.ts` | Any other Story Bible / Manuscript Guide phase in flight; [Character Continuity Review](character-continuity-review.prd.md) Phase 2 (same file, coordinate on #509) |
| 2 | new `apps/desktop/internal/pronunciationlookup/*`, `docs/research/` (Phase 0 note) | None expected |
| 3 | new query-list function alongside `VocabularyCandidates` in `apps/desktop/internal/guide/service.go` | Phase 1 (same file, sequence within this PRD) |
| 4 | new `apps/ui/src/components/manuscript/*` (speaker tags), reader components | [Character Continuity Review](character-continuity-review.prd.md) Phase 2 and its own lane-B cue work (Q1); teleprompter phase 5 (per docs) reuses entity summaries in the same area |
| 5 | new `apps/desktop/internal/prepmarkup/*` (or sidecar-side, TBD at planning), reader components, `apps/ui/src/components/primitives/Highlight` (consumer, not editor) | Any other reader-overlay work in flight |
| 6 | Phase 3's export/import code | None expected |
| 7 | reads Phases 3, 5 | Production Tracking PRD's own board (a consumer, not a collision) |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Dialogue-cue extraction ownership (proposed, Q1) | Build attribution UI against a fixture now; swap to whichever PRD lands the real extractor | Duplicate the extractor here; block on Character Continuity Review Phase 2 | Avoids building the same cue logic twice; unblocks this PRD's UI work immediately |
| Narrator override model (proposed, Q2) | Beside the dictionary entry, one `chosen` | Overwrite the dictionary's answer | Reuses the existing `chosen` concept; reversible without a re-lookup |
| Query export format (proposed, Q3) | CSV, matching the proofer's own shape | Plain text/Markdown | One export convention across the app for "send this outside" data |
| Markup storage (proposed, Q5) | A new project-scoped sidecar, offset spans | Inline in the manuscript JSON | Keeps narrator-placed annotations safe from a manuscript rebuild's derived-data churn |
| Markup staleness (proposed, Q6) | Validate on read; report stale rather than reposition | Trust offsets blindly | Mirrors Character Continuity Review's own "changed since approval" discipline for a different data shape |

## Research Summary

**In the repo:** the existing pronunciation contract and its source/confidence/chosen shape (`apps/ui/src/api/contracts/storyBible.ts`), the entity evidence pattern (`personality_notes`, `relationships` in `manuscript_guide.py`), the inline-formatting offset-span precedent (ADR 0014, per docs) and the `Highlight` primitive (ADR 0016, per docs) as the rendering pattern for a markup overlay, and [Character Continuity Review](character-continuity-review.prd.md)'s own dialogue-cue specification and its Phase 2 status note recording the work as undelivered and lane-ambiguous.

**From the benchmark:** recommendation 6 and its cited must-haves and differentiators ([L9], [W19b], [W20], [W24]), and the scorecard's own "Missing"/"Planned" rows for speaker attribution, markup, web lookups and author queries.

**Not verified in this session:** the four lookup sites' exact current search-URL formats (Phase 0's job, cited as a `TBD - needs verification` the same way the delivery-platform-profiles PRD flagged ACX's own numbers); whether Character Continuity Review's Phase 2 or this PRD's Phase 4 actually lands the shared cue extractor (an #509 coordination question, not a technical one).

---

*Generated: 2026-09-26*
*Status: DRAFT - open questions Q1 to Q6 take their recommendation per D22 until the owner says otherwise*

## Visual Spec

Concept mock copied from [the audiobook studio benchmark](../research/audiobook-studio-benchmark.md#3-what-the-ideal-looks-like-concept-mocks), **not yet owner-approved as a build spec** — kept under `mockups/prep-depth/` marked **concept** until the owner approves it on [#510](https://github.com/countrymanprime/narration-utils/issues/510), per the agent-train wave-0 rule. Names and numbers are placeholders.

![Prep: speaker-attributed script, markup, pronunciation list with sources and author queries](mockups/prep-depth/02-prep-script-concept.webp)

*Prep: script, speakers and pronunciations (concept)* (`02-prep-script-concept.webp`) — the speaker-attributed dialogue, the stress/pause/character-tag markup layer, and the pronunciation list with source, status and one-click lookups this PRD's Phases 1 to 5 build toward. A Mockup check table will be added once the owner approves it and building against it begins.
