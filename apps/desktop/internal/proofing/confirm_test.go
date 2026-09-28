// This file is proofing-readiness-signals.prd.md Phase 7 ("Mark proofing done
// and close-out"): it proves, through the REAL stages.Service and the REAL
// proofing.SignalProvider (never a fake), that "Mark proofing done" going
// through SR's Confirm actually finalizes a proofing chapter, and that the
// proofing signals stay evaluable for that now-confirmed chapter so a later
// change (a fresh open pickup) raises SR's "evidence changed since you
// confirmed" contradiction with a Revert back to proofing. The generic
// mechanism (stages.Service.assess re-evaluating the confirmed-from stage,
// internal/stages/assess.go) already exists and is exercised generically by
// internal/stages/service_test.go's TestAContradictionIsRaisedOnlyByAFreshNotMet;
// this is its proofing-specific twin. Nothing in provider.go branches on
// chapter.Status (see Signals), so no production code changed to make this
// pass - only proof that it holds for the real provider, which
// corpus_test.go's verdict-only assertions never exercised.
package proofing

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/findings"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// confirmFixture is a one-chapter project whose status Confirm and Revert
// actually change, so the round trip can be driven through stages.Service
// exactly as the host binding does (bindings_stages.go's StageConfirm/StageRevert).
type confirmFixture struct {
	project *testProject
	status  stages.Stage
}

func newConfirmFixture(t *testing.T) *confirmFixture {
	t.Helper()
	return &confirmFixture{project: newTestProject(t), status: stages.StageProofing}
}

func (f *confirmFixture) service(provider *SignalProvider) *stages.Service {
	return stages.NewService(stages.Config{
		Project:        f.project.dir,
		LoadManuscript: func() (map[string]any, error) { return map[string]any{"documentId": testDocument}, nil },
		Chapters: func() ([]map[string]any, error) {
			return []map[string]any{{"id": testChapter, "title": "Chapter One", "status": string(f.status)}}, nil
		},
		SetChapterStatus: func(_ string, status stages.Stage) error { f.status = status; return nil },
		Providers:        []stages.Provider{provider},
		View:             func(context.Context, string) stages.EvidenceView { return f.project.view() },
		RequiredSignals: func(_ stages.Stage, declared []string) []string {
			return provider.FilterRequired(declared)
		},
	})
}

// TestMarkProofingDoneConfirmsAndCanBeReverted is the Phase 7 success signal:
// "Confirm writes SR's record with this PRD's basis; a new pickup or an
// edited item after confirm shows the changed-evidence note with revert;
// nothing changes status without the click."
func TestMarkProofingDoneConfirmsAndCanBeReverted(t *testing.T) {
	fixture := newConfirmFixture(t)
	provider := NewSignalProvider(Config{
		Findings: fixture.project.findings,
		Runs:     map[string]RunJudge{AnalyzerTranscriptCompare: currentCompare(false)},
		Profile:  func() deliveryprofile.Profile { return deliveryprofile.Profile{} },
	})
	service := fixture.service(provider)
	ctx := context.Background()

	recommended := recommendationFor(t, service, testChapter)
	if recommended.Verdict != stages.VerdictRecommended || recommended.Target != stages.StageFinalized {
		t.Fatalf("a clean roll-up with no required delivery check must recommend finalized: %+v", recommended.Assessment)
	}
	key := recommended.BasisKey

	// A read alone changes nothing: only the click does.
	if again := recommendationFor(t, service, testChapter); fixture.status != stages.StageProofing || again.Verdict != stages.VerdictRecommended {
		t.Fatalf("a read alone must not change the status: %v", fixture.status)
	}

	confirmed, err := service.Confirm(ctx, testChapter, stages.StageFinalized, key)
	if err != nil {
		t.Fatalf("Confirm() error = %v", err)
	}
	if fixture.status != stages.StageFinalized {
		t.Fatalf("status = %q, want finalized", fixture.status)
	}
	if confirmed.Confirmation == nil || confirmed.Confirmation.From != stages.StageProofing || confirmed.Confirmation.BasisKey != key || confirmed.Confirmation.EvidenceChanged {
		t.Fatalf("confirmed.Confirmation = %+v", confirmed.Confirmation)
	}
	if confirmed.Contradiction != nil {
		t.Fatalf("a fresh confirm must not contradict itself: %+v", confirmed.Contradiction)
	}

	// A new open pickup after the confirm. This re-runs the SAME real
	// SignalProvider, unmodified for the change: proofing signals are
	// "callable for a confirmed chapter" (Phase 7's own words) because
	// nothing in it special-cases the current chapter.Status.
	fixture.project.save(t, AnalyzerTranscriptCompare, testChapter,
		testFinding("post-confirm-pickup", AnalyzerTranscriptCompare, testChapter, findings.CategoryTranscriptDiscrepancy))

	contradicted := recommendationFor(t, service, testChapter)
	if fixture.status != stages.StageFinalized {
		t.Fatalf("evidence changing on its own must not change the status: %q", fixture.status)
	}
	if contradicted.Confirmation == nil || !contradicted.Confirmation.EvidenceChanged {
		t.Fatalf("contradicted.Confirmation = %+v, want EvidenceChanged", contradicted.Confirmation)
	}
	if contradicted.Contradiction == nil || contradicted.Contradiction.RevertTo != stages.StageProofing {
		t.Fatalf("contradicted.Contradiction = %+v, want revertTo proofing", contradicted.Contradiction)
	}
	found := false
	for _, signal := range contradicted.Contradiction.Signals {
		found = found || (signal.ID == PickupsSignalID && signal.State == stages.SignalNotMet)
	}
	if !found {
		t.Fatalf("the new pickup must appear in the contradiction's signals: %+v", contradicted.Contradiction.Signals)
	}

	reverted, err := service.Revert(ctx, testChapter)
	if err != nil {
		t.Fatalf("Revert() error = %v", err)
	}
	if fixture.status != stages.StageProofing {
		t.Fatalf("status after revert = %q, want proofing", fixture.status)
	}
	if reverted.Confirmation != nil || reverted.Contradiction != nil {
		t.Fatalf("a revert retires the confirmation: %+v", reverted)
	}
	if reverted.Verdict != stages.VerdictNotReady {
		t.Fatalf("back in proofing, the open pickup makes it not ready again: %+v", reverted.Assessment)
	}
}

// recommendationFor mirrors corpus_test.go's findProofingRecommendation, but
// against a live *stages.Service rather than a pre-computed slice.
func recommendationFor(t *testing.T, service *stages.Service, chapterID string) stages.ChapterRecommendation {
	t.Helper()
	all, err := service.Recommendations(context.Background())
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	return findProofingRecommendation(t, all, chapterID)
}
