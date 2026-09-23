package coverage

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

var (
	signalSaved = time.Date(2026, 9, 21, 9, 0, 0, 0, time.UTC)
	signalNow   = time.Date(2026, 9, 21, 10, 0, 0, 0, time.UTC)
)

// testReport builds a consistent report from its paragraphs and regions.
func testReport(paragraphs []ParagraphLine, regions ...RegionLine) Report {
	summary := Summary{SchemaVersion: 1, ChapterID: testChapter, Alignment: DefaultAlignmentParams, ExtraTokens: 2,
		Items: SummaryItems{Analyzed: 2, Muted: 1, PlayedSeconds: 125.5}}
	for _, paragraph := range paragraphs {
		summary.BodyTokens += paragraph.Tokens
		summary.PresentTokens += paragraph.Present
		summary.LongestMissingRun = max(summary.LongestMissingRun, paragraph.LongestMissingRun)
	}
	summary.MissingTokens = summary.BodyTokens - summary.PresentTokens
	return Report{Summary: summary, Paragraphs: paragraphs, Regions: regions}
}

func completeRecord(id string) *evidence.LedgerRecord {
	return &evidence.LedgerRecord{ID: id, AnalyzerID: AnalyzerID, Outcome: evidence.LedgerComplete,
		Fingerprint: evidence.LedgerFingerprint{TrackFingerprint: "fp-" + evidence.TrackFingerprint(id)}}
}

func resultBasis() *evidence.EvaluationBasis {
	return &evidence.EvaluationBasis{ProjectFile: evidence.LedgerProjectFile{ModTime: signalSaved}, Label: "saved project, file modified 2026-09-21T09:00:00Z"}
}

// currentWith is a current result for report, made with the default alignment by the "small" model.
func currentWith(report Report) ChapterResult {
	record := completeRecord("rec-1")
	return ChapterResult{State: evidence.StateCurrent, Reasons: []string{}, Basis: resultBasis(), Record: record,
		Result: &StoredResult{RecordID: record.ID, DocumentID: testDocument, ChapterID: testChapter, Model: "small", Alignment: DefaultAlignmentParams, Report: report}}
}

var (
	allRead = testReport([]ParagraphLine{
		{ID: "p-000001", Tokens: 40, Present: 40},
		{ID: "p-000002", Tokens: 60, Present: 60},
	})
	// A few scattered words dropped by the ASR: every paragraph at 95% or more, no run over 3.
	scatteredDrops = testReport([]ParagraphLine{
		{ID: "p-000001", Tokens: 40, Present: 39, LongestMissingRun: 1},
		{ID: "p-000002", Tokens: 60, Present: 57, LongestMissingRun: 2},
	})
	// Paragraph 2 skipped in the middle: a 14-word region, plus a 4-word tail.
	skippedBlock = testReport([]ParagraphLine{
		{ID: "p-000001", Tokens: 40, Present: 40},
		{ID: "p-000002", Tokens: 20, Present: 6, LongestMissingRun: 14},
		{ID: "p-000003", Tokens: 40, Present: 36, LongestMissingRun: 4},
	},
		RegionLine{Kind: "tail", ParagraphIDs: []string{"p-000003"}, TokenCount: 4, FirstWord: "and", LastWord: "end.", Position: &RegionPosition{ItemIndex: 1, ItemGUID: "{ITEM-B}", SourceTime: 61.5}},
		RegionLine{Kind: "skip", ParagraphIDs: []string{"p-000002"}, TokenCount: 14, FirstWord: "down", LastWord: "rabbit-hole", Position: &RegionPosition{ItemIndex: 0, ItemGUID: "{ITEM-A}", SourceTime: 12.25}},
	)
	// No long run, but paragraph 2 lost 3 of 20 words (85%).
	thinParagraph = testReport([]ParagraphLine{
		{ID: "p-000001", Tokens: 40, Present: 40},
		{ID: "p-000002", Tokens: 20, Present: 17, LongestMissingRun: 1},
	})
)

func withLatest(result ChapterResult, outcome evidence.LedgerOutcome) SignalInput {
	latest := &evidence.LedgerRecord{ID: "rec-2", AnalyzerID: AnalyzerID, Outcome: outcome}
	return SignalInput{Result: result, Latest: latest, Settings: DefaultSettings, ComputedAt: signalNow}
}

func input(result ChapterResult) SignalInput {
	var latest *evidence.LedgerRecord
	if result.Record != nil {
		latest = result.Record
	}
	return SignalInput{Result: result, Latest: latest, Settings: DefaultSettings, ComputedAt: signalNow}
}

func never(reasons ...string) ChapterResult {
	return ChapterResult{State: evidence.StateNever, Reasons: reasons}
}

func stale(reasons ...string) ChapterResult {
	result := currentWith(allRead)
	result.State, result.Reasons = evidence.StateStale, reasons
	return result
}

func TestRecordingSignalTable(t *testing.T) {
	strict := DefaultSettings
	strict.Thresholds.MinParagraphPresent = 1
	loose := DefaultSettings
	loose.Thresholds = Thresholds{MinParagraphPresent: 0.25, MaxMissingRun: 20}
	otherAlignment := input(currentWith(allRead))
	otherAlignment.Settings.Alignment.MinAnchorRun = 4
	unconfirmed := input(never(string(ReasonUnmapped)))
	unconfirmed.Unconfirmed = true
	running := input(currentWith(allRead))
	running.Running = true
	modelMissing := input(never())
	modelMissing.Unavailable = "the Whisper model small is not installed"
	modelMissingStale := input(stale(string(evidence.ReasonItemTrimmed)))
	modelMissingStale.Unavailable = "the Whisper model small is not installed"
	modelMissingCurrent := input(currentWith(allRead))
	modelMissingCurrent.Unavailable = "the Whisper model small is not installed"
	badThresholds := input(currentWith(allRead))
	badThresholds.Settings.Thresholds.MinParagraphPresent = 2

	cases := []struct {
		name   string
		in     SignalInput
		state  stages.SignalState
		cause  stages.UnknownCause
		reason string
	}{
		{"every word read", input(currentWith(allRead)), stages.SignalMet, "", "Text present: 100 of 100 words"},
		{"scattered drops within the thresholds", input(currentWith(scatteredDrops)), stages.SignalMet, "", "every paragraph passes"},
		{"a model or language change is still current (Q13 A)", func() SignalInput {
			result := currentWith(allRead)
			result.Result.Model, result.Result.Language = "large-v3", "fr"
			return input(result)
		}(), stages.SignalMet, "", "Text present"},
		{"a skipped block names the largest region", input(currentWith(skippedBlock)), stages.SignalNotMet, "", "paragraph 2: 14 words not read"},
		{"a thin paragraph names its share", input(currentWith(thinParagraph)), stages.SignalNotMet, "", "paragraph 2: 17 of 20 words read"},
		{"a threshold change is read, not re-run: stricter", SignalInput{Result: currentWith(scatteredDrops), Latest: completeRecord("rec-1"), Settings: strict, ComputedAt: signalNow}, stages.SignalNotMet, "", "paragraph 2: 57 of 60 words read"},
		{"a threshold change is read, not re-run: looser", SignalInput{Result: currentWith(skippedBlock), Latest: completeRecord("rec-1"), Settings: loose, ComputedAt: signalNow}, stages.SignalMet, "", "every paragraph passes"},
		{"never analyzed", input(never()), stages.SignalUnknown, stages.CauseNeverAnalyzed, "has not been checked"},
		{"the stored result is unreadable", input(never(string(ReasonResultMissing))), stages.SignalUnknown, stages.CauseNeverAnalyzed, "could not be read"},
		{"stale fingerprint", input(stale(string(evidence.ReasonItemTrimmed))), stages.SignalUnknown, stages.CauseStale, "trimmed"},
		{"stale after a take switch (Q5, EL's active-take parse)", input(stale(string(evidence.ReasonTakeSwitched))), stages.SignalUnknown, stages.CauseStale, "take"},
		{"manuscript changed", input(stale(string(ReasonManuscriptChanged))), stages.SignalUnknown, stages.CauseStale, "text changed"},
		{"alignment settings changed (Q13 B)", input(stale(string(evidence.ReasonParamsChanged))), stages.SignalUnknown, stages.CauseStale, "settings changed"},
		{"a current result made with other alignment settings", otherAlignment, stages.SignalUnknown, stages.CauseStale, "settings changed"},
		{"a newer partial run", withLatest(currentWith(allRead), evidence.LedgerPartial), stages.SignalUnknown, stages.CauseIncompleteRun, "cancelled"},
		{"a newer failed run", withLatest(currentWith(allRead), evidence.LedgerFailed), stages.SignalUnknown, stages.CauseIncompleteRun, "failed"},
		{"only a partial run", withLatest(never(), evidence.LedgerPartial), stages.SignalUnknown, stages.CauseIncompleteRun, "cancelled"},
		{"a check of this chapter is running", running, stages.SignalUnknown, stages.CauseAnalysisRunning, "running"},
		{"no confirmed track", input(never(string(ReasonUnmapped))), stages.SignalUnknown, stages.CauseUnmappedTrack, "Link this chapter"},
		{"a track matches but is not confirmed (D5)", unconfirmed, stages.SignalUnknown, stages.CauseUnconfirmedMapping, "Confirm"},
		{"two confirmed tracks", input(never(string(ReasonMultipleTracks))), stages.SignalUnknown, stages.CauseMultipleTracks, "more than one"},
		{"the confirmed track is gone", input(never(string(ReasonMappedTrackMissing))), stages.SignalUnknown, stages.CauseUnmappedTrack, "no longer in the saved project"},
		{"no saved project file", input(never(string(ReasonNoProjectFile))), stages.SignalUnknown, stages.CauseProjectUnreadable, "Tracks page"},
		{"the saved project cannot be read", input(never(string(ReasonProjectUnreadable))), stages.SignalUnknown, stages.CauseProjectUnreadable, "could not be read"},
		{"not a narration chapter", input(never(string(ReasonNotNarration))), stages.SignalUnknown, stages.CauseMeasurementUnavailable, "narration"},
		{"model missing, never checked", modelMissing, stages.SignalUnknown, stages.CauseMeasurementUnavailable, "not installed"},
		{"model missing, stale", modelMissingStale, stages.SignalUnknown, stages.CauseMeasurementUnavailable, "not installed"},
		{"model missing does not hide a current result", modelMissingCurrent, stages.SignalMet, "", "Text present"},
		{"invalid thresholds never pass", badThresholds, stages.SignalUnknown, stages.CauseMeasurementUnavailable, "settings"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RecordingSignal(tc.in)
			if got.State != tc.state || got.Cause != tc.cause {
				t.Fatalf("state %s cause %q (reason %q), want %s %q", got.State, got.Cause, got.Reason, tc.state, tc.cause)
			}
			if !strings.Contains(got.Reason, tc.reason) {
				t.Fatalf("reason %q does not contain %q", got.Reason, tc.reason)
			}
			if err := got.Validate(); err != nil {
				t.Fatalf("the signal breaks the contract: %v", err)
			}
			if got.ID != RecordingSignalID || got.Stage != stages.StageRecording || !got.ComputedAt.Equal(signalNow) {
				t.Fatalf("id %q stage %q computedAt %v", got.ID, got.Stage, got.ComputedAt)
			}
			if got.Evidence == nil || got.Basis.LedgerRecordIDs == nil {
				t.Fatalf("evidence and ledger record ids must be lists, never null: %+v", got)
			}
		})
	}
}

func TestRecordingSignalNeverMetWithoutACurrentCompleteResult(t *testing.T) {
	// Every non-current shape, with a report that would pass, must not be met (D2).
	shapes := map[string]SignalInput{
		"stale":              input(stale(string(evidence.ReasonItemAdded))),
		"never with report":  input(ChapterResult{State: evidence.StateNever, Result: currentWith(allRead).Result}),
		"current, no report": input(ChapterResult{State: evidence.StateCurrent, Record: completeRecord("rec-1")}),
		"unknown state":      input(ChapterResult{State: "maybe", Result: currentWith(allRead).Result, Record: completeRecord("rec-1")}),
		"partial newest":     withLatest(currentWith(allRead), evidence.LedgerPartial),
	}
	for name, in := range shapes {
		if got := RecordingSignal(in); got.State != stages.SignalUnknown {
			t.Fatalf("%s: state %s, want unknown", name, got.State)
		}
	}
}

func TestRecordingSignalIsDeterministic(t *testing.T) {
	in := input(currentWith(skippedBlock))
	first, second := RecordingSignal(in), RecordingSignal(in)
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("the same input gave two signals:\n%+v\n%+v", first, second)
	}
	if stages.BasisKey(testChapter, stages.StageEditing, []stages.Signal{first}) != stages.BasisKey(testChapter, stages.StageEditing, []stages.Signal{second}) {
		t.Fatal("the same input gave two basis keys")
	}
}

func TestRecordingSignalEvidenceIsTyped(t *testing.T) {
	got := RecordingSignal(input(currentWith(skippedBlock)))

	kinds := []string{}
	for _, entry := range got.Evidence {
		kinds = append(kinds, entry.Kind)
	}
	want := []string{"coverage", "region", "region", "items", "analysis"}
	if !reflect.DeepEqual(kinds, want) {
		t.Fatalf("evidence kinds %v, want %v", kinds, want)
	}
	coverage := got.Evidence[0]
	if !strings.Contains(coverage.Value, "82 of 100 words") || !strings.Contains(coverage.Value, "14") || !strings.Contains(coverage.Value, "2 extra") {
		t.Fatalf("coverage evidence %+v", coverage)
	}
	// Regions come largest first, with paragraph ids and the audio position.
	skip := got.Evidence[1]
	if skip.Label != "Skipped" || !reflect.DeepEqual(skip.ParagraphIDs, []string{"p-000002"}) || skip.Range == nil || skip.Range.Start != 12.25 ||
		!strings.Contains(skip.Value, "paragraph 2: 14 words, from “down” to “rabbit-hole”") || !strings.Contains(skip.Value, "item 1") {
		t.Fatalf("region evidence %+v", skip)
	}
	items := got.Evidence[3]
	if !strings.Contains(items.Value, "2 items") || !strings.Contains(items.Value, "1 muted") || !strings.Contains(items.Value, "2:05") {
		t.Fatalf("items evidence %+v", items)
	}
	analysis := got.Evidence[4]
	for _, part := range []string{"small", "misread run up to 8", "anchor run at least 3", "95%", "3 words", "uncalibrated"} {
		if !strings.Contains(analysis.Value, part) {
			t.Fatalf("analysis evidence %q lacks %q", analysis.Value, part)
		}
	}
}

func TestRecordingSignalBasis(t *testing.T) {
	current := RecordingSignal(input(currentWith(allRead)))
	if !reflect.DeepEqual(current.Basis.LedgerRecordIDs, []string{"rec-1"}) || current.Basis.Fingerprint != "fp-rec-1" || !current.Basis.ProjectFileModTime.Equal(signalSaved) {
		t.Fatalf("current basis %+v", current.Basis)
	}
	partial := RecordingSignal(withLatest(currentWith(allRead), evidence.LedgerPartial))
	if !reflect.DeepEqual(partial.Basis.LedgerRecordIDs, []string{"rec-1", "rec-2"}) {
		t.Fatalf("a newer partial run must be part of the basis: %+v", partial.Basis)
	}
	neverRun := RecordingSignal(input(never()))
	if len(neverRun.Basis.LedgerRecordIDs) != 0 || neverRun.Basis.Fingerprint != "" || len(neverRun.Evidence) != 0 {
		t.Fatalf("never basis %+v evidence %+v", neverRun.Basis, neverRun.Evidence)
	}
	staleRun := RecordingSignal(input(stale(string(evidence.ReasonItemTrimmed), string(evidence.ReasonItemMoved))))
	if len(staleRun.Evidence) != 1 || staleRun.Evidence[0].Kind != "stale" || !strings.Contains(staleRun.Evidence[0].Value, "item_trimmed, item_moved") {
		t.Fatalf("stale evidence %+v", staleRun.Evidence)
	}
}
