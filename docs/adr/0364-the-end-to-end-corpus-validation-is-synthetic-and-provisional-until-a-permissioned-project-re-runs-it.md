# 0364. The end-to-end stage-recommendation corpus validation is synthetic, and provisional until a permissioned project re-runs it

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:**

## Context

The chapter stage recommendations PRD (`docs/prds/chapter-stage-recommendations.prd.md`, delivered and deleted;
[ADR 0160](0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md),
[ADR 0161](0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md))
rests on one guarantee above every other: a chapter the narrator would call "not done" must never read
`recommended`. Its Success Metrics ask for that to be proven end to end, on the recording, editing and proofing
corpora, against a narrator's own stage labels (D12). `apps/desktop/internal/coverage/corpus_test.go` already does
this for the recording rule, against a small synthetic corpus of public-domain text (three chapters of *Alice's
Adventures in Wonderland*, 1865) with hand-labeled paragraph completeness (ADR 0125).

Neither the editing nor the proofing rule has an equivalent real corpus. `editing-readiness-analysis.prd.md`'s own
Phase 1 (the annotated corpus and evaluation harness) is `pending`: it explicitly needs permissioned audio nobody
has yet (its Q10), and synthetic audio is only good enough for its own unit tests, not a validation. Its Q5/D22
default also means the click and breath signals can never report `met` in this build - they are gated behind
Phase 4's own corpus-based detector validation, which has not happened. `proofing-readiness-signals.prd.md` is in
the same position for its pickup and delivery-check corpus. Closing this PRD with no end-to-end proof at all for
two of its three rules would leave the false-"met" guarantee checked in principle (the engine's own table tests)
but never exercised through the real providers, the real findings store and the real stages service together.

## Decision

**Two new Go test files stand in for the missing corpora, and are explicitly provisional.**
`apps/desktop/internal/editing/corpus_test.go` (`TestStageRecommendationsOverTheEditingCorpus`) and
`apps/desktop/internal/proofing/corpus_test.go` (`TestStageRecommendationsOverTheProofingCorpus`) each drive the
real `stages.Service` over the real editing/proofing `SignalProvider` (for editing, over a real `Service` too - a
real scan job, cache, ledger and findings store), with a small labeled corpus of Go-built scenarios. Only the
underlying evidence sources are faked (a scan job's own findings, a synthetic click/breath finding standing in for
a detector that does not exist in this build, a fake Transcript Compare run judge, a stored render measurement) -
never the engine, the provider, or the service, matching the recording corpus test's own architecture. Documented
in `docs/research/editing-and-proofing-corpus.md`.

Both tests assert the one invariant that matters: every case labeled anything but "done" must never read
`recommended`, and log a `N/N cases agreed ..., 0 false recommended` summary rather than a bare pass/fail. The
editing corpus also documents, rather than works around, a real fact about the shipped build: under SR's
production default required set, editing can never read `recommended` at all, because clicks and breaths are
unvalidated; one case reaches `recommended` only by using the documented settings path (a narrator deselecting
those two checks), exactly as editing-readiness-analysis.prd.md Phase 6/Q5 recommends.

**This result is provisional, not calibrated (D70/D71).** A synthetic corpus proves the invariant holds in
principle; it says nothing about narration audio a real editing or proofing detector will actually see. A QA item
on issue [#510](https://github.com/countrymanprime/narration-utils/issues/510) asks for the same two test files'
cases to be re-run, and superseded, against the owner's own permissioned project once editing-readiness-analysis
Phase 1 or proofing-readiness-signals lands a real annotated corpus.

## Consequences

- **The false-"met" guarantee has *some* end-to-end proof for every one of the three stage-advance rules today**,
  not just the recording one - closing this PRD with the editing and proofing rules completely unexercised
  end to end would have been a weaker close-out than D12 calls for.
- **Nothing here is a new corpus format.** Unlike the recording corpus (`recording-coverage-fixtures.md`), there is
  no permissioned-directory environment variable and nothing to extend: a real ER or PS corpus will need its own
  labeling shape (time ranges over audio, not a Go-level signal input), so these two test files are meant to be
  *replaced*, not grown, once a real corpus exists.
- **A reviewer must not read "4/4 cases agreed" as a calibrated result.** `docs/research/editing-and-proofing-corpus.md`
  and this ADR both say so explicitly, and the QA item on #510 is the actual next step, not a nice-to-have.
- **Changing this decision.** Once editing-readiness-analysis Phase 1 or proofing-readiness-signals ships a real
  corpus, write a new ADR in lane U's block (0360-0379) that supersedes this one, replace the two test files' cases
  (keeping their real-service architecture), and close out the #510 QA item.
