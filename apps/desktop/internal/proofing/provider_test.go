package proofing

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
	"github.com/countrymanprime/narration-utils/shell/internal/transcript"
)

const (
	testDocument = "doc-1"
	testChapter  = "c-0001"
	testTrack    = "{TRACK-1}"
)

func proofingChapter() stages.ChapterContext {
	return stages.ChapterContext{DocumentID: testDocument, ChapterID: testChapter, Title: "Chapter One", Status: stages.StageProofing}
}

// testProject is a findings store, a ledger and a mapping store in one
// temporary project folder, with the chapter linked to testTrack.
type testProject struct {
	dir      string
	findings *findings.Store
	ledger   *evidence.LedgerStore
	mapping  *evidence.MappingStore
	project  tracks.Project
}

func newTestProject(t *testing.T) *testProject {
	t.Helper()
	dir := t.TempDir()
	p := &testProject{dir: dir, findings: findings.NewStore(dir), ledger: evidence.NewLedgerStore(dir), mapping: evidence.NewMappingStore(dir)}
	p.project = tracks.Project{Tracks: []tracks.Track{{GUID: testTrack, Name: "Chapter One"}}}
	if _, err := p.mapping.Confirm(testDocument, testTrack, testChapter, "Chapter One"); err != nil {
		t.Fatal(err)
	}
	return p
}

func (p *testProject) view() stages.EvidenceView {
	return stages.EvidenceView{DocumentID: testDocument, ProjectFolder: p.dir, Project: p.project, Ledger: p.ledger, Mapping: p.mapping}
}

func testFinding(id, analyzer, chapter string, category findings.Category) findings.Finding {
	start, end := 1.5, 2.5
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion, ID: id, Analyzer: analyzer, Category: category, Severity: findings.SeverityWarning,
		Source:           findings.Source{File: "/audio/take.wav"},
		TimeRange:        &findings.TimeRange{Start: 10, End: 11, SourceStart: &start, SourceEnd: &end},
		Manuscript:       &findings.Manuscript{ChapterID: chapter, Expected: "the line", Recorded: "a line", Span: &findings.Span{ParagraphID: "p-7"}},
		ConfidenceReason: "test", Review: findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

func (p *testProject) save(t *testing.T, analyzer, scope string, fresh ...findings.Finding) {
	t.Helper()
	if _, err := p.findings.SaveAnalyzerFindings(analyzer, scope, fresh); err != nil {
		t.Fatal(err)
	}
}

func (p *testProject) decide(t *testing.T, id string, status findings.Status) {
	t.Helper()
	if _, found, err := p.findings.RecordDecision(id, "", status, "", "2026-09-26T10:00:00Z"); err != nil || !found {
		t.Fatalf("RecordDecision(%s) = found %v, %v", id, found, err)
	}
}

func pickupsOf(t *testing.T, provider *SignalProvider, view stages.EvidenceView) stages.Signal {
	t.Helper()
	signals, err := provider.Signals(context.Background(), proofingChapter(), view)
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	for _, signal := range signals {
		if err := signal.Validate(); err != nil {
			t.Fatalf("signal %s: %v", signal.ID, err)
		}
		if signal.ID == PickupsSignalID {
			return signal
		}
	}
	t.Fatalf("no %s signal in %v", PickupsSignalID, signals)
	return stages.Signal{}
}

func currentCompare(covers bool) RunJudge {
	return func(context.Context, stages.ChapterContext, stages.EvidenceView) (RunJudgement, error) {
		return RunJudgement{Status: runCurrent, Covers: func(findings.Finding) bool { return covers }}, nil
	}
}

func openFindingIDs(signal stages.Signal) []string {
	var ids []string
	for _, entry := range signal.Evidence {
		if entry.Kind == EvidencePickup {
			ids = append(ids, entry.FindingID)
		}
	}
	return ids
}

func TestSignalProviderDeclaresStageAndIDs(t *testing.T) {
	provider := NewSignalProvider(Config{})
	if provider.Stage() != stages.StageProofing {
		t.Fatalf("Stage() = %q", provider.Stage())
	}
	if !slices.Contains(provider.SignalIDs(), PickupsSignalID) {
		t.Fatalf("SignalIDs() = %v, missing %s", provider.SignalIDs(), PickupsSignalID)
	}
}

func TestAnalyzerNamesMatchTheirProducers(t *testing.T) {
	if AnalyzerTranscriptCompare != transcript.AnalyzerName {
		t.Fatalf("AnalyzerTranscriptCompare = %q, transcript saves under %q", AnalyzerTranscriptCompare, transcript.AnalyzerName)
	}
}

func TestSignalProviderNeedsAProject(t *testing.T) {
	if _, err := NewSignalProvider(Config{}).Signals(context.Background(), proofingChapter(), stages.EvidenceView{}); err == nil {
		t.Fatal("a provider with no findings store must fail, not answer")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p := newTestProject(t)
	if _, err := NewSignalProvider(Config{Findings: p.findings}).Signals(ctx, proofingChapter(), p.view()); err == nil {
		t.Fatal("a cancelled evaluation must fail")
	}
}

// TestSignalProviderUnknownWithNothingRun: an empty roll-up is unknown, never
// met (Phase 1's success signal).
func TestSignalProviderUnknownWithNothingRun(t *testing.T) {
	p := newTestProject(t)
	signal := pickupsOf(t, NewSignalProvider(Config{Findings: p.findings}), p.view())
	if signal.State != stages.SignalUnknown || signal.Cause != stages.CauseNeverAnalyzed {
		t.Fatalf("signal = %q/%q (%s), want unknown/never_analyzed", signal.State, signal.Cause, signal.Reason)
	}
}

// TestSignalProviderUnmappedChapterNamesTheMapping: with no confirmed track and
// nothing current, the action is linking the track.
func TestSignalProviderUnmappedChapterNamesTheMapping(t *testing.T) {
	p := newTestProject(t)
	if err := p.mapping.Clear(testDocument, testTrack); err != nil {
		t.Fatal(err)
	}
	signal := pickupsOf(t, NewSignalProvider(Config{Findings: p.findings}), p.view())
	if signal.State != stages.SignalUnknown || signal.Cause != stages.CauseUnmappedTrack {
		t.Fatalf("signal = %q/%q, want unknown/unmapped_track", signal.State, signal.Cause)
	}
	view := p.view()
	view.ProjectErr = errors.New("no such file")
	signal = pickupsOf(t, NewSignalProvider(Config{Findings: p.findings}), view)
	if signal.Cause != stages.CauseProjectUnreadable {
		t.Fatalf("cause = %q, want project_unreadable", signal.Cause)
	}
}

// TestSignalProviderReadsTheStore: open findings of every pickup category and
// source count against the chapter, per D9; take_comparison and another
// chapter's findings do not.
func TestSignalProviderReadsTheStore(t *testing.T) {
	p := newTestProject(t)
	p.save(t, AnalyzerTranscriptCompare, testChapter,
		testFinding("cmp-open", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy),
		testFinding("cmp-dismissed", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy))
	p.save(t, AnalyzerTakeReview, testChapter,
		testFinding("tr-accepted", AnalyzerTakeReview, testChapter, findings.CategoryPickup),
		testFinding("tr-dup-deferred", AnalyzerTakeReview, testChapter, findings.CategoryDuplicateRead))
	p.save(t, "take-comparison", testChapter, testFinding("take-cmp", "take-comparison", testChapter, findings.CategoryTakeComparison))
	p.save(t, AnalyzerTakeReview, "c-0002", testFinding("other-chapter", AnalyzerTakeReview, "c-0002", findings.CategoryPickup))
	p.decide(t, "cmp-dismissed", findings.StatusDismissed)
	p.decide(t, "tr-accepted", findings.StatusAccepted)
	p.decide(t, "tr-dup-deferred", findings.StatusDeferred)

	provider := NewSignalProvider(Config{Findings: p.findings, Runs: map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)}})
	signal := pickupsOf(t, provider, p.view())
	if signal.State != stages.SignalNotMet {
		t.Fatalf("state = %q (%s), want not_met", signal.State, signal.Reason)
	}
	if got := openFindingIDs(signal); !slices.Equal(got, []string{"cmp-open", "tr-accepted", "tr-dup-deferred"}) {
		t.Fatalf("open = %v", got)
	}
	for _, entry := range signal.Evidence {
		if entry.FindingID == "cmp-open" && (entry.Range == nil || entry.Range.Start != 1.5 || len(entry.ParagraphIDs) != 1 || entry.ParagraphIDs[0] != "p-7") {
			t.Fatalf("open item evidence lost its source range or paragraph: %+v", entry)
		}
	}

	for _, id := range []string{"cmp-open", "tr-accepted", "tr-dup-deferred"} {
		p.decide(t, id, findings.StatusDismissed)
	}
	if signal = pickupsOf(t, provider, p.view()); signal.State != stages.SignalMet {
		t.Fatalf("after dismissing every item: %q (%s), want met", signal.State, signal.Reason)
	}
}

// TestSignalProviderAbsentFindings is the Success Metrics row "Partial or failed
// run resolving findings: 0": a finding a later run did not reproduce is
// resolved only when that run covered it. Take review's absences come only from
// complete scans, so they resolve.
func TestSignalProviderAbsentFindings(t *testing.T) {
	p := newTestProject(t)
	p.save(t, AnalyzerTranscriptCompare, testChapter, testFinding("cmp", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy))
	p.save(t, AnalyzerTranscriptCompare, testChapter) // a later run that did not reproduce it
	p.save(t, AnalyzerTakeReview, testChapter, testFinding("tr", AnalyzerTakeReview, testChapter, findings.CategoryPickup))
	p.save(t, AnalyzerTakeReview, testChapter)

	uncovered := NewSignalProvider(Config{Findings: p.findings, Runs: map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)}})
	signal := pickupsOf(t, uncovered, p.view())
	if signal.State != stages.SignalNotMet || !slices.Equal(openFindingIDs(signal), []string{"cmp"}) {
		t.Fatalf("uncovered absence: %q open=%v, want not_met [cmp]", signal.State, openFindingIDs(signal))
	}
	covered := NewSignalProvider(Config{Findings: p.findings, Runs: map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(true)}})
	if signal = pickupsOf(t, covered, p.view()); signal.State != stages.SignalMet {
		t.Fatalf("covered absence: %q (%s), want met", signal.State, signal.Reason)
	}
	untracked := NewSignalProvider(Config{Findings: p.findings})
	if signal = pickupsOf(t, untracked, p.view()); signal.State != stages.SignalNotMet {
		t.Fatalf("an untracked Compare cannot resolve its absent finding: %q", signal.State)
	}
}

func TestSignalProviderJudgeErrorFails(t *testing.T) {
	p := newTestProject(t)
	failing := func(context.Context, stages.ChapterContext, stages.EvidenceView) (RunJudgement, error) {
		return RunJudgement{}, errors.New("ledger unreadable")
	}
	provider := NewSignalProvider(Config{Findings: p.findings, Runs: map[string]RunJudge{AnalyzerTranscriptCompare: failing}})
	if _, err := provider.Signals(context.Background(), proofingChapter(), p.view()); err == nil {
		t.Fatal("a judge that cannot answer must fail the provider (the engine turns that into provider_error)")
	}
}
