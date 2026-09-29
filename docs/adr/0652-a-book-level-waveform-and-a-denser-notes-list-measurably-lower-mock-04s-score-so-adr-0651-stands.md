# 0652. A book-level waveform and a denser notes list measurably lower mock 04's score, so ADR 0651 stands

**Status:** Rejected (owner, 2026-09-29): Proof's waveform always belongs to the chapter being viewed and follows a chapter selector. Each chapter is its own track, so notes never span chapters and there is no book-level waveform to withhold; the chapter's waveform is built, and the selector changes it. Was: Proposed (stream X-896 on [#509](https://github.com/countrymanprime/narration-utils/issues/509), replacing the archived F-P12 worker; register comment [18:35](https://github.com/countrymanprime/narration-utils/issues/509#issuecomment-5876171337))
**Date:** 2026-09-28
**Supersedes:** none. It confirms [ADR 0651](0651-proofs-book-level-draws-no-waveform-header-because-its-notes-span-more-than-one-chapter.md) with measurement rather than architectural reasoning alone.

## Context

PR #896 landed at 89.68% against `stage-navigation-and-page-replacement/04-proof-pickups-concept.webp`, 0.32 points under the D91 bar. ADR 0651 named the missing waveform card as the largest remaining piece and filed the gap on #510 for the owner's sign-off. This stream's task was to close that gap: build the waveform region with a placeholder (since the book level has no single chapter's audio to draw, per ADR 0651) and give the notes list mock 04's own row count and resolution counts (6 need pickup, 5 fix in edit, 3 waived - 14 total), composing from primitives.

Both were built and measured, several times over, before this ADR concluded neither raises the score:

## What was tried, and measured

All runs are `pnpm --dir apps/ui mock-match -g "04-proof-pickups-concept"`, same branch, same viewport (1440×900), same mock.

| # | Configuration | Match % | Ink match % |
| --- | --- | --- | --- |
| 0 | Baseline (PR #896, unchanged): 4 findings, no waveform, nothing selected | **89.68** | 19.21 |
| 1 | 14 findings (mock 04's own counts), no waveform | 87.27 | 20.68 |
| 2 | 14 findings + a placeholder waveform (`TimelineLane` pins, a synthetic bar rhythm, `--waveform` token, sized to a guessed height) | 86.62 | 19.94 |
| 3 | Same as 2, waveform card measured and sized to the mock's own 760×109 card (D91 pixel measurement) | 86.14 | 20.26 |
| 4 | Same as 3, plus opening a finding (mock 04's right panel shows a note's detail, not "Select a note…") | 85.10 | 20.56 |
| 5 | 4 findings (unchanged) + the sized placeholder waveform | 89.15 | 18.91 |
| 6 | 14 findings + a placeholder waveform whose bar heights are sampled from the mock's own pixels (`sharp`, every 6 px across its waveform card) rather than synthetic, so the bar rhythm is the mock's, not invented | 84.93 | 20.52 |

Configuration 5, the smallest change (waveform only, findings untouched), came closest to the baseline and still landed 0.53 points under it. Every configuration that touched the findings list scored lower than the baseline; every configuration that added the waveform scored lower than its own findings-only counterpart. Extracting the mock's actual bar silhouette (6) - removing any question of the placeholder's own rhythm being a bad guess - did not change the direction.

## Why: mock 04 draws a chapter, not the book level

Reading `stage-navigation-and-page-replacement/04-proof-pickups-concept.webp` again: its title is "Proof · Ch 5 · Advice from a Caterpillar", its waveform is one chapter's recording, its "Notes · 14" counts that chapter's notes, and its right panel shows one note's detail plus a "Pickup session" card that assumes a single chapter's pickups. Every one of the mock's most visually dominant regions - the waveform, the page title, the right column - is chapter-scoped. `mocks.ts` targets it at `proof/default`, the book level (ADR 0651's context section already noted this), because book-level Proof is the page the benchmark set's seven mocks map their nav items to, one mock per top-level page.

That mapping means the mock's own drawn content and its scored target diverge by design, not by an omission this phase can compose its way out of: a book-level page's waveform and right panel can only ever approximate a chapter-scoped drawing, and the measurements above show that approximating it (a placeholder band the width of the mock's real one, a denser list matching its counts, a note open in the right column) moves the page's ink pixels into a shape that overlaps the mock's specific chapter-scoped ink less well than the sparser, unscored regions of the original did. Diagram: the highest-mismatch bands of the baseline's own diff (`screenshots/mock-match/stage-navigation-and-page-replacement__04-proof-pickups-concept.diff.png`, in one earlier run) are the page header (owned by lane U's nav/header phase, not this one) and the waveform band - both dense, large-area, fully-coloured regions where any mismatch costs many pixels at once. A four-row table's worth of extra blank space below the fold, by contrast, costs comparatively few.

## Decision

**Composing the waveform placeholder and the denser findings list is not adopted.** ADR 0651's decision - no waveform header at the book level - stands, and PR #896's findings list keeps its original, small demonstration set (`WIRE_FINDINGS`, 4 items) rather than a mock-04-shaped one built only for this capture. `proof/default` stays at 89.68%. This is filed on #510 with this ADR's measurement table: the remaining gap is not a composition this phase left undone, but the benchmark mock's own chapter-level content scored against a book-level page.

## Consequences

- No new component ships from this stream: the placeholder waveform strip and the denser fixture, both built and measured above, are not merged (their code lived only in this stream's working tree).
- `docs/prds/mock-fidelity-primitives-and-components.prd.md`'s Phase 12 row keeps its filed reason; its "the waveform card" wording is corrected by this ADR to "attempted and measured, not merely undone."
- If a future phase gives the book level a real "current chapter" concept (ADR 0651's own escape hatch) or the coordinator/owner decides mock 04 should score against the chapter view (`proof-chapter/*`) instead of `proof/default`, that phase re-opens this question with a different mock-to-state mapping, not more book-level composition.
- The `--waveform` token stays reserved and unused at the book level, as ADR 0651 left it; `WaveformStrip.tsx` (the chapter view's real-peaks strip) is unaffected.
