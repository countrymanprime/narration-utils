package preview

import "testing"

func fullyMetEvidence(paragraphIDs []string) ChapterAudioEvidence {
	times := make(map[string]ParagraphMapping, len(paragraphIDs))
	for i, id := range paragraphIDs {
		times[id] = ParagraphMapping{Mapped: true, Range: ParagraphTimeRange{Start: float64(i) * 5, Length: 5}}
	}
	return ChapterAudioEvidence{
		Coverage:       AudioSignal{State: AudioMet, Reason: "recording coverage is current and complete"},
		ParagraphTimes: times,
		Pace:           AudioSignal{State: AudioMet, Reason: "0.42s per word, matches the fixed estimate within tolerance"},
	}
}

// TestEvaluateAudioCheckedIsMetOnlyWhenEverySignalIsMet is the Success Metrics matrix's positive case: every
// required signal met, no windowed finding in range, gives the audio-checked label.
func TestEvaluateAudioCheckedIsMetOnlyWhenEverySignalIsMet(t *testing.T) {
	ids := []string{"p1", "p2", "p3"}
	got := evaluateAudioChecked(fullyMetEvidence(ids), ids)
	if !got.AudioChecked {
		t.Fatalf("got = %+v, want AudioChecked", got)
	}
	if len(got.Reasons) == 0 {
		t.Fatal("an audio-checked candidate must say what was checked")
	}
}

// TestEvaluateAudioCheckedIsNeverMetWithCoverageNotCurrent covers the "stale, partial, failed or unavailable"
// half of the Success Metric directly: an otherwise-perfect chapter is never audio-checked when RC's own
// coverage/currency signal (which also stands in for EL-6's mapping/fingerprint currency) is not met.
func TestEvaluateAudioCheckedIsNeverMetWithCoverageNotCurrent(t *testing.T) {
	ids := []string{"p1"}
	for _, state := range []AudioSignalState{AudioNotMet, AudioUnknown} {
		evidence := fullyMetEvidence(ids)
		evidence.Coverage = AudioSignal{State: state, Reason: "some reason"}
		got := evaluateAudioChecked(evidence, ids)
		if got.AudioChecked {
			t.Fatalf("coverage state %q must never be audio-checked: %+v", state, got)
		}
		if len(got.Warnings) == 0 {
			t.Fatalf("coverage state %q must warn text only, not silently pass: %+v", state, got)
		}
	}
}

func TestEvaluateAudioCheckedIsNeverMetWithAnUnmappedParagraphInRange(t *testing.T) {
	ids := []string{"p1", "p2"}
	evidence := fullyMetEvidence(ids)
	delete(evidence.ParagraphTimes, "p2") // absent = unmapped, same as never having been stamped
	got := evaluateAudioChecked(evidence, ids)
	if got.AudioChecked {
		t.Fatalf("an unmapped paragraph inside the window must block the label: %+v", got)
	}
}

func TestEvaluateAudioCheckedIsNeverMetWithAStaleMapping(t *testing.T) {
	ids := []string{"p1"}
	evidence := fullyMetEvidence(ids)
	evidence.ParagraphTimes["p1"] = ParagraphMapping{Reason: ReasonParagraphStale}
	got := evaluateAudioChecked(evidence, ids)
	if got.AudioChecked {
		t.Fatalf("a stale mapping must block the label: %+v", got)
	}
}

func TestEvaluateAudioCheckedIsNeverMetWithAnAmbiguousMapping(t *testing.T) {
	ids := []string{"p1"}
	evidence := fullyMetEvidence(ids)
	evidence.ParagraphTimes["p1"] = ParagraphMapping{Reason: ReasonParagraphAmbiguous}
	got := evaluateAudioChecked(evidence, ids)
	if got.AudioChecked {
		t.Fatalf("an ambiguous mapping must block the label: %+v", got)
	}
}

// TestEvaluateAudioCheckedIsNeverMetWithAnOpenWindowedFindingInRange is Phase 7's own DX-4 gate (ADR 0327: not
// reachable with real data today, but the composition is proven correct against a constructed finding so it
// works the moment that gap closes).
func TestEvaluateAudioCheckedIsNeverMetWithAnOpenWindowedFindingInRange(t *testing.T) {
	ids := []string{"p1", "p2"}
	evidence := fullyMetEvidence(ids)
	evidence.WindowedFindings = []ParagraphFinding{{ParagraphID: "p1", Category: FindingAudioQuality, Severity: FindingWarning, Reason: "clipping"}}
	got := evaluateAudioChecked(evidence, ids)
	if got.AudioChecked {
		t.Fatalf("an open windowed finding in range must block the label: %+v", got)
	}
	found := false
	for _, w := range got.Warnings {
		if w == "Open audio_quality finding in this range (clipping)." {
			found = true
		}
	}
	if !found {
		t.Fatalf("the finding must be listed as evidence: %+v", got.Warnings)
	}
}

// TestEvaluateAudioCheckedIgnoresAWindowedFindingOutsideTheRange is the counterpart: a finding anchored to a
// paragraph elsewhere in the chapter, not in this candidate's own window, must not block or warn this candidate.
func TestEvaluateAudioCheckedIgnoresAWindowedFindingOutsideTheRange(t *testing.T) {
	ids := []string{"p1"}
	evidence := fullyMetEvidence(append(append([]string{}, ids...), "p2"))
	evidence.WindowedFindings = []ParagraphFinding{{ParagraphID: "p2", Category: FindingAudioQuality, Severity: FindingWarning}}
	got := evaluateAudioChecked(evidence, ids)
	if !got.AudioChecked {
		t.Fatalf("a finding outside this window must not block it: %+v", got)
	}
}

func TestEvaluateAudioCheckedShowsPaceEvidenceRegardlessOfTheLabel(t *testing.T) {
	ids := []string{"p1"}
	met := fullyMetEvidence(ids)
	met.Coverage = AudioSignal{State: AudioNotMet, Reason: "not measured yet"}
	met.Pace = AudioSignal{State: AudioMet, Reason: "0.4s/word"}
	got := evaluateAudioChecked(met, ids)
	found := false
	for _, r := range got.Reasons {
		if r == "Pace: 0.4s/word" {
			found = true
		}
	}
	if !found {
		t.Fatalf("pace evidence must show even when the chapter is not audio-checked: %+v", got)
	}
}

func TestEvaluateAudioCheckedOmitsPaceWhenNoneWasSupplied(t *testing.T) {
	ids := []string{"p1"}
	evidence := fullyMetEvidence(ids)
	evidence.Pace = AudioSignal{} // the caller never supplied pace evidence at all
	got := evaluateAudioChecked(evidence, ids)
	for _, list := range [][]string{got.Reasons, got.Warnings} {
		for _, text := range list {
			if text == "Pace: " {
				t.Fatalf("no pace evidence must mean nothing said, not an empty 'Pace: ' line: %+v / %+v", got.Reasons, got.Warnings)
			}
		}
	}
}

// TestSuggestWiresAudioEvidenceThroughToTheCandidate is the end-to-end check that Input.AudioEvidence actually
// reaches the engine's own candidate, keyed by chapter id, through attachAudioChecked.
func TestSuggestWiresAudioEvidenceThroughToTheCandidate(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	var ids []string
	for _, p := range paragraphs {
		ids = append(ids, p.ID)
	}
	audio := map[string]ChapterAudioEvidence{"c1": fullyMetEvidence(ids)}
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, AudioEvidence: audio, Settings: DefaultSettings()})
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	if !got.Candidates[0].audioChecked {
		t.Fatalf("candidate = %+v, want audioChecked true (every one of its paragraphs is in the fully-met evidence)", got.Candidates[0])
	}
}

// TestSuggestWithNoAudioEvidenceAtAllIsNeverAudioChecked confirms the zero-value default (a caller that has not
// wired any audio evidence yet) never accidentally reads as met.
func TestSuggestWithNoAudioEvidenceAtAllIsNeverAudioChecked(t *testing.T) {
	chapters, paragraphs := manyParagraphManuscript()
	got := Suggest(Input{Chapters: chapters, Paragraphs: paragraphs, Settings: DefaultSettings()})
	if len(got.Candidates) != 1 || got.Candidates[0].audioChecked {
		t.Fatalf("candidates = %+v, want exactly one, never audioChecked with no evidence supplied", got.Candidates)
	}
}
