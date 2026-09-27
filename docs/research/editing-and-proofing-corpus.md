# Editing and proofing: a synthetic signal-level corpus, provisional

**Status: PROVISIONAL, 2026-09-27.** Phase 9 of the stage recommendations PRD
("Secondary surfaces and close-out") asks for end-to-end validation of the
SR verdict on the ER (editing) and PS (proofing) corpora against a
narrator's own stage labels (D12). Neither corpus exists yet: both PRDs say
their real, annotated corpora need permissioned audio nobody has (ER Phase 1
is "pending"; PS's Phase 1 is the same shape). Per D70/D71 (see the PRD's
own Decisions Log), the corpora and tests this note documents are a
synthetic, signal-level STAND-IN, not the real ER/PS corpora - they exist so
the false-"done" invariant has *some* end-to-end proof today, and they are
superseded, not extended, once a real permissioned corpus lands.

## What is here

| Path | What |
| --- | --- |
| `apps/desktop/internal/editing/corpus_test.go` | `TestStageRecommendationsOverTheEditingCorpus`: 4 labeled cases over the REAL `stages.Service` and the REAL editing `SignalProvider`/`Service` (a real scan job, cache, ledger and findings store) |
| `apps/desktop/internal/proofing/corpus_test.go` | `TestStageRecommendationsOverTheProofingCorpus`: 4 labeled cases over the REAL `stages.Service` and the REAL proofing `SignalProvider` |

Unlike the recording corpus (`recording-coverage-fixtures.md`), there are no
new JSON fixture files: each case is a small Go closure that builds its own
evidence directly (a scan job's own findings, a fake Transcript Compare run
judge, a stored render measurement) - the same fakes-only-the-evidence-source
pattern `apps/desktop/internal/coverage/corpus_test.go` uses for its own
sidecar. Nothing here is a new corpus *format*: there is no permissioned
directory variable and nothing to extend later, because a real ER/PS corpus
will need its own labeling shape (time-range labels over audio, not a signal
input), not this one.

## Editing corpus: what each case proves

1. **`clean-scan-clicks-and-breaths-deselected`** - recommended. Every item
   is current at a 10 s maximum gap and no empty-space candidate is open. A
   narrator who has turned off the click and breath required checks in SR
   settings (the documented path in editing-readiness-analysis.prd.md Phase
   6/Q5, not a workaround invented for this test) gets a recommendation from
   empty-space alone.
2. **`clean-scan-default-required-set`** - unknown, not recommended. The
   same clean chapter, but under SR's production DEFAULT required set
   (every declared signal required, unchanged). This documents a real,
   important fact about the shipped build: click and breath signals can
   NEVER read `met` until Phase 4 validates their detectors on a real corpus
   (Q5/D22), so **"recommended" is unreachable for editing today** unless a
   narrator has made that required-check choice. This is not a bug the test
   works around - it is the intended, documented behavior of an unvalidated
   detector.
3. **`open-candidate-in-every-class`** - not_ready. A real scan finds an
   open empty-space candidate (a 3 s gap crosses a 1 s maximum), plus a
   synthetic click and breath finding written directly to the findings
   store (standing in for a detector that does not exist in this build yet;
   `composeAndPersist` only ever persists "silence" findings today). The
   synthetic click/breath findings only add evidence; they never change the
   click/breath signal's state (always unknown, by design).
4. **`never-analyzed`** - unknown. A chapter whose editing has never been
   checked at all.

## Proofing corpus: what each case proves

1. **`clean-pickups-no-delivery-check-required`** - recommended. A current
   Transcript Compare run with nothing open, and an empty delivery profile
   (no measured file rule turned on, no render length tolerance set), so
   `FilterRequired` (proofing-readiness-signals.prd.md's Q7 B - the same
   mechanism `apps/desktop/bindings_stages.go` wires in production) narrows
   the required set to pickups alone.
2. **`open-pickup-blocks`** - not_ready. One transcript-discrepancy finding
   is still open and unreviewed.
3. **`delivery-check-fails-even-with-clean-pickups`** - not_ready. Pickups
   are clean, but a chosen render's measured RMS (-30 dBFS) is outside the
   delivery profile's required -23 to -18 dBFS window, proving a failed
   required delivery check blocks finalizing on its own.
4. **`required-delivery-check-unavailable`** - unknown. Pickups are clean,
   but the profile requires an RMS check and no rendered file has been
   chosen or measured yet.

## The one invariant that matters

Both tests assert, for every case labeled anything but "done" (`not_ready`
or `unknown`), that the verdict is never `recommended`, and fail loudly with
a false-recommended count otherwise. Both packages print a
`t.Logf` summary (`N/N cases agreed ..., 0 false recommended`) so a reviewer
sees the guarantee, not just a pass/fail.

## Superseding this note

Once ER Phase 1 or PS Phase 1 lands a real, permissioned, annotated corpus,
these two Go test files are the ones to replace (their cases, not their
architecture: the REAL `stages.Service` over the REAL provider stays the
right shape, per `recording-coverage-fixtures.md`'s own precedent). This
note should then be folded into whatever research note documents that real
corpus, or deleted if it no longer describes anything shipped.
