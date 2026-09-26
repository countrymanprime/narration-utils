package proofing

import (
	"context"
	"slices"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/liveflags"
	"github.com/countrymanprime/narration-utils/shell/internal/repeats"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// The analyzers whose findings are pickup sources (Q1). Transcript Compare's
// name is spelled here rather than imported so this package does not depend on
// the transcript service (a test pins it to transcript.AnalyzerName).
const (
	AnalyzerTranscriptCompare = "transcript-compare"
	AnalyzerTakeReview        = repeats.AnalyzerName
	AnalyzerTeleprompter      = liveflags.AnalyzerName
)

// pickupCategories are Q1's option A: every category a tool or proofer raises
// for "look at this again". take_comparison is evidence for choosing a take,
// not a defect, and is left out.
var pickupCategories = []findings.Category{
	findings.CategoryTranscriptDiscrepancy, findings.CategoryPickup, findings.CategoryDuplicateRead,
}

// sourceSpec is what the roll-up knows about a source before reading it.
// absentResolved says a finding the source's latest run did not reproduce may
// be read as resolved without a ledger record: true only for a source whose
// store merge happens after a complete, whole-chapter run and never after a
// partial or failed one (take review: takereview.Scanner.Scan saves only after
// a successful scan of the chapter's full scope). Transcript Compare's absence
// is judged per finding by its run's coverage instead (Phase 2); read-aloud
// flags are merged, never marked absent (findings.Store.MergeAnalyzerFindings).
type sourceSpec struct {
	label          string
	absentResolved bool
}

var knownSources = map[string]sourceSpec{
	AnalyzerTranscriptCompare: {label: "Transcript Compare"},
	AnalyzerTakeReview:        {label: "Take review", absentResolved: true},
	AnalyzerTeleprompter:      {label: "Read-aloud flags"},
}

// FindingsReader is the read-only part of the findings store the roll-up
// needs (*findings.Store satisfies it).
type FindingsReader interface {
	List(query findings.Query) ([]findings.Finding, error)
}

// RunJudgement is a tracked source's answer for one chapter: its run state,
// and whether its latest complete run covered a given finding's audio (so a
// finding that run did not reproduce is resolved). Covers may be nil.
type RunJudgement struct {
	Status RunStatus
	Covers func(findings.Finding) bool
}

// RunJudge judges a tracked source's latest run for a chapter from stored
// evidence only (the ledger, the confirmed mapping and the saved project in
// view). It never starts a run.
type RunJudge func(ctx context.Context, chapter stages.ChapterContext, view stages.EvidenceView) (RunJudgement, error)

// gatherSources reads the chapter's pickup findings, groups them by analyzer,
// and judges each source's run. Every known source is reported even with no
// findings, so the evidence says which sources were looked at.
func gatherSources(ctx context.Context, reader FindingsReader, judges map[string]RunJudge, chapter stages.ChapterContext, view stages.EvidenceView) ([]SourceReport, error) {
	byAnalyzer := map[string][]findings.Finding{}
	for _, category := range pickupCategories {
		found, err := reader.List(findings.Query{Category: category, ChapterID: chapter.ChapterID, IncludeNotInLatestRun: true})
		if err != nil {
			return nil, err
		}
		for _, finding := range found {
			byAnalyzer[finding.Analyzer] = append(byAnalyzer[finding.Analyzer], finding)
		}
	}
	analyzers := make([]string, 0, len(knownSources)+len(byAnalyzer))
	for analyzer := range knownSources {
		analyzers = append(analyzers, analyzer)
	}
	for analyzer := range byAnalyzer {
		if _, known := knownSources[analyzer]; !known {
			analyzers = append(analyzers, analyzer)
		}
	}
	slices.Sort(analyzers)

	reports := make([]SourceReport, 0, len(analyzers))
	for _, analyzer := range analyzers {
		spec, known := knownSources[analyzer]
		if !known {
			spec = sourceSpec{label: analyzer}
		}
		report := SourceReport{Analyzer: analyzer, Label: spec.label, Run: RunStatus{State: RunUntracked}}
		var covers func(findings.Finding) bool
		if judge := judges[analyzer]; judge != nil {
			judgement, err := judge(ctx, chapter, view)
			if err != nil {
				return nil, err
			}
			report.Tracked, report.Run, covers = true, judgement.Status, judgement.Covers
		}
		for _, finding := range byAnalyzer[analyzer] {
			it := pickupItem(finding)
			it.ResolvedByRun = finding.NotInLatestRun && (spec.absentResolved || (covers != nil && covers(finding)))
			report.Items = append(report.Items, it)
		}
		reports = append(reports, report)
	}
	return reports, nil
}

// pickupItem is one finding as the roll-up sees it. Range is the finding's
// source-relative window when the analyzer gave one (stages.TimeRange is
// source-relative by contract), else absent.
func pickupItem(finding findings.Finding) PickupItem {
	it := PickupItem{
		FindingID: finding.ID, Category: finding.Category, Status: finding.Review.Status,
		NotInLatestRun: finding.NotInLatestRun, File: finding.Source.File, Text: findingText(finding),
	}
	if tr := finding.TimeRange; tr != nil && tr.SourceStart != nil && tr.SourceEnd != nil {
		it.Range = &stages.TimeRange{Start: *tr.SourceStart, End: *tr.SourceEnd}
	}
	if m := finding.Manuscript; m != nil && m.Span != nil {
		it.ParagraphID = m.Span.ParagraphID
	}
	return it
}

func findingText(finding findings.Finding) string {
	m := finding.Manuscript
	if m == nil {
		return categoryLabel(finding.Category)
	}
	expected, recorded := strings.TrimSpace(m.Expected), strings.TrimSpace(m.Recorded)
	switch {
	case expected != "" && recorded != "" && recorded != expected:
		return "“" + expected + "”, heard “" + recorded + "”"
	case expected != "":
		return "“" + expected + "”"
	case recorded != "":
		return "heard “" + recorded + "”"
	}
	return categoryLabel(finding.Category)
}
