package preview

// This file is Phase 7 of the proofing-preview-suggestion PRD
// (docs/prds/proofing-preview-suggestion.prd.md#phase-7---audio-quality-and-performance-signals): saying which
// candidates are "audio-checked" and what was checked, composing RC's coverage/currency signal, Phase 6's
// paragraph mapping, DX-4's windowed findings and pace evidence the same tri-state way SR's own stages package
// composes signals (met/not_met/unknown; unknown never counts as good - SR D2, ADR 0015). A DX-4 windowed
// finding cannot be read from a real chapter today: see ADR 0327 (docs/adr/0327-...). WindowedFindings below is
// wired and tested regardless, so the composition is already correct once that gap closes.

// AudioSignalState mirrors stages.SignalState's tri-state (met/not_met/unknown - SR D2) without importing that
// package, the same "small read-only interfaces" decoupling Phase 5's OpenFinding already uses for the RD-1
// store.
type AudioSignalState string

const (
	AudioMet     AudioSignalState = "met"
	AudioNotMet  AudioSignalState = "not_met"
	AudioUnknown AudioSignalState = "unknown"
)

// AudioSignal is one named check's answer for one chapter: Reason is always set, so "unknown" is never bare.
type AudioSignal struct {
	State  AudioSignalState
	Reason string
}

// ParagraphFinding is one DX-4 windowed audio-quality finding, already resolved by the caller to a paragraph (or
// left chapter-level when it could not be, the same "" convention Phase 5's OpenFinding uses) - see ADR 0327 for
// why no real chapter has one of these to give today.
type ParagraphFinding struct {
	ParagraphID string
	Category    FindingCategory
	Severity    FindingSeverity
	Reason      string
}

// ChapterAudioEvidence is everything Phase 7 needs about one chapter's audio, already resolved to plain values
// by the caller (a host binding composing RC's coverage.Service, Phase 6's MapParagraphsToTime and, once ADR
// 0327 is resolved, DX-4's own findings) - Architecture Notes: "each provider answers met/not_met/unknown with a
// reason and action; the engine composes them".
type ChapterAudioEvidence struct {
	// Coverage is RC's own signal for this chapter: met only when the mapped track's recording check is current
	// and complete (coverage.Report.TextComplete). RC's own read already applies EL-6's staleness rule for its
	// analyzer scope, so this one signal stands in for both "recorded" and "mapping current" (Architecture
	// Notes' "confirmed track-to-chapter map" and "fingerprint" requirements) without a second EL-6 call.
	Coverage AudioSignal
	// ParagraphTimes is Phase 6's own answer, keyed by paragraph id (MapParagraphsToTime's own return shape) -
	// mapped only where a stamped item names that paragraph at the manuscript's current source hash.
	ParagraphTimes map[string]ParagraphMapping
	// WindowedFindings are DX-4's own findings for this chapter, already resolved to a paragraph where possible
	// (ADR 0327: none, in practice, until that gap closes).
	WindowedFindings []ParagraphFinding
	// Pace is Q8 option C's own fallback evidence (ChapterPace), shown whenever available regardless of the
	// audio-checked label - pace evidence, never a per-window audio-quality claim (PRD Q8).
	Pace AudioSignal
}

// AudioCheckResult is Phase 7's own answer for one candidate.
type AudioCheckResult struct {
	// AudioChecked is true only when Coverage is met AND every paragraph in the candidate's window is Mapped AND
	// no WindowedFinding falls inside it (Success Metrics: "0 candidates labelled audio-checked while a needed
	// signal is stale, unmapped, partial, failed or unavailable" - not_met and unknown both fail the label).
	AudioChecked bool
	// Reasons is the positive evidence to show when AudioChecked (what was checked); Warnings is why it is not,
	// or the pace evidence that applies either way - the same Candidate.Reasons/Warnings convention Phase 1 and
	// Phase 5 already use, so this phase needs no new wire field either.
	Reasons  []string
	Warnings []string
}

// evaluateAudioChecked applies Phase 7's rule to one candidate's paragraph range.
func evaluateAudioChecked(evidence ChapterAudioEvidence, paragraphIDs []string) AudioCheckResult {
	var result AudioCheckResult

	if evidence.Coverage.State != AudioMet {
		result.Warnings = append(result.Warnings, "Text only: "+coverageWarning(evidence.Coverage))
	}

	unmappedCount, staleCount, ambiguousCount := 0, 0, 0
	for _, id := range paragraphIDs {
		mapping, known := evidence.ParagraphTimes[id]
		if !known || !mapping.Mapped {
			switch {
			case known && mapping.Reason == ReasonParagraphStale:
				staleCount++
			case known && mapping.Reason == ReasonParagraphAmbiguous:
				ambiguousCount++
			default:
				unmappedCount++
			}
		}
	}
	if unmappedCount+staleCount+ambiguousCount > 0 {
		result.Warnings = append(result.Warnings, "Text only: "+mappingWarning(unmappedCount, staleCount, ambiguousCount))
	}

	inWindow := make(map[string]bool, len(paragraphIDs))
	for _, id := range paragraphIDs {
		inWindow[id] = true
	}
	var findingsInWindow []ParagraphFinding
	for _, f := range evidence.WindowedFindings {
		if f.ParagraphID != "" && inWindow[f.ParagraphID] {
			findingsInWindow = append(findingsInWindow, f)
		}
	}
	for _, f := range findingsInWindow {
		result.Warnings = append(result.Warnings, "Open "+string(f.Category)+" finding in this range"+reasonSuffix(f.Reason)+".")
	}

	audioChecked := evidence.Coverage.State == AudioMet && unmappedCount+staleCount+ambiguousCount == 0 && len(findingsInWindow) == 0
	if audioChecked {
		result.AudioChecked = true
		result.Reasons = append(result.Reasons, "Audio-checked: recording coverage and audio position are current, with no open audio-quality finding in this range.")
	}

	// A zero-value Pace (the caller never supplied any) is neither AudioMet nor AudioNotMet, so it adds nothing -
	// the same "nothing known, nothing said" rule Phase 5's nil OpenFindings already follows, distinct from
	// Coverage/mapping above, which are always-shown status labels (the PRD's own "otherwise it says text only").
	switch evidence.Pace.State {
	case AudioMet:
		result.Reasons = append(result.Reasons, "Pace: "+evidence.Pace.Reason)
	case AudioNotMet:
		result.Warnings = append(result.Warnings, "Pace: "+evidence.Pace.Reason)
	}

	return result
}

// attachAudioChecked applies Phase 7's rule to candidate and returns the updated candidate: Reasons/Warnings
// gain the evidence text (no new wire field - the Preview panel already renders arbitrary Reasons/Warnings
// generically, the same choice Phase 5 made), and the private audioChecked field lets this package's own tests
// assert the label directly rather than string-matching Reasons, the same convention findingsPenalty already
// uses.
func attachAudioChecked(candidate Candidate, evidence ChapterAudioEvidence) Candidate {
	result := evaluateAudioChecked(evidence, candidate.ParagraphIDs)
	candidate.audioChecked = result.AudioChecked
	candidate.Reasons = append(candidate.Reasons, result.Reasons...)
	candidate.Warnings = append(candidate.Warnings, result.Warnings...)
	return candidate
}

func coverageWarning(signal AudioSignal) string {
	if signal.Reason != "" {
		return signal.Reason
	}
	return "this chapter's recording coverage is not current."
}

func mappingWarning(unmapped, stale, ambiguous int) string {
	switch {
	case unmapped > 0 && stale == 0 && ambiguous == 0:
		return "this chapter's audio is not mapped to paragraphs."
	case stale > 0 && unmapped == 0 && ambiguous == 0:
		return "this chapter's audio position mapping is stale since the manuscript last changed."
	case ambiguous > 0 && unmapped == 0 && stale == 0:
		return "more than one item claims the same line in this chapter; the mapping is ambiguous."
	default:
		return "this chapter's audio position mapping is incomplete."
	}
}
