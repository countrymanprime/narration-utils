package editing

import (
	"context"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

func chapterContext() stages.ChapterContext {
	return stages.ChapterContext{DocumentID: "doc-1", ChapterID: "chapter-1", Title: "Chapter One", Status: stages.StageEditing}
}

func evidenceView(svc *testService) stages.EvidenceView {
	project, err := tracks.Parse(svc.rppPath)
	if err != nil {
		panic(err)
	}
	return stages.EvidenceView{DocumentID: "doc-1", ProjectFolder: svc.dir, Project: project, Ledger: svc.ledger, Mapping: svc.mapping}
}

// TestSignalProviderDeclaresStageAndIDs is the contract shape SR's engine
// reads (Collect/DeclaredSignalIDs).
func TestSignalProviderDeclaresStageAndIDs(t *testing.T) {
	provider := NewSignalProvider(nil)
	if provider.Stage() != stages.StageEditing {
		t.Fatalf("Stage() = %q, want %q", provider.Stage(), stages.StageEditing)
	}
	ids := provider.SignalIDs()
	want := []string{EmptySpaceSignalID, ClickSignalID, BreathSignalID}
	if len(ids) != len(want) {
		t.Fatalf("SignalIDs() = %v, want %v", ids, want)
	}
	for _, id := range want {
		if !containsString(ids, id) {
			t.Fatalf("SignalIDs() = %v, missing %q", ids, id)
		}
	}
}

// TestSignalProviderUnknownBeforeAnyScan proves a never-analyzed chapter's
// three signals are all unknown - never met, never a crash - before Phase
// 5's job has ever run.
func TestSignalProviderUnknownBeforeAnyScan(t *testing.T) {
	svc := newTestService(t)
	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapterContext(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	if len(signals) != 3 {
		t.Fatalf("Signals() = %d signals, want 3", len(signals))
	}
	for _, signal := range signals {
		if signal.State != stages.SignalUnknown {
			t.Fatalf("signal %s state = %q, want %q", signal.ID, signal.State, stages.SignalUnknown)
		}
		if err := signal.Validate(); err != nil {
			t.Fatalf("signal %s failed Validate(): %v", signal.ID, err)
		}
	}
}

// TestSignalProviderMetAfterACleanScan is Phase 6's own end-to-end proof:
// after a scan finds no candidates (a maximum gap wide enough that the 3 s
// gap between the fixture's two items does not cross it), the empty-space
// signal reads met, and the click/breath signals still never do.
func TestSignalProviderMetAfterACleanScan(t *testing.T) {
	svc := newTestService(t)
	wideGap := 10.0
	svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &wideGap} }
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()
	if got := svc.State().Phase; got != PhaseComplete {
		t.Fatalf("scan phase = %q, want %q", got, PhaseComplete)
	}

	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapterContext(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	byID := map[string]stages.Signal{}
	for _, signal := range signals {
		byID[signal.ID] = signal
	}
	if got := byID[EmptySpaceSignalID].State; got != stages.SignalMet {
		t.Fatalf("empty-space signal state = %q, want %q (reason: %s)", got, stages.SignalMet, byID[EmptySpaceSignalID].Reason)
	}
	for _, id := range []string{ClickSignalID, BreathSignalID} {
		if got := byID[id].State; got != stages.SignalUnknown {
			t.Fatalf("%s state = %q, want %q (never met, Phase 4 not run)", id, got, stages.SignalUnknown)
		}
	}
}

// TestSignalProviderNotMetAfterAScanWithCandidates mirrors
// TestServiceFindsEmptySpace but through the signal itself: a tight maximum
// gap crosses the fixture's 3 s inter-item gap, so the empty-space signal
// must read not_met once the scan has run.
func TestSignalProviderNotMetAfterAScanWithCandidates(t *testing.T) {
	svc := newTestService(t)
	tightGap := 1.0
	svc.config.Policy = func() Policy { return Policy{MaxGapSeconds: &tightGap} }
	if _, err := svc.Start(context.Background(), Request{DocumentID: "doc-1", ChapterID: "chapter-1", ChapterTitle: "Chapter One"}); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	svc.Wait()

	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapterContext(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	var emptySpace stages.Signal
	for _, signal := range signals {
		if signal.ID == EmptySpaceSignalID {
			emptySpace = signal
		}
	}
	if emptySpace.State != stages.SignalNotMet {
		t.Fatalf("empty-space signal state = %q, want %q (reason: %s)", emptySpace.State, stages.SignalNotMet, emptySpace.Reason)
	}
}

// TestSignalProviderUnmapped proves the D5 gate at the provider level: a
// chapter with no confirmed track answers unknown, not a crash and not met.
// This fixture's one track happens to be named exactly the chapter's own
// title ("Chapter One"), so once unlinked it reads as an unconfirmed
// suggestion (CauseUnconfirmedMapping) rather than a plain CauseUnmappedTrack
// - itself a real case this test is glad to exercise, since D5 says an
// unconfirmed fuzzy match is still unknown, just with a different action.
func TestSignalProviderUnmapped(t *testing.T) {
	svc := newTestService(t)
	if err := svc.mapping.Clear("doc-1", "track-1"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	provider := NewSignalProvider(svc.Service)
	signals, err := provider.Signals(context.Background(), chapterContext(), evidenceView(svc))
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	var emptySpace stages.Signal
	for _, signal := range signals {
		if signal.ID == EmptySpaceSignalID {
			emptySpace = signal
		}
	}
	if emptySpace.State != stages.SignalUnknown {
		t.Fatalf("state = %q, want %q", emptySpace.State, stages.SignalUnknown)
	}
	if emptySpace.Cause != stages.CauseUnconfirmedMapping && emptySpace.Cause != stages.CauseUnmappedTrack {
		t.Fatalf("cause = %q, want %s or %s", emptySpace.Cause, stages.CauseUnconfirmedMapping, stages.CauseUnmappedTrack)
	}
}

// TestSignalProviderProjectUnreadable proves the view.ProjectErr branch
// answers all three signals unknown rather than erroring the whole
// evaluation - a provider failing outright would cost every OTHER stage's
// signals too (Collect's own per-provider isolation), so this path is worth
// its own direct test. The empty-space signal names the real cause
// (CauseProjectUnreadable); the click/breath signals always give the same
// unvalidated-detector reason regardless of context (Q5) - itself never
// met, whatever else is also true about the project.
func TestSignalProviderProjectUnreadable(t *testing.T) {
	provider := NewSignalProvider(&Service{})
	view := stages.EvidenceView{ProjectErr: errUnreadableFixture}
	signals, err := provider.Signals(context.Background(), chapterContext(), view)
	if err != nil {
		t.Fatalf("Signals() error = %v", err)
	}
	for _, signal := range signals {
		if signal.State != stages.SignalUnknown {
			t.Fatalf("signal %s state = %q, want %q", signal.ID, signal.State, stages.SignalUnknown)
		}
		if signal.ID == EmptySpaceSignalID && signal.Cause != stages.CauseProjectUnreadable {
			t.Fatalf("empty-space signal cause = %q, want %q", signal.Cause, stages.CauseProjectUnreadable)
		}
	}
}

var errUnreadableFixture = errNamed("could not read the saved project")

type errNamed string

func (e errNamed) Error() string { return string(e) }
