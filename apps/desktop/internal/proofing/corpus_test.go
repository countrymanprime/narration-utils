// This file is Phase 9 of docs/prds/chapter-stage-recommendations.prd.md
// ("Secondary surfaces and close-out"): an end-to-end validation of the SR
// verdict for proofing->finalized, mirroring
// apps/desktop/internal/coverage/corpus_test.go's architecture (a small
// labeled corpus, the REAL stages.Service driving the REAL proofing
// SignalProvider, an assertion the verdict agrees with the label) rather
// than reusing its files, since proofing-readiness-signals.prd.md's own
// real annotated pickup corpus still needs permissioned material nobody
// has yet.
//
// PROVISIONAL (D70/D71, see docs/research/editing-and-proofing-corpus.md):
// this is a synthetic, signal-level stand-in, not the real PS corpus. Only
// the underlying evidence sources are faked here (findings, a fake
// Transcript Compare run judge, a stored render measurement) - never the
// engine, the provider or the stages.Service.
package proofing

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// proofingCorpusCase is one labeled synthetic scenario: build wires the
// provider (real findings store, real render store, a fake Transcript
// Compare run judge and a fake stored render measurement, per the parent
// task's own instruction to fake only the evidence sources) and label is
// the plain-English judgement a narrator would make of the chapter.
type proofingCorpusCase struct {
	id    string
	label string
	build func(t *testing.T) (*SignalProvider, stages.EvidenceView, string)
	want  stages.Verdict
}

// proofingCorpusService wires the REAL stages.Service over the REAL
// proofing.SignalProvider, with RequiredSignals narrowed by the provider's
// OWN FilterRequired (Q7 B) exactly as production does it
// (apps/desktop/bindings_stages.go's filterRequired) - never a hand-picked
// required set.
func proofingCorpusService(dir string, provider *SignalProvider, view stages.EvidenceView) *stages.Service {
	return stages.NewService(stages.Config{
		Project:        dir,
		LoadManuscript: func() (map[string]any, error) { return map[string]any{"documentId": testDocument}, nil },
		Chapters: func() ([]map[string]any, error) {
			return []map[string]any{{"id": testChapter, "title": "Chapter One", "status": string(stages.StageProofing)}}, nil
		},
		SetChapterStatus: func(string, stages.Stage) error { return nil },
		Providers:        []stages.Provider{provider},
		View:             func(context.Context, string) stages.EvidenceView { return view },
		RequiredSignals: func(_ stages.Stage, declared []string) []string {
			return provider.FilterRequired(declared)
		},
	})
}

func proofingCorpusCases() []proofingCorpusCase {
	return []proofingCorpusCase{
		{
			id: "clean-pickups-no-delivery-check-required",
			label: "narrator would call this chapter ready to finalize: a current Transcript Compare run has " +
				"nothing open, and the project's delivery profile has no measured file rule turned on and no " +
				"render length tolerance set, so no delivery check is required",
			build: func(t *testing.T) (*SignalProvider, stages.EvidenceView, string) {
				t.Helper()
				p := newTestProject(t)
				provider := NewSignalProvider(Config{
					Findings: p.findings,
					Runs:     map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)},
					Profile:  func() deliveryprofile.Profile { return deliveryprofile.Profile{} },
				})
				return provider, p.view(), p.dir
			},
			want: stages.VerdictRecommended,
		},
		{
			id: "open-pickup-blocks",
			label: "narrator would call this chapter not ready: one transcript discrepancy is still open, " +
				"unreviewed, on the Review page",
			build: func(t *testing.T) (*SignalProvider, stages.EvidenceView, string) {
				t.Helper()
				p := newTestProject(t)
				p.save(t, AnalyzerTranscriptCompare, testChapter,
					testFinding("corpus-open", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy))
				provider := NewSignalProvider(Config{
					Findings: p.findings,
					Runs:     map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)},
					Profile:  func() deliveryprofile.Profile { return deliveryprofile.Profile{} },
				})
				return provider, p.view(), p.dir
			},
			want: stages.VerdictNotReady,
		},
		{
			id: "delivery-check-fails-even-with-clean-pickups",
			label: "narrator would call this chapter not ready: pickups are clean, but the chosen render's RMS " +
				"(-30 dBFS) is outside the delivery profile's required -23 to -18 dBFS window",
			build: func(t *testing.T) (*SignalProvider, stages.EvidenceView, string) {
				t.Helper()
				f := newRenderFixture(t)
				f.attest(t, f.render)
				report := reportWith(func(r *measure.Report) { r.RMSdBFS = level(-30) })
				if _, err := RecordRenderMeasurements(f.ledger, f.store, testDocument, f.dir, f.render, *report, "", nil, measuredAt, measuredAt); err != nil {
					t.Fatalf("RecordRenderMeasurements() error = %v", err)
				}
				provider := NewSignalProvider(Config{
					Findings: f.findings,
					Runs:     map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)},
					Renders:  f.store,
					Profile:  func() deliveryprofile.Profile { return testProfile() },
				})
				return provider, f.savedView(), f.dir
			},
			want: stages.VerdictNotReady,
		},
		{
			id: "required-delivery-check-unavailable",
			label: "narrator would call this chapter's proofing status unknown: pickups are clean, but the " +
				"delivery profile requires an RMS check and no rendered file has been chosen or measured yet",
			build: func(t *testing.T) (*SignalProvider, stages.EvidenceView, string) {
				t.Helper()
				p := newTestProject(t)
				provider := NewSignalProvider(Config{
					Findings: p.findings,
					Runs:     map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)},
					Profile:  func() deliveryprofile.Profile { return testProfile() },
				})
				return provider, p.view(), p.dir
			},
			want: stages.VerdictUnknown,
		},
	}
}

// TestStageRecommendationsOverTheProofingCorpus is the proofing-side twin
// of coverage's TestStageRecommendationsOverTheCoverageCorpus: it drives the
// REAL stages.Service, with the REAL proofing.SignalProvider, over a small
// labeled corpus, and asserts the SR verdict agrees with the label. Every
// "true not done" case (not_ready or unknown) must NEVER read recommended -
// the one invariant the whole PRD rests on.
func TestStageRecommendationsOverTheProofingCorpus(t *testing.T) {
	cases := proofingCorpusCases()
	agreed, falseRecommended := 0, 0
	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			provider, view, dir := c.build(t)
			service := proofingCorpusService(dir, provider, view)
			all, err := service.Recommendations(context.Background())
			if err != nil {
				t.Fatalf("Recommendations() error = %v", err)
			}
			got := findProofingRecommendation(t, all, testChapter)
			if got.Verdict != c.want {
				t.Fatalf("%s: verdict = %q (%+v), want %q\nlabel: %s", c.id, got.Verdict, got.Assessment, c.want, c.label)
			}
			if c.want != stages.VerdictRecommended && got.Verdict == stages.VerdictRecommended {
				falseRecommended++
				t.Fatalf("%s: a chapter labeled not done was recommended: %+v", c.id, got.Assessment)
			}
			agreed++
			t.Logf("%s: agreed (%s) - %s", c.id, got.Verdict, c.label)
		})
	}
	t.Logf("proofing corpus: %d/%d cases agreed with the narrator's label, %d false recommended", agreed, len(cases), falseRecommended)
	if falseRecommended != 0 {
		t.Fatalf("false recommended must be 0, got %d", falseRecommended)
	}
}

// findProofingRecommendation mirrors coverage/corpus_test.go's own helper.
func findProofingRecommendation(t *testing.T, all []stages.ChapterRecommendation, chapterID string) stages.ChapterRecommendation {
	t.Helper()
	for _, recommendation := range all {
		if recommendation.ChapterID == chapterID {
			return recommendation
		}
	}
	t.Fatalf("no recommendation for %s in %+v", chapterID, all)
	return stages.ChapterRecommendation{}
}
