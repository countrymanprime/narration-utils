package coverage

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// RecordingSignalID is the recording stage's one signal (the stage
// recommendations contract's "<stage>.<name>", docs/architecture/stage-recommendations.md):
// the chapter's text is on its track, in order, even with mistakes.
const RecordingSignalID = "recording.text_present"

// SignalInput is everything the recording signal reads (docs/utilities/recording-coverage.md
// Phase 7). It is gathered by SignalProvider from stored evidence only; the
// signal itself reads no file and no clock.
type SignalInput struct {
	// Result is the chapter's newest complete check as the result reader
	// answers it (Service.ResultIn): current, stale or never, with reasons. A
	// chapter that cannot be evaluated at all is never with one refusal Reason.
	Result ChapterResult
	// Latest is the chapter's newest coverage ledger record of any outcome, nil
	// when there is none. A partial or failed one newer than Result's record
	// holds the signal at unknown (incomplete_run).
	Latest *evidence.LedgerRecord
	// Running is true while a check of this chapter is being prepared or run.
	Running bool
	// Unavailable says why a check cannot be run here now (the Whisper model is
	// not installed, the sidecar is not set up); "" when one can.
	Unavailable string
	// Unconfirmed is true when the chapter has no confirmed track but a track's
	// name matches it: a suggestion the narrator has not confirmed (D5).
	Unconfirmed bool
	// Settings are the narrator's four settings; the thresholds are applied
	// here, on read, so changing one never re-runs anything.
	Settings Settings
	// ComputedAt is stamped on the signal.
	ComputedAt time.Time
}

// RecordingSignal is the pure recording signal (D2): met only for a current,
// complete check whose report passes both thresholds; not_met for one that
// breaks a threshold, naming the largest gap; unknown, with a cause, for
// everything else. The same input always gives the same signal.
func RecordingSignal(in SignalInput) stages.Signal {
	signal := stages.Signal{
		ID: RecordingSignalID, Stage: stages.StageRecording, Evidence: []stages.Evidence{},
		Basis: signalBasis(in), ComputedAt: in.ComputedAt,
	}
	if cause, reason, ok := contextCause(in.Result, in.Unconfirmed); ok {
		return unknownSignal(signal, cause, reason)
	}
	if in.Running {
		return unknownSignal(signal, stages.CauseAnalysisRunning, "A recording check of this chapter is running.")
	}
	current := in.Result.Current()
	if !current && in.Unavailable != "" {
		return unknownSignal(signal, stages.CauseMeasurementUnavailable, "The recording cannot be checked here: "+in.Unavailable+".")
	}
	if in.Latest != nil && in.Latest.Outcome != evidence.LedgerComplete {
		return unknownSignal(signal, stages.CauseIncompleteRun, incompleteReason(in.Latest.Outcome))
	}
	switch in.Result.State {
	case evidence.StateNever:
		return neverSignal(signal, in.Result.Reasons)
	case evidence.StateStale:
		return staleSignal(signal, in.Result.Reasons)
	case evidence.StateCurrent:
		if !current {
			return unknownSignal(signal, stages.CauseNeverAnalyzed, "The result of the last check could not be read. Check again.")
		}
	default:
		return unknownSignal(signal, stages.CauseProviderError, fmt.Sprintf("The recording check answered %q.", in.Result.State))
	}
	stored := in.Result.Result
	if stored.Alignment != in.Settings.Alignment {
		// The reader compares the parameter hash, so this is a guard: a result
		// aligned with other settings counts other words as read (Q13 B).
		return staleSignal(signal, []string{string(evidence.ReasonParamsChanged)})
	}
	if err := in.Settings.Thresholds.validate(); err != nil {
		return unknownSignal(signal, stages.CauseMeasurementUnavailable, "The recording check settings are not valid: "+err.Error()+".")
	}
	return measuredSignal(signal, stored, in.Settings)
}

func unknownSignal(signal stages.Signal, cause stages.UnknownCause, reason string) stages.Signal {
	signal.State, signal.Cause, signal.Reason = stages.SignalUnknown, cause, reason
	return signal
}

// contextCause maps a result the reader could not evaluate at all - no
// confirmed track, no saved project, not a narration chapter - to its cause.
func contextCause(result ChapterResult, unconfirmed bool) (stages.UnknownCause, string, bool) {
	if result.State != evidence.StateNever {
		return "", "", false
	}
	for _, raw := range result.Reasons {
		switch Reason(raw) {
		case ReasonUnmapped:
			if unconfirmed {
				return stages.CauseUnconfirmedMapping, "A track's name matches this chapter. Confirm the link to check its recording.", true
			}
			return stages.CauseUnmappedTrack, "Link this chapter to the REAPER track it is recorded on.", true
		case ReasonMultipleTracks:
			return stages.CauseMultipleTracks, "This chapter is linked to more than one REAPER track. Keep one link.", true
		case ReasonMappedTrackMissing:
			return stages.CauseUnmappedTrack, "The track this chapter is linked to is no longer in the saved project. Link it again.", true
		case ReasonNoProject, ReasonNoProjectFile:
			return stages.CauseProjectUnreadable, "Choose the saved REAPER project file on the Tracks page.", true
		case ReasonProjectUnreadable:
			return stages.CauseProjectUnreadable, "The saved REAPER project file could not be read. Save it again in REAPER.", true
		case ReasonNoManuscript, ReasonChapterNotFound, ReasonNotNarration, ReasonInvalidParams:
			return stages.CauseMeasurementUnavailable, "Only a narration chapter of the imported manuscript is checked.", true
		}
	}
	return "", "", false
}

func incompleteReason(outcome evidence.LedgerOutcome) string {
	if outcome == evidence.LedgerPartial {
		return "The last recording check was cancelled before it finished. Check again."
	}
	return "The last recording check failed. Check again."
}

func neverSignal(signal stages.Signal, reasons []string) stages.Signal {
	if slices.Contains(reasons, string(ReasonResultMissing)) {
		return unknownSignal(signal, stages.CauseNeverAnalyzed, "The result of the last check could not be read. Check again.")
	}
	return unknownSignal(signal, stages.CauseNeverAnalyzed, "This chapter's recording has not been checked yet.")
}

// staleText names why a check no longer describes the chapter.
var staleText = map[string]string{
	string(evidence.ReasonItemAdded):       "audio was added",
	string(evidence.ReasonItemRemoved):     "audio was removed",
	string(evidence.ReasonItemTrimmed):     "an item was trimmed",
	string(evidence.ReasonItemMoved):       "an item was moved",
	string(evidence.ReasonItemMuted):       "an item was muted or unmuted",
	string(evidence.ReasonTakeSwitched):    "a different take was chosen",
	string(evidence.ReasonSourceChanged):   "an audio file changed",
	string(evidence.ReasonAnalyzerChanged): "the check itself was updated",
	string(evidence.ReasonParamsChanged):   "the recording check settings changed",
	string(evidence.ReasonMappingChanged):  "the chapter was linked to another track",
	string(ReasonManuscriptChanged):        "the chapter's text changed",
}

func staleSignal(signal stages.Signal, reasons []string) stages.Signal {
	parts := []string{}
	for _, reason := range reasons {
		if text, ok := staleText[reason]; ok && !slices.Contains(parts, text) {
			parts = append(parts, text)
		}
	}
	if len(parts) == 0 {
		parts = []string{"the chapter changed"}
	}
	signal = unknownSignal(signal, stages.CauseStale, "Check again: since the last check "+strings.Join(parts, ", ")+".")
	signal.Evidence = []stages.Evidence{{Kind: "stale", Label: "Changed since the check", Value: strings.Join(reasons, ", ")}}
	return signal
}

// measuredSignal applies the thresholds to a current, complete report.
func measuredSignal(signal stages.Signal, stored *StoredResult, settings Settings) stages.Signal {
	report := stored.Report
	signal.Evidence = measuredEvidence(stored, settings)
	if report.TextComplete(settings.Thresholds) {
		signal.State = stages.SignalMet
		signal.Reason = fmt.Sprintf("Text present: %d of %s; every paragraph passes.", report.Summary.PresentTokens, words(report.Summary.BodyTokens))
		return signal
	}
	signal.State = stages.SignalNotMet
	signal.Reason = largestGap(report, settings.Thresholds)
	return signal
}

// largestGap names what breaks the thresholds, most useful first: the largest
// region over the missing-run limit, then a paragraph with a run over it,
// then the paragraph with the smallest share read.
func largestGap(report Report, thresholds Thresholds) string {
	numbers := paragraphNumbers(report)
	var worstRegion *RegionLine
	for i := range report.Regions {
		region := &report.Regions[i]
		if region.TokenCount > thresholds.MaxMissingRun && (worstRegion == nil || region.TokenCount > worstRegion.TokenCount) {
			worstRegion = region
		}
	}
	if worstRegion != nil {
		return fmt.Sprintf("%s: %s not read.", describeParagraphs(worstRegion.ParagraphIDs, numbers), words(worstRegion.TokenCount))
	}
	var longest, thinnest *ParagraphLine
	for i := range report.Paragraphs {
		paragraph := &report.Paragraphs[i]
		if paragraph.LongestMissingRun > thresholds.MaxMissingRun && (longest == nil || paragraph.LongestMissingRun > longest.LongestMissingRun) {
			longest = paragraph
		}
		if paragraph.PresentFraction() < thresholds.MinParagraphPresent && (thinnest == nil || paragraph.PresentFraction() < thinnest.PresentFraction()) {
			thinnest = paragraph
		}
	}
	switch {
	case longest != nil:
		return fmt.Sprintf("%s: %s in a row not read.", describeParagraphs([]string{longest.ID}, numbers), words(longest.LongestMissingRun))
	case thinnest != nil:
		return fmt.Sprintf("%s: %d of %s read.", describeParagraphs([]string{thinnest.ID}, numbers), thinnest.Present, words(thinnest.Tokens))
	}
	return fmt.Sprintf("%s in a row not read.", words(report.Summary.LongestMissingRun))
}

var regionLabels = map[string]string{
	"head": "Start not read", "tail": "End not read", "skip": "Skipped", "short_read": "Read short", "different_text": "Different text read",
}

// measuredEvidence is the typed evidence of a current report: coverage, each
// region largest first, items, and how the check was made.
func measuredEvidence(stored *StoredResult, settings Settings) []stages.Evidence {
	report := stored.Report
	summary := report.Summary
	failing := failingParagraphs(report, settings.Thresholds)
	entries := []stages.Evidence{{
		Kind: "coverage", Label: "Text present",
		Value: fmt.Sprintf("%d of %s present, %d missing (longest run %d), %d extra; %d of %s passing",
			summary.PresentTokens, words(summary.BodyTokens), summary.MissingTokens, summary.LongestMissingRun, summary.ExtraTokens,
			len(report.Paragraphs)-len(failing), plural(len(report.Paragraphs), "paragraph")),
	}}
	numbers := paragraphNumbers(report)
	regions := slices.Clone(report.Regions)
	slices.SortStableFunc(regions, func(a, b RegionLine) int { return cmp.Compare(b.TokenCount, a.TokenCount) })
	for _, region := range regions {
		entries = append(entries, regionEvidence(region, numbers))
	}
	for _, paragraph := range failing {
		entries = append(entries, paragraphEvidence(paragraph, numbers))
	}
	entries = append(entries, stages.Evidence{
		Kind: "items", Label: "Audio checked",
		Value: fmt.Sprintf("%s analyzed, %d muted and skipped, %s played", plural(summary.Items.Analyzed, "item"), summary.Items.Muted, clock(summary.Items.PlayedSeconds)),
	})
	language := stored.Language
	if language == "" {
		language = "detected"
	}
	entries = append(entries, stages.Evidence{
		Kind: "analysis", Label: "How it was checked",
		Value: fmt.Sprintf("Whisper model %s, language %s; misread run up to %d, anchor run at least %d; each paragraph at least %s read, missing run up to %s (Proposed, uncalibrated)",
			stored.Model, language, stored.Alignment.MaxMisreadRun, stored.Alignment.MinAnchorRun,
			percent(settings.Thresholds.MinParagraphPresent), words(settings.Thresholds.MaxMissingRun)),
	})
	return entries
}

// failingParagraphs are the report's paragraphs that break a threshold, in
// chapter order: the per-paragraph evidence of a measured signal.
func failingParagraphs(report Report, thresholds Thresholds) []ParagraphLine {
	failing := []ParagraphLine{}
	for _, paragraph := range report.Paragraphs {
		if !paragraphPasses(paragraph, thresholds) {
			failing = append(failing, paragraph)
		}
	}
	return failing
}

func paragraphEvidence(paragraph ParagraphLine, numbers map[string]int) stages.Evidence {
	return stages.Evidence{
		Kind: "paragraph", Label: "Paragraph short",
		Value: fmt.Sprintf("%s: %d of %s read (%s), longest missing run %s", describeParagraphs([]string{paragraph.ID}, numbers),
			paragraph.Present, words(paragraph.Tokens), percent(paragraph.PresentFraction()), words(paragraph.LongestMissingRun)),
		ParagraphIDs: []string{paragraph.ID},
	}
}

func regionEvidence(region RegionLine, numbers map[string]int) stages.Evidence {
	span := fmt.Sprintf("“%s”", region.FirstWord)
	if region.TokenCount > 1 {
		span = fmt.Sprintf("from “%s” to “%s”", region.FirstWord, region.LastWord)
	}
	entry := stages.Evidence{
		Kind: "region", Label: cmp.Or(regionLabels[region.Kind], region.Kind),
		Value:        fmt.Sprintf("%s: %s, %s", describeParagraphs(region.ParagraphIDs, numbers), words(region.TokenCount), span),
		ParagraphIDs: slices.Clone(region.ParagraphIDs),
	}
	if position := region.Position; position != nil {
		entry.Value += fmt.Sprintf(" (item %d of the track, at %s in its audio file)", position.ItemIndex+1, clock(position.SourceTime))
		entry.Range = &stages.TimeRange{Start: position.SourceTime, End: position.SourceTime}
	}
	return entry
}

// paragraphNumbers numbers the report's paragraphs from 1 in chapter order
// (the sidecar writes them in order), as the Home check names them.
func paragraphNumbers(report Report) map[string]int {
	numbers := make(map[string]int, len(report.Paragraphs))
	for index, paragraph := range report.Paragraphs {
		numbers[paragraph.ID] = index + 1
	}
	return numbers
}

// describeParagraphs is "paragraph 12" or "paragraphs 38 to 40", falling back
// to the id of a paragraph the report does not list.
func describeParagraphs(ids []string, numbers map[string]int) string {
	first, last := 0, 0
	for _, id := range ids {
		number, ok := numbers[id]
		if !ok {
			return "paragraph " + strings.Join(ids, ", ")
		}
		if first == 0 || number < first {
			first = number
		}
		last = max(last, number)
	}
	switch {
	case len(ids) == 0:
		return "the chapter"
	case first == last:
		return fmt.Sprintf("paragraph %d", first)
	}
	return fmt.Sprintf("paragraphs %d to %d", first, last)
}

func words(count int) string { return plural(count, "word") }

func plural(count int, noun string) string {
	if count == 1 {
		return "1 " + noun
	}
	return fmt.Sprintf("%d %ss", count, noun)
}

func percent(share float64) string {
	return fmt.Sprintf("%g%%", math.Round(share*1000)/10)
}

// clock is "2:05" or "1:02:09".
func clock(seconds float64) string {
	whole := int(math.Max(0, math.Floor(seconds)))
	if whole >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", whole/3600, whole%3600/60, whole%60)
	}
	return fmt.Sprintf("%d:%02d", whole/60, whole%60)
}

// signalBasis is the ledger records the signal read (the compared complete
// record, and a newer incomplete one), the fingerprint that record was made
// at (the chapter's current one when the result is current), and the saved
// project's modified time.
func signalBasis(in SignalInput) stages.Basis {
	basis := stages.Basis{LedgerRecordIDs: []string{}}
	if record := in.Result.Record; record != nil {
		basis.LedgerRecordIDs = append(basis.LedgerRecordIDs, record.ID)
		basis.Fingerprint = string(record.Fingerprint.TrackFingerprint)
	}
	if in.Latest != nil && !slices.Contains(basis.LedgerRecordIDs, in.Latest.ID) {
		basis.LedgerRecordIDs = append(basis.LedgerRecordIDs, in.Latest.ID)
	}
	if in.Result.Basis != nil {
		basis.ProjectFileModTime = in.Result.Basis.ProjectFile.ModTime
	}
	return basis
}
