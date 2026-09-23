package stages

import (
	"context"
	"errors"
	"slices"
	"testing"
)

// fakeProvider is a Provider whose answer is fixed, recording how it was
// called. It never analyzes anything, like every real provider must not.
type fakeProvider struct {
	stage   Stage
	ids     []string
	signals []Signal
	err     error
	calls   int
	gotCh   ChapterContext
	gotView EvidenceView
}

func (f *fakeProvider) Stage() Stage        { return f.stage }
func (f *fakeProvider) SignalIDs() []string { return f.ids }
func (f *fakeProvider) Signals(_ context.Context, chapter ChapterContext, view EvidenceView) ([]Signal, error) {
	f.calls++
	f.gotCh, f.gotView = chapter, view
	return f.signals, f.err
}

func TestCollectCallsOnlyTheProvidersOfTheChaptersStage(t *testing.T) {
	recording := &fakeProvider{
		stage:   StageRecording,
		ids:     []string{"recording.text"},
		signals: []Signal{signalFor(StageRecording, "text", SignalMet)},
	}
	editing := &fakeProvider{stage: StageEditing, ids: []string{"editing.clicks"}}
	view := EvidenceView{DocumentID: "doc-1", ProjectFolder: "C:/book"}

	got := Collect(context.Background(), []Provider{editing, recording}, chapterAt(StageRecording), view)

	if editing.calls != 0 || recording.calls != 1 {
		t.Fatalf("calls: editing %d, recording %d", editing.calls, recording.calls)
	}
	if recording.gotCh != chapterAt(StageRecording) || recording.gotView.DocumentID != "doc-1" {
		t.Fatalf("provider saw chapter %+v view %+v", recording.gotCh, recording.gotView)
	}
	if len(got) != 1 || got[0].ID != "recording.text" {
		t.Fatalf("signals %+v", got)
	}
}

func TestCollectTurnsAProviderErrorIntoUnknownSignals(t *testing.T) {
	failing := &fakeProvider{
		stage:   StageProofing,
		ids:     []string{"proofing.pickups", "proofing.loudness"},
		signals: []Signal{signalFor(StageProofing, "pickups", SignalMet)},
		err:     errors.New("ledger unreadable"),
	}
	got := Collect(context.Background(), []Provider{failing}, chapterAt(StageProofing), EvidenceView{})

	if len(got) != 2 {
		t.Fatalf("want one unknown per declared id, got %+v", got)
	}
	for _, signal := range got {
		if signal.State != SignalUnknown || signal.Cause != CauseProviderError || signal.Validate() != nil {
			t.Fatalf("a failed provider's partial answer was trusted: %+v", signal)
		}
	}
	if got[0].ID != "proofing.loudness" || got[1].ID != "proofing.pickups" {
		t.Fatalf("signals not sorted by id: %+v", got)
	}
}

func TestCollectNeverCallsAProviderForAStageThatIsNotEvaluated(t *testing.T) {
	for _, stage := range []Stage{StageNotStarted, StageFinalized, Stage("proofed")} {
		provider := &fakeProvider{stage: stage, ids: []string{string(stage) + ".x"}}
		got := Collect(context.Background(), []Provider{provider}, chapterAt(stage), EvidenceView{})
		if provider.calls != 0 || len(got) != 0 || got == nil {
			t.Fatalf("%s: calls %d, signals %+v", stage, provider.calls, got)
		}
	}
}

func TestCollectThenEvaluateWithFakeProviders(t *testing.T) {
	coverage := &fakeProvider{
		stage:   StageRecording,
		ids:     []string{"recording.text"},
		signals: []Signal{signalFor(StageRecording, "text", SignalMet)},
	}
	extra := &fakeProvider{
		stage: StageRecording,
		ids:   []string{"recording.order"},
		err:   errors.New("boom"),
	}
	providers := []Provider{coverage, extra}
	chapter := chapterAt(StageRecording)

	assessment := Evaluate(Input{
		Chapter:  chapter,
		Required: DeclaredSignalIDs(providers, chapter.Status),
		Signals:  Collect(context.Background(), providers, chapter, EvidenceView{}),
	})
	if assessment.Verdict != VerdictUnknown || !slices.Equal(assessment.Causes, []UnknownCause{CauseProviderError}) {
		t.Fatalf("a failing provider must hold the chapter at unknown: %+v", assessment)
	}

	onlyCoverage := Evaluate(Input{
		Chapter:  chapter,
		Required: DeclaredSignalIDs([]Provider{coverage}, chapter.Status),
		Signals:  Collect(context.Background(), []Provider{coverage}, chapter, EvidenceView{}),
	})
	if onlyCoverage.Verdict != VerdictRecommended || onlyCoverage.Target != StageEditing {
		t.Fatalf("all required signals met must recommend editing: %+v", onlyCoverage)
	}
}

func TestDeclaredSignalIDsIsSortedDistinctAndStageScoped(t *testing.T) {
	providers := []Provider{
		&fakeProvider{stage: StageEditing, ids: []string{"editing.clicks", "editing.breaths"}},
		&fakeProvider{stage: StageEditing, ids: []string{"editing.trim", "editing.clicks"}},
		&fakeProvider{stage: StageProofing, ids: []string{"proofing.pickups"}},
	}
	got := DeclaredSignalIDs(providers, StageEditing)
	want := []string{"editing.breaths", "editing.clicks", "editing.trim"}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if none := DeclaredSignalIDs(providers, StageRecording); none == nil || len(none) != 0 {
		t.Fatalf("no providers for a stage is an empty set: %v", none)
	}
}
