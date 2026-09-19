[Using the app](README.md) › Proofing

# Proofing

Proofing transcribes a recorded chapter and compares it against the [manuscript](manuscript.md). The Setup
step picks the transcription model, chunk length, and any vocabulary hints before starting
a comparison.

![Proofing setup panel before starting a comparison](../../images/ui/proofing-setup.webp)

Model, chunk length, and worker count are independent selections — picking a slower, more
accurate model can force other settings to adjust (here, workers dropped to 1 because the
Large model doesn't support Auto).

![Proofing setup panel with a different model, chunk length, and worker count selected](../../images/ui/proofing-setup-alt.webp)

Vocabulary hints teach the transcription model unusual names it's likely to mis-hear.
"Suggest from manuscript" proposes candidates from the [Story Bible](story-bible.md); accepted hints render as
solid pills, suggested-but-not-yet-accepted candidates as dashed outlines you click to accept.

![Proofing - vocabulary hint chips: an accepted term alongside suggested (pending) candidates](../../images/ui/proofing-hint-chips.webp)

Once a comparison finishes, the Results step lists every discrepancy between what was written
and what was heard, expandable for the full context around each one. Each row is typed —
a misread word, a skipped one, or words heard that weren't written at all (EXTRA).

![Proofing results table with a discrepancy row expanded](../../images/ui/proofing-results.webp)

![Proofing - an EXTRA (words heard but not written) discrepancy row expanded](../../images/ui/proofing-results-extra.webp)

---

[← Manuscript](manuscript.md) · [Index](README.md) · [Story Bible →](story-bible.md)
