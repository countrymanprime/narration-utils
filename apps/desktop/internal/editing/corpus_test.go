// This file is Phase 9 of chapter-stage-recommendations.prd.md (delivered and deleted; see
// docs/architecture/stage-recommendations.md)
// ("Secondary surfaces and close-out"): an end-to-end validation of the SR
// verdict for editing->proofing, mirroring
// apps/desktop/internal/coverage/corpus_test.go's architecture (a small
// labeled corpus, the REAL stages.Service driving the REAL editing
// SignalProvider, an assertion the verdict agrees with the label) rather
// than reusing its files, since editing-readiness-analysis.prd.md's own
// Phase 1 (a real annotated audio corpus) still needs permissioned material
// nobody has yet.
//
// PROVISIONAL (D70/D71, see docs/research/editing-and-proofing-corpus.md):
// this is a synthetic, signal-level stand-in, not the real ER corpus. Only
// the underlying evidence sources are faked here - a scan job's own findings
// and, where a real detector does not exist yet (clicks/breaths, gated
// behind Phase 4's corpus validation), a directly-written finding standing
// in for one - never the engine, the provider or the stages.Service.
package editing

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// editingCorpusCase is one labeled synthetic scenario: build is what a
// narrator did in REAPER and to the editing check, required narrows the
// stage's required-signal set the way SR's own settings would (nil keeps
// the production default: every declared signal required), and label is
// the plain-English judgement a narrator would make of the chapter.
type editingCorpusCase struct {
	id       string
	label    string
	build    func(t *testing.T) *testService
	required func(stage stages.Stage, declared []string) []string
	want     stages.Verdict
}

// editingCorpusEditingChapter is the one chapter every case evaluates.
const editingCorpusChapter = "chapter-1"

// deselectClickAndBreath simulates a narrator who has turned off the click
// and breath required checks in SR's settings (ER PRD Phase 6, Q5's
// recommendation: "A narrator who deselects [clicks and breaths] in SR can
// still get an empty-space recommendation" - the documented, intended path
// to a recommended verdict before Phase 4 ever validates those two
// detectors). It is not a workaround invented for this test: it is the
// production RequiredSignals mechanism (apps/desktop/bindings_stages.go's
// requiredStageSignals), narrowed here exactly as a narrator's own choice
// would narrow it.
func deselectClickAndBreath(stage stages.Stage, declared []string) []string {
	if stage != stages.StageEditing {
		return declared
	}
	return []string{EmptySpaceSignalID}
}

// syntheticCandidateFinding stands in for a click or breath candidate. No
// real detector for these classes exists yet in this build (Phase 4 of
// editing-readiness-analysis.prd.md is pending; scan.go's composeAndPersist
// only ever persists "silence" findings), so this is written directly to
// the findings store - the fake evidence source the parent task calls for -
// rather than through a scan. It never changes the click/breath SIGNAL
// state, which stays unknown regardless (Q5/D22): it only exercises
// gatherCandidates' click/breath evidence branches.
func syntheticCandidateFinding(id, chapterID, class string) findings.Finding {
	return findings.Finding{
		SchemaVersion: findings.SchemaVersion,
		ID:            id,
		Analyzer:      analyzerName,
		Category:      findings.CategorySilenceCleanup,
		Severity:      findings.SeverityInfo,
		Manuscript:    &findings.Manuscript{ChapterID: chapterID, ChapterTitle: "Chapter One"},
		Evidence:      map[string]any{"class": class},
		Review:        findings.ReviewState{Status: findings.StatusUnreviewed},
	}
}

// editingCorpusService wires the REAL stages.Service over svc's REAL
// SignalProvider, following coverage/corpus_test.go's own pattern: one
// narration chapter at StageEditing, no manuscript or decisions machinery
// beyond what the engine needs.
func editingCorpusService(svc *testService, required func(stages.Stage, []string) []string) *stages.Service {
	view := evidenceView(svc)
	return stages.NewService(stages.Config{
		Project:        svc.dir,
		LoadManuscript: func() (map[string]any, error) { return map[string]any{"documentId": "doc-1"}, nil },
		Chapters: func() ([]map[string]any, error) {
			return []map[string]any{{"id": editingCorpusChapter, "title": "Chapter One", "status": string(stages.StageEditing)}}, nil
		},
		SetChapterStatus: func(string, stages.Stage) error { return nil },
		Providers:        []stages.Provider{NewSignalProvider(svc.Service)},
		View:             func(context.Context, string) stages.EvidenceView { return view },
		RequiredSignals:  required,
	})
}

func editingCorpusCases() []editingCorpusCase {
	return []editingCorpusCase{
		{
			id: "clean-scan-clicks-and-breaths-deselected",
			label: "narrator would call this chapter done editing: both items are current at a 10 s maximum gap and " +
				"the 3 s inter-item gap never crosses it, so no empty-space candidate is open; the narrator has " +
				"deselected clicks and breaths in SR settings pending Phase 4's corpus validation",
			build: func(t *testing.T) *testService {
				t.Helper()
				svc := newTestService(t)
				wideGap := 10.0
				svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &wideGap} }
				if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: editingCorpusChapter, ChapterTitle: "Chapter One"}); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
				svc.Wait()
				return svc
			},
			required: deselectClickAndBreath,
			want:     stages.VerdictRecommended,
		},
		{
			id: "clean-scan-default-required-set",
			label: "the same clean chapter as above, but under SR's production DEFAULT required set (every " +
				"declared signal required, unchanged): it must read unknown, never recommended, because clicks and " +
				"breaths are gated behind Phase 4's corpus validation and can never report met (Q5/D22) - " +
				"documenting that 'recommended' is unreachable for editing today without a narrator's own " +
				"required-check choice",
			build: func(t *testing.T) *testService {
				t.Helper()
				svc := newTestService(t)
				wideGap := 10.0
				svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &wideGap} }
				if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: editingCorpusChapter, ChapterTitle: "Chapter One"}); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
				svc.Wait()
				return svc
			},
			required: nil,
			want:     stages.VerdictUnknown,
		},
		{
			id: "open-candidate-in-every-class",
			label: "narrator would call this chapter not done editing: the 3 s gap between the two items crosses " +
				"a 1 s maximum gap (an open empty-space candidate), plus an open click candidate and an open " +
				"breath candidate still awaiting review",
			build: func(t *testing.T) *testService {
				t.Helper()
				svc := newTestService(t)
				tightGap := 1.0
				svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &tightGap} }
				if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: editingCorpusChapter, ChapterTitle: "Chapter One"}); err != nil {
					t.Fatalf("Start() error = %v", err)
				}
				svc.Wait()
				// Additive: MergeAnalyzerFindings (unlike SaveAnalyzerFindings) never
				// marks a stored finding of the same scope NotInLatestRun, so the
				// scan's own "silence" finding (composeAndPersist, above) stays open
				// exactly as the scan left it.
				if _, err := svc.findings.MergeAnalyzerFindings(analyzerName, editingCorpusChapter, []findings.Finding{
					syntheticCandidateFinding("corpus-click-1", editingCorpusChapter, "click"),
					syntheticCandidateFinding("corpus-breath-1", editingCorpusChapter, "breath"),
				}); err != nil {
					t.Fatalf("MergeAnalyzerFindings() error = %v", err)
				}
				return svc
			},
			required: nil,
			want:     stages.VerdictNotReady,
		},
		{
			id:    "never-analyzed",
			label: "narrator would call this chapter's editing status unknown: it has never been checked at all",
			build: func(t *testing.T) *testService {
				t.Helper()
				return newTestService(t)
			},
			required: nil,
			want:     stages.VerdictUnknown,
		},
	}
}

// TestStageRecommendationsOverTheEditingCorpus is the editing-side twin of
// coverage's TestStageRecommendationsOverTheCoverageCorpus: it drives the
// REAL stages.Service, with the REAL editing.SignalProvider on top of a
// REAL editing.Service (a real scan job, a real cache and ledger, a real
// findings store), over a small labeled corpus, and asserts the SR verdict
// agrees with the label. Every "true not done" case (not_ready or unknown)
// must NEVER read recommended - the one invariant the whole PRD rests on.
func TestStageRecommendationsOverTheEditingCorpus(t *testing.T) {
	cases := editingCorpusCases()
	agreed, falseRecommended := 0, 0
	for _, c := range cases {
		t.Run(c.id, func(t *testing.T) {
			svc := c.build(t)
			service := editingCorpusService(svc, c.required)
			all, err := service.Recommendations(context.Background())
			if err != nil {
				t.Fatalf("Recommendations() error = %v", err)
			}
			got := findRecommendation(t, all, editingCorpusChapter)
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
	t.Logf("editing corpus: %d/%d cases agreed with the narrator's label, %d false recommended", agreed, len(cases), falseRecommended)
	if falseRecommended != 0 {
		t.Fatalf("false recommended must be 0, got %d", falseRecommended)
	}
}

// findRecommendation mirrors coverage/corpus_test.go's own helper.
func findRecommendation(t *testing.T, all []stages.ChapterRecommendation, chapterID string) stages.ChapterRecommendation {
	t.Helper()
	for _, recommendation := range all {
		if recommendation.ChapterID == chapterID {
			return recommendation
		}
	}
	t.Fatalf("no recommendation for %s in %+v", chapterID, all)
	return stages.ChapterRecommendation{}
}
