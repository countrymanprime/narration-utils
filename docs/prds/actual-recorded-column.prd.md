# Actual Recorded: Show Only Measured Recorded Time

**Source:** owner report of 2026-09-24 on the Actual recorded column of Home's per-chapter breakdown (columns Chapter, Words, Est. finished length, Actual recorded, Status, Check). Every row read "–" with a small "estimated from status" caption. The owner: "I don't like the 'estimated from status' here." "Before the status is selected, it shows the message with just a dash. Not helpful. Empty can still be a dash, but we should not put an 'estimated' value in the 'actual recorded' column. That is dumb." "After choosing 'Recording', it fills in half of the estimated finished length? Why? Before editing, it is likely longer than the actual finished length anyway, so this mock data is inaccurate even as a placeholder." Citations are `file:line` at `accb3bc` (code unchanged since `7a20a9e`, which the sibling PRDs cite). Supersedes the "recorded column names its source" clause of [ADR 0130](../adr/0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md) and decision Q12 of the delivered recording coverage work ([recording-coverage.md](../utilities/recording-coverage.md)); takes over the Home half of Phase 8 of [Diagnostics, Delivery Reports and Cleanup Tools](diagnostics-delivery-and-cleanup-tools.prd.md) if the owner agrees (AR7). Related: [Home Stage Check Line](home-stage-check-line.prd.md) and [Credits in the Chapter Table](credits-in-chapter-table.prd.md) (same table), and three sibling PRDs drafted the same day (DAW chapter-track auto-sync, a per-row track-link button, a recording-check summary).

**Status (2026-09-24):** draft; open questions AR1 to AR8 wait for the owner. No tracking issue yet: open one (`docs/operations/github-workflow.md`) before Phase 1.

## Problem Statement

The column headed **Actual recorded** never shows an actual recorded time. With no current recording check it multiplies the chapter's *estimated* finished length by a fixed share taken from the status the narrator picked (0 for Not started, one half for Recording, all of it from Editing on), and labels the result "estimated from status". So a Not started row reads "–" plus a caption explaining a guess that produced nothing, and a Recording row claims half the estimate was recorded whatever is on the track. Even the "measured" case is not a recorded time: it is the share of the chapter's words a recording check found, times the same word-count estimate. The narrator reads a number under "Actual" that the app invented, which is the opposite of what the column promises, and the headline **Actual recorded** stat above the table adds the same guesses up.

## Evidence

- **Where the guess is.** `RECORDED_FRACTION = { not_started: 0, recording: 0.5, editing: 1, proofing: 1, finalized: 1 }` (`apps/ui/src/components/home/AudiobookEstimatePanel.tsx:37`). Per row, `fraction = chapter.recordedFraction ?? RECORDED_FRACTION[chapter.status]` (`:210-211`); the cell prints `fraction > 0 ? fmtHours(finished * fraction) : '—'` and always a caption, `measured` or `estimated from status` (`:243-247`), where `finished = estimateFinishedHours(chapter.wordCount)` (`:207`), the fixed 9,300 words per finished hour. It is the only use of `RECORDED_FRACTION` in the repository.
- **What the owner saw, reproduced from the code.** Every chapter in Not started: fraction 0, so "—" and "estimated from status" (`:244-246`). Set one to Recording: `onChange` stores the status (`:254-263`), the row re-renders with fraction 0.5, and the cell shows half the estimated finished length. No host call, no REAPER read, no measurement is involved.
- **The headline stat is the same guess, summed.** `recordedHours = Σ estimateFinishedHours(words) × (recordedFraction ?? RECORDED_FRACTION[status])` (`:116`) is shown as the **Actual recorded** stat (`:119`), with no label at all.
- **"Measured" is not a duration either.** `recordedFraction` is "the share of the chapter's words present" from a current, complete recording check (D11, `docs/utilities/recording-coverage.md:123`; `apps/desktop/internal/coverage/read.go:82-107`; `apps/desktop/internal/manuscript/reader.go:428-441`). The cell multiplies it by the word-count estimate, so a chapter read in full at a slow pace and one read fast both show exactly the estimate.
- **Why it was built this way.** The status table predates the repository's visible history (it is already in `cf5e6c6`, the oldest commit). The recording coverage PRD called it out as a guess (`git show 584d5a5^:docs/prds/recording-coverage-analysis.prd.md`, line 26) and so did the stage recommendations PRD, "against the intent of ADR 0015" (`docs/prds/chapter-stage-recommendations.prd.md:24`; [ADR 0015](../adr/0015-real-progress-only.md): progress shows real work only). Q12 of the coverage PRD (same file, line 92) then chose to *keep* the guess as a labelled fallback, for two reasons: dropping it "changes every existing user's headline number", and filling it from a recorded duration divided by the estimated duration "is still a guess"; it deferred recorded seconds to DX-8, the diagnostics PRD's Phase 8. ADR 0130 (`:22`) added the "measured" / "estimated from status" caption so the guess would at least say so, and accepted that the headline could drop when a check goes stale (`:27`). The caption was an honesty patch on a number the owner now says should not be there at all; neither reason survives the report (the owner wants the headline to change, and the fix is to show recorded seconds, not a ratio of them).
- **Real recorded time is already within reach, without transcription.**
  - The narrator-confirmed chapter-to-track link exists: `ChapterTrackMapList`/`Confirm`/`Clear` (`apps/desktop/bindings.go:764-768`), one confirmed track per chapter (`apps/desktop/internal/coverage/manifest.go:174-195`, D5).
  - The saved `.rpp` parser gives each item's `Position`, `Length`, `Muted`, active take, `SOFFS`/`PLAYRATE`, and a fixed-lane track's playing lanes (`apps/desktop/internal/tracks/tracks.go:31-67`, `:135-157`; `lanes.go`, ADR 0147). `Track.RecordedEnd` already walks a track's unmuted items for the teleprompter's resume (`apps/desktop/internal/tracks/recorded.go:37-80`), and `evidence.ItemPlayedRange` gives an item's played range (`apps/desktop/internal/evidence/fingerprint.go:41-48`).
  - A completed check stores `playedSeconds` (the analyzed items' played seconds, `apps/desktop/internal/coverage/report.go:39-44`, sent as `ReportView.PlayedSeconds`, `view.go:61`), but only after a transcription and only in the per-chapter result, not on the chapter list.
  - DX-8 specifies exactly this number and has not started: "Go computes per-chapter recorded seconds from the matched track's items" (`docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md:164`, phase row `:200`, details `:242-246`), with its definition open (Q10, `:97`, recommendation: union of item intervals). Its dependency (the matcher) and the confirmed mapping are both delivered since it was written. [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) Phase 22 plans to reuse it (`:105`, `:331`); [Proofing Preview Suggestion](proofing-preview-suggestion.prd.md) Q2 B wants recorded seconds per chapter for pace (`:69`).
- **Consumers of the estimated value and its caption.**
  - Code: `AudiobookEstimatePanel.tsx:37`, `:116`, `:119`, `:208-211`, `:243-247`; the status change keeps `recordedFraction` on the row (`:260`).
  - Tests: `RecordingCheck.test.tsx:41-51` (asserts both captions, and "estimated from status" for a stale check) and `:103` ("measured" after a check completes). `AudiobookEstimatePanel.test.tsx` does not assert recorded values.
  - Mocks: `apps/ui/src/api/aliceManuscript.ts:82-84` and `apps/ui/src/api/mockFixtures.ts:235` seed `recordedFraction` on chapters 1 to 6 "so both labels can be seen" (ADR 0130); `coverageMock.ts:114-171` drops it for a stale seed; `stagesMock.ts:92`, `:122` derive the stage signal from it (unaffected: the host's stage engine reads `coverage.RecordingSignal`, not this column).
  - Contracts: `recordedFraction` in `apps/ui/src/api/contracts/manuscript.ts:9`, `schemas/manuscript.ts:33`, `schemas/coverage.ts:117`; golden `tests/fixtures/contracts/manuscript-chapters-measured.json` written by `apps/desktop/internal/manuscript/contract_test.go:97-102`; row `wireContracts.test.ts:308-313`.
  - Visual suite: `home/chapter-table-expanded` (`apps/ui/tests/visual/state-catalog.ts:51`, driver `app.drivers.ts:566-568`) and its guide screenshot `home-chapter-table-expanded` (`doc-screenshots.json:94-97`); the `home/recording-check-*` and `home/stage-*` states (`state-catalog.ts:126-214`) render the same table behind their dialogs.
  - Docs: `docs/guides/using-the-app/home.md:20-29` (explains both captions and "half for Recording"); `docs/utilities/recording-coverage.md:65-67` ("Three readers") and `:135` (Q12); `docs/utilities/tracks.md:45` (points recorded duration at DX-8); ADR 0130 `:22`, `:27`; `chapter-stage-recommendations.prd.md:24`, `:87` ("Home honesty" metric); `credits-in-chapter-table.prd.md:98`, `:145` (credits rows would reuse the guess and caption, see the compatibility table).
- **When the column is read.** The chapter list is fetched on mount, after an import (`refreshKey`) and after a completed check (`measuredRun`) only (`AudiobookEstimatePanel.tsx:97-107`); a save in REAPER while Home stays open is not seen until the next of those (Home Stage Check Line, Evidence item 4, and its Q2).

## Proposed Solution

The Actual recorded cell shows one thing: how much audio the chapter's linked REAPER track holds in the saved project, as a time. Nothing else ever fills it. A chapter with no linked track, or whose recorded time cannot be read, shows a plain "—" with no caption. The status select no longer changes the column at all. The headline **Actual recorded** stat sums only those real times (AR1). The recording check's word share leaves this column (AR4): it is a coverage figure, not a duration, and belongs with the check.

The time comes from the host, read from the saved `.rpp` with the chapter's one confirmed track: the union of the played intervals of its unmuted items on playing lanes (AR2, the DX-8 Q10 recommendation). No transcription, no sidecar, no REAPER bridge call.

## Key Hypothesis

We believe that showing only a time read from the chapter's linked track, and a dash otherwise, will make the column trustworthy. We'll know we're right when the owner, setting a chapter to Recording, sees the column unchanged, and after linking the track and saving in REAPER, sees the length of the audio actually on it.

## What We're NOT Building

- Any estimate, placeholder or status-derived value in the Actual recorded cell or the Actual recorded stat, and any caption naming a source.
- Changes to the status select, the progress bar, the legend or "N of M chapters finalized": they are status-driven by design and say so.
- Changes to Est. finished audio, Est. record / edit / proof time or the Credits stat (they are labelled estimates).
- The linking UI itself: a per-row link button and automatic chapter-track sync are sibling PRDs. This PRD reads whatever links exist.
- Re-reading on window focus: that is Q2 of [Home Stage Check Line](home-stage-check-line.prd.md); this PRD benefits from it.
- Chapter regions on a shared track (several chapters on one track): the mapping store keys links by track, so one track holds one chapter (ADR 0130 Consequences); regions are REAPER Automation Phase 7's.
- Reading the live REAPER session: the basis is the saved `.rpp`, as for the recording check (Q6 of recording coverage).

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| No guess | `RECORDED_FRACTION` and the "estimated from status" / "measured" captions are gone from `apps/ui/src` | grep; Vitest |
| Status is inert | Changing a row's status leaves its Actual recorded cell and the stat unchanged | Vitest on `AudiobookEstimatePanel` |
| Dash when unknown | An unlinked chapter, a missing track, several links or no project shows "—" with no caption | Vitest; `home/chapter-table-expanded` PNGs |
| Real seconds | For a linked chapter the cell equals the host's `recordedSeconds`, formatted; the host value is the union of unmuted, playing-lane item intervals of the confirmed track | Go tests on REAPER-saved fixtures (overlap, muted, fixed lanes, multi-take, trimmed, playrate) |
| Stat honesty | The stat sums `recordedSeconds` of linked chapters only, per AR1 | Vitest |
| Contracts | `recordedSeconds` passes a Zod schema, a golden written by a Go test and a `wireContracts.test.ts` row; the mock passes the schema | `pnpm check` |
| Cost | Reading the chapter list with 30 linked chapters adds under 50 ms over today on a large saved project (one `.rpp` parse, shared with the coverage read) | Go benchmark recorded in the PR |
| UI gate | `home/chapter-table-*` states green at every viewport, axe clean, PNGs reviewed | `full-verification-gate` |

## Open Questions

- [ ] **AR1. What does the headline Actual recorded stat show once estimates are gone?** Options: (A) the sum of real recorded times of linked chapters, with "—" when none is linked, and a tooltip "From N of M chapters with a linked track"; (B) remove the stat until every chapter is linked; (C) keep it and show a percentage against Est. finished audio. Recommendation: A. It is the one book-level number the narrator asked for; C compares raw audio to a finished estimate, which the owner's point 3 says is misleading before editing.
- [ ] **AR2. Which length counts as "recorded"?** Options: (A) the chapter's current audio on its track in the saved project: the union of the played intervals of unmuted items on playing lanes, active take only (DX-8 Q10 (a)); it shrinks as the narrator edits, and approaches the finished length; (B) the raw take time: the full length of every source file the items use, including trimmed-off retakes and pauses; (C) both, raw under current. Recommendation: A. It needs only the `.rpp`, matches what the recording check reads (the active take, muted items skipped), and never double-counts a retake on a muted lane. B needs every source file's length (a header read per file) and grows with every outtake. If A, should the header say "Recorded length" rather than "Actual recorded", so no one reads it as "finished"? Recommendation: keep "Actual recorded" and put the definition in the header's tooltip.
- [ ] **AR3. What does an unlinked chapter show?** Options: (A) a plain "—" with an accessible name and tooltip saying why ("No REAPER track linked" / "Linked to two tracks" / "Track not in the saved project"); (B) a plain "—" only, as the owner described; (C) a "Link track" affordance in the cell. Recommendation: A, with no visible caption, so the row stays quiet but a hover or screen reader explains the dash. C belongs to the sibling per-row track-link PRD, which puts its button elsewhere in the row; the two must not both add one.
- [ ] **AR4. Where does the recording check's word share (`recordedFraction`) go?** Options: (A) off this column; the recording-check summary sibling PRD (or the Check button's label, "Checked · 82%") shows it; (B) a secondary muted line in the cell ("82% of text"); (C) only inside the check dialog. Recommendation: A. It answers "is all the text read", a different question from "how much audio is there". `recordedFraction` stays on the chapter payload (the stage mocks and possibly the sibling use it), so no contract is removed.
- [ ] **AR5. The interim value before recorded seconds land.** Phase 1 (UI only) can ship before Phase 2's host field. Options: (A) Phase 1 shows "—" everywhere, including checked chapters, until Phase 3; (B) Phase 1 keeps the check-derived length for a current check, without its caption; (C) do not ship Phase 1 alone; land Phases 1 to 3 together. Recommendation: A if Phase 2 is more than a few days out (the owner's point is that no invented number belongs there, and B still multiplies by an estimate), otherwise C.
- [ ] **AR6. A chapter linked to more than one track.** Options: (A) "—" with the reason, matching the recording check's `multiple_tracks` refusal; (B) the union across all linked tracks. Recommendation: A for consistency; revisit with the auto-sync sibling PRD if it can create several links.
- [ ] **AR7. Does this PRD take over the Home half of DX-8?** Diagnostics Phase 8 plans measured recorded duration on Home plus a mapping exposed for the Review page and a manual override. The mapping store and its bindings now exist. Options: (A) yes: this PRD delivers `recordedSeconds` and the Home change; the delivering PR narrows diagnostics Phase 8 to the Review page grouping, closes its Q10 with AR2's answer and repoints `docs/utilities/tracks.md:45`; (B) no: this PRD does Phase 1 only and waits for DX-8. Recommendation: A; DX-8's dependency is delivered and the owner is asking now.
- [ ] **AR8. How fresh must the number be?** It is as of the `.rpp`'s last save and the list is re-read only on import and after a check. Options: (A) rely on Home Stage Check Line Q2 (re-read on window focus) and state "as of the saved project" in the header tooltip; (B) also re-read when the project file's modified time changes (a watcher, which parent PRD Q5 rejected). Recommendation: A.

## Users & Context

**Primary user:** the narrator or producer on Home between REAPER sessions, checking how far a book is. **Current behavior:** they pick a status and the column answers with a number derived from that status, so they learn nothing they did not just type. **Trigger:** recording a chapter in REAPER, saving, and coming back to Home. **Success state:** the column shows the length of what is on the chapter's track, and a dash for chapters not linked. **Job to be done:** when I plan the next session, I want to see how much audio each chapter has, so I know what is left without opening REAPER. **Non-users:** narrators who never link tracks; they see dashes, which is true.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Remove `RECORDED_FRACTION`, the status fallback and both captions; the stat stops summing guesses | 1 |
| Must | Host `recordedSeconds` per chapter from the confirmed track in the saved `.rpp` (AR2) | 2 |
| Must | The cell and the stat read `recordedSeconds`; "—" otherwise (AR1, AR3) | 3 |
| Must | Supersede ADR 0130's caption clause and recording coverage Q12 with a new ADR | 3 |
| Should | A reason for the dash (unlinked, several tracks, track missing, no project) in the tooltip and accessible name (AR3) | 2, 3 |
| Should | The header tooltip states the definition and "as of the saved project" (AR2, AR8) | 3 |
| Could | Raw take time beside the current length (AR2 C) | later |
| Won't | Any status-based or word-count-based value in the column; a link button in the cell | - |

**MVP scope:** Phases 1 to 3.

**User flow (AR1 A, AR2 A, AR3 A, AR4 A):** the narrator opens the breakdown. Unlinked chapters read "—"; hovering one says "No REAPER track linked". Setting Chapter 3 to Recording changes nothing in the column. They link Chapter 3's track (Tracks page, the check dialog, or the sibling per-row button), record, save in REAPER and return: Chapter 3 reads "42m", and the Actual recorded stat reads "42m" with "From 1 of 20 chapters with a linked track".

## Technical Approach

**Feasibility:** high. The parser, the mapping store and the per-item played ranges exist; the new code is a small interval union and a provider shaped like `RecordedFractions`.

**Architecture notes**

- **Phase 1 (UI).** In `AudiobookEstimatePanel.tsx`, delete `RECORDED_FRACTION` (`:37`), the fallback and captions (`:208-211`, `:243-247`); per AR5 the cell shows "—" (or the interim value); the stat per AR5 too. Update `RecordingCheck.test.tsx:41-51`, `:103` to assert the cell no longer depends on status or check, and add a status-is-inert case to `AudiobookEstimatePanel.test.tsx`. Drop "so both labels can be seen" from the mock comments (`aliceManuscript.ts:82-84`, `mockFixtures.ts:235`) without changing the seeds (the stage mocks use them). `home.md:20-29` loses the caption paragraph. No contract change.
- **Phase 2 (host and contract).** A `tracks.Track.RecordedSeconds()` (or a function in `internal/tracks/recorded.go` beside `RecordedEnd`): sort the unmuted items on playing lanes (every item on a track not in fixed-lane mode) by position and merge overlapping `[Position, Position+Length)` intervals; return the merged length in project seconds. A provider in `apps/desktop` (next to `coverageRecordedFractions`, `bindings_coverage.go:113-117`) lists confirmed links (`evidence.MappingStore`), parses the saved project once, and returns `map[chapterID]seconds` plus a reason for chapters it cannot answer; `manuscript.Service` gains `SetRecordedSeconds` like `SetRecordedFractions` (`service.go:52-66`) and `chapterPayload` adds `recordedSeconds` (and, if AR3 A, `recordedUnavailable`) only from it (`reader.go:428-441`). `ChaptersUnmeasured` (`reader.go:64-67`) skips it as it skips fractions, so the stage read costs nothing more. Share the one saved-project parse with `RecordedFractions` (it already parses when any check exists) rather than parsing twice. No new binding, so `hostAPIVersion` (47, `apps/desktop/app.go:52`) is not bumped; re-check the rule at merge. Wire contracts per `CLAUDE.md`: `recordedSeconds: z.number().nonnegative().optional()` (and the reason enum) in `apps/ui/src/api/schemas/manuscript.ts` and `contracts/manuscript.ts`; a golden `tests/fixtures/contracts/manuscript-chapters-recorded.json` written by `internal/manuscript/contract_test.go` with `UPDATE_CONTRACTS=1`; a row in `wireContracts.test.ts` beside `:308`; the mock seeds `recordedSeconds` on the linked demo chapters and passes the schema. Keep the status merge at `AudiobookEstimatePanel.tsx:260` carrying the new field.
- **Phase 3 (UI and records).** The cell prints `fmtHours(recordedSeconds / 3600)` (or seconds under a minute, as `fmtCreditsSeconds` does, `:35`), else "—" with the reason as tooltip and accessible name (a `TooltipTarget`, no new primitive); the stat per AR1. Header tooltip per AR2 and AR8. Tests first. Visual: `home/chapter-table-expanded` changes; add `home/chapter-table-recorded-unlinked` only if the default demo cannot show both a time and a dash (it can if the mock links some chapters and not others, so prefer no new row). Regenerate `home-chapter-table-expanded` and any Home guide screenshot that shows the table. Docs: `home.md`, `recording-coverage.md:65-67` (the Home reader no longer uses `recordedFraction`) and a note under `:135` that Q12 is superseded, `tracks.md:45`. ADR: a new ADR (next free number at merge; 0171 at the time of writing, and sibling PRDs may claim numbers first) "Home's actual recorded is the linked track's recorded length from the saved project and never an estimate", superseding the caption clause of ADR 0130 and coverage Q12; cite ADR 0015. ADR 0130 is still Proposed: the owner may prefer to amend it before accepting (Decisions Log).

**Technical risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Most narrators have no links yet, so the column is all dashes and looks broken | High | AR3 tooltip reason; the sibling link-button and auto-sync PRDs; the guide says how to link |
| The headline stat drops for every existing user (the reason Q12 kept the guess) | Certain | Intended by the owner's report; the tooltip says how many chapters it covers (AR1) |
| Retakes stacked in free item positioning overlap and double-count | Medium | Interval union (AR2 A); fixture with overlapping items |
| Items on a non-playing fixed lane counted | Medium | Filter with `Track.LanePlays`; fixture from the S7 spike (`tracks/testdata/reaper`) |
| The number goes stale when the narrator saves in REAPER with Home open | Medium | AR8 A, Home Stage Check Line Q2 |
| An extra `.rpp` parse per chapter-list read on a large project | Low | One shared parse with the coverage fractions; benchmark in the metrics |
| Credits rows (sibling, committed PRD) reintroduce "estimated from status" | High if unsequenced | Compatibility table; credits Phase 2 shows "—" until its Phase 3 |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Remove the status estimate | Drop `RECORDED_FRACTION`, the fallback and both captions; status is inert; the stat stops summing guesses (AR5); tests, mock comments, `home.md` | pending | 2 | AR4, AR5 | - |
| 2 | Recorded seconds on the chapter payload | Interval union over the confirmed track's items in the saved `.rpp`; provider and `recordedSeconds` (plus reason) on `ManuscriptChapters`; Zod schema, golden, `wireContracts` row, mock; benchmark | pending | 1 | AR2, AR3, AR6, AR7 | - |
| 3 | The column and stat show recorded time | Cell, dash reason, stat, header tooltip; visual states and screenshots; docs; superseding ADR | pending | - | 1, 2; AR1, AR8 | - |

### Phase Details

**Phase 1 - Remove the status estimate.** Scope as in Technical Approach. Success: metrics rows 1 and 2; `RecordingCheck.test.tsx` and `AudiobookEstimatePanel.test.tsx` green; `home/chapter-table-expanded` and `home/recording-check-*` PNGs reviewed at desktop, small-desktop and tablet. Verification: `pnpm check`; `npx playwright test tests/visual/app.spec.ts -g "home.*chapter-table|home.*recording-check"`.

**Phase 2 - Recorded seconds on the chapter payload.** TDD in `internal/tracks` (union, muted, lanes, overlap, playrate-independent project time, empty track) and `internal/manuscript` (present only from the provider, absent for unlinked, several links and a missing track, with the reason). A host test that `ManuscriptChapters` carries the value for a confirmed link on a REAPER-saved fixture and that `ChaptersUnmeasured` does not. `change-impact-scan`: `manuscript.Service` and `chapterPayload` are read by the reader, Home, the stage engine and the teleprompter picker; only `Chapters` gains the field. Success: metrics rows 4, 6 and 7.

**Phase 3 - The column and stat show recorded time.** Tests first for the cell, the dash reason, the stat and its tooltip. Visual suite and doc screenshots as above; axe clean with no new `axe-debt.ts` entry; no dialog or navigation change, so aria snapshots are unaffected. `feature-cleanup`: ADR, `docs/adr/README.md` row, `home.md`, `recording-coverage.md`, `tracks.md`, and, per AR7 A, a note in the diagnostics PRD's Phase 8 row. Success: metrics rows 3, 5 and 8.

### Parallelism Notes

Phases 1 and 2 touch different layers (UI only; Go and the contract) and can run in parallel sessions; Phase 3 needs both. If AR5 is C, 1 and 3 become one pull request after 2.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/ui/src/components/home/{AudiobookEstimatePanel.tsx,AudiobookEstimatePanel.test.tsx,RecordingCheck.test.tsx}`, comments in `apps/ui/src/api/{aliceManuscript.ts,mockFixtures.ts}`, `docs/guides/using-the-app/home.md` | **High** on `AudiobookEstimatePanel.tsx`: [Home Stage Check Line](home-stage-check-line.prd.md) Phase 1 (`:193`), [Credits in the Chapter Table](credits-in-chapter-table.prd.md) Phase 2 (new rows whose Actual recorded is specified as "the status guess with 'estimated from status'", `credits-in-chapter-table.prd.md:98`, `:145`: that must become "—" if this PRD lands first, or be removed here if credits lands first), and all three sibling PRDs (per-row track-link button, recording-check summary, auto-sync), which add to the same row. **High** on `RecordingCheck.test.tsx` with the recording-check summary sibling. **Medium** on `home.md` (every Home PRD edits it) |
| 2 | `apps/desktop/internal/tracks/recorded.go` and tests, `apps/desktop/internal/manuscript/{service.go,reader.go,contract_test.go}`, `apps/desktop/bindings_coverage.go` or a new `bindings_recorded.go`, `apps/desktop/app.go` (provider wiring, `:377-379`), `apps/ui/src/api/{contracts/manuscript.ts,schemas/manuscript.ts,wireContracts.test.ts,aliceManuscript.ts,mockFixtures.ts}`, `tests/fixtures/contracts/manuscript-chapters-recorded.json` | **Medium**: the auto-sync sibling (writes confirmed links this provider reads; agree that "confirmed" stays the only basis, D5); the per-row link-button sibling (same mapping bindings, read only here); the recording-check summary sibling if it adds fields to the chapter payload (same `chapterPayload` and golden); [Diagnostics](diagnostics-delivery-and-cleanup-tools.prd.md) Phase 8 (same feature, see AR7); [Recording Check Model Cascade](recording-check-model-cascade.prd.md) (`bindings_coverage.go`); REAPER Automation Phase 22 (consumer) |
| 3 | `AudiobookEstimatePanel.tsx` and tests, `apps/ui/tests/visual/{state-catalog.ts,app.drivers.ts}`, `docs/images/ui/home-*.webp`, `docs/guides/using-the-app/home.md`, `docs/utilities/{recording-coverage.md,tracks.md}`, `docs/adr/` | As Phase 1, plus every PRD that re-captures Home screenshots (stage check line, credits, siblings); ADR numbering with the credits PRD and the siblings |

Cross-cutting: each phase follows `CLAUDE.md`: plan with an issue and `Closes #<n>`, `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`, the visual suite for `apps/ui`, PNGs at every viewport), no primitive or `styles.css` change so `design-spec-guard` and the atlas are not triggered, `feature-cleanup`. No REAPER bridge, Lua or sidecar change; the `.rpp` is already read by the host, so the threat model's rows are unaffected (confirm at cleanup).

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| No estimate in the Actual recorded column (owner, 2026-09-24) | Real time or "—" | Keep the labelled guess (coverage Q12 A, ADR 0130) | The owner's report; ADR 0015's "real work only" |
| Source of the time (proposed, AR2) | Union of unmuted playing-lane item intervals on the confirmed track, saved `.rpp` | Raw source lengths; the check's `playedSeconds`; recorded ÷ estimated ratio | Needs no transcription; matches what the check reads; a ratio is still a guess (coverage Q12 C) |
| Word share leaves the column (proposed, AR4) | Shown with the check, not as a duration | Keep "measured" × estimate | It is coverage, not time |
| Supersession | A new ADR supersedes ADR 0130's caption clause and coverage Q12 | Amend ADR 0130 in place while it is still Proposed | ADRs are immutable once accepted; the owner may choose to amend 0130 before accepting it, which saves an ADR |
| Ownership of recorded seconds (proposed, AR7) | This PRD, narrowing diagnostics Phase 8 | Wait for DX-8 | Its dependency is delivered and the owner asked now |

## Research Summary

- Read: `AudiobookEstimatePanel.tsx` and its test, `RecordingCheck.test.tsx`, `aliceManuscript.ts`, `mockFixtures.ts`, `coverageMock.ts`, `stagesMock.ts`, the manuscript and coverage contracts, schemas and `wireContracts.test.ts`; `internal/manuscript/{service.go,reader.go,contract_test.go}`, `internal/coverage/{read.go,view.go,report.go,manifest.go}`, `internal/tracks/{tracks.go,recorded.go,lanes.go}`, `internal/evidence/fingerprint.go`, `bindings.go`, `bindings_coverage.go`; ADRs 0015 and 0130; `home.md`, `recording-coverage.md`, `tracks.md`; the deleted recording coverage PRD (`git show 584d5a5^:docs/prds/recording-coverage-analysis.prd.md`); the diagnostics, stage recommendations, REAPER automation and proofing preview PRDs; the two committed sibling PRDs.
- Not done: the app was not run against the owner's project, so the "all dashes" state is inferred from the code (every chapter Not started and no current check). Not verified: how long one saved-project parse takes on a long book with many takes (the benchmark in Phase 2 answers it), and whether narrators expect raw or current length (AR2).

---

*Generated: 2026-09-24*
*Status: DRAFT - open questions AR1 to AR8 wait for the owner*
