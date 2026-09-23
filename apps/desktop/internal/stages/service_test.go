package stages

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"
)

// fakeManuscript stands in for manuscript.Service: the canonical manuscript's
// document id, its chapters with their stored statuses, and the status path.
type fakeManuscript struct {
	documentID  string
	chapters    []map[string]any
	statusErr   error
	loadErr     error
	chaptersErr error
	writes      int
}

func newFakeManuscript() *fakeManuscript {
	return &fakeManuscript{
		documentID: "doc-1",
		chapters: []map[string]any{
			{"id": "c-0001", "title": "Front Matter", "contentKind": "front_matter", "status": "recording"},
			{"id": "c-0002", "title": "Chapter One", "contentKind": "narration", "status": "recording"},
			{"id": "c-0003", "title": "Chapter Two", "status": "not_started"},
		},
	}
}

func (f *fakeManuscript) load() (map[string]any, error) {
	if f.loadErr != nil {
		return nil, f.loadErr
	}
	return map[string]any{"documentId": f.documentID}, nil
}

func (f *fakeManuscript) list() ([]map[string]any, error) { return f.chapters, f.chaptersErr }

func (f *fakeManuscript) setStatus(chapterID string, status Stage) error {
	f.writes++
	if f.statusErr != nil {
		return f.statusErr
	}
	for _, chapter := range f.chapters {
		if chapter["id"] == chapterID {
			chapter["status"] = string(status)
		}
	}
	return nil
}

func (f *fakeManuscript) status(chapterID string) Stage {
	for _, chapter := range f.chapters {
		if chapter["id"] == chapterID {
			return Stage(chapter["status"].(string))
		}
	}
	return ""
}

// stageProviders answers every chapter with one signal per stage, whose state
// and fingerprint the test changes between calls.
type stageProviders struct {
	recording, editing *fakeProvider
}

func newStageProviders() *stageProviders {
	return &stageProviders{
		recording: &fakeProvider{stage: StageRecording, ids: []string{"recording.text"}, signals: []Signal{signalFor(StageRecording, "text", SignalMet)}},
		editing:   &fakeProvider{stage: StageEditing, ids: []string{"editing.clicks"}, signals: []Signal{signalFor(StageEditing, "clicks", SignalUnknown)}},
	}
}

func (p *stageProviders) all() []Provider { return []Provider{p.recording, p.editing} }

func setRecording(p *stageProviders, state SignalState, fingerprint string) {
	signal := signalFor(StageRecording, "text", state)
	signal.Basis.Fingerprint = fingerprint
	p.recording.signals = []Signal{signal}
}

var testNow = time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)

func newTestService(t *testing.T, manuscript *fakeManuscript, providers *stageProviders) (*Service, string) {
	t.Helper()
	project := t.TempDir()
	return NewService(Config{
		Project:          project,
		LoadManuscript:   manuscript.load,
		Chapters:         manuscript.list,
		SetChapterStatus: manuscript.setStatus,
		Providers:        providers.all(),
		Now:              func() time.Time { return testNow },
	}), project
}

func recommendationFor(t *testing.T, service *Service, chapterID string) ChapterRecommendation {
	t.Helper()
	all, err := service.Recommendations(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, recommendation := range all {
		if recommendation.ChapterID == chapterID {
			return recommendation
		}
	}
	t.Fatalf("no recommendation for %s in %+v", chapterID, all)
	return ChapterRecommendation{}
}

func TestRecommendationsCoverNarrationChaptersOnly(t *testing.T) {
	service, _ := newTestService(t, newFakeManuscript(), newStageProviders())
	all, err := service.Recommendations(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || all[0].ChapterID != "c-0002" || all[1].ChapterID != "c-0003" {
		t.Fatalf("recommendations %+v; want the two narration chapters (an empty kind is narration)", all)
	}
	if all[0].Verdict != VerdictRecommended || all[0].Target != StageEditing || all[0].Title != "Chapter One" {
		t.Fatalf("chapter one %+v", all[0])
	}
	if all[1].Verdict != VerdictNone || all[1].NoneReason != NoneStageNotEvaluated {
		t.Fatalf("not_started chapter %+v", all[1])
	}
}

func TestRecommendationsReportAMissingManuscript(t *testing.T) {
	manuscript := newFakeManuscript()
	manuscript.loadErr = errors.New("import a manuscript first")
	service, _ := newTestService(t, manuscript, newStageProviders())
	if _, err := service.Recommendations(context.Background()); err == nil {
		t.Fatal("no manuscript read as no chapters")
	}
	manuscript.loadErr, manuscript.documentID = nil, ""
	if _, err := service.Recommendations(context.Background()); err == nil {
		t.Fatal("a manuscript without a document id was evaluated")
	}
}

func TestRecommendationsReportACorruptDecisionsFile(t *testing.T) {
	service, project := newTestService(t, newFakeManuscript(), newStageProviders())
	writeRaw(t, project, "{broken")
	if _, err := service.Recommendations(context.Background()); err == nil {
		t.Fatal("a corrupt decisions file was read as no decisions")
	}
}

func TestRecommendationsBuildTheEvidenceViewOncePerEvaluation(t *testing.T) {
	manuscript := newFakeManuscript()
	manuscript.chapters[2]["status"] = "recording"
	providers := newStageProviders()
	views := 0
	service := NewService(Config{
		Project: t.TempDir(), LoadManuscript: manuscript.load, Chapters: manuscript.list, SetChapterStatus: manuscript.setStatus,
		Providers: providers.all(),
		View: func(_ context.Context, documentID string) EvidenceView {
			views++
			return EvidenceView{DocumentID: documentID, ProjectFolder: "one-view"}
		},
	})
	if _, err := service.Recommendations(context.Background()); err != nil {
		t.Fatal(err)
	}
	if views != 1 || providers.recording.calls != 2 || providers.recording.gotView.ProjectFolder != "one-view" {
		t.Fatalf("views %d, provider calls %d, view %+v", views, providers.recording.calls, providers.recording.gotView)
	}
}

func TestConfirmSetsTheStatusAndRecordsTheBasis(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")

	got, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if err != nil {
		t.Fatal(err)
	}
	if manuscript.status("c-0002") != StageEditing {
		t.Fatalf("status %q after Confirm", manuscript.status("c-0002"))
	}
	if got.From != StageEditing || got.Confirmation == nil || got.Confirmation.From != StageRecording || got.Confirmation.Target != StageEditing {
		t.Fatalf("after Confirm %+v", got)
	}
	decisions, _ := service.store.List("doc-1")
	if len(decisions) != 1 {
		t.Fatalf("decisions %+v", decisions)
	}
	recorded := decisions[0]
	if recorded.Kind != DecisionConfirmed || recorded.BasisKey != shown.BasisKey || !recorded.At.Equal(testNow) {
		t.Fatalf("recorded %+v", recorded)
	}
	if len(recorded.Basis) != 1 || recorded.Basis[0].ID != "recording.text" || recorded.Basis[0].Fingerprint != "fp-text" || recorded.Basis[0].Summary == "" {
		t.Fatalf("recorded basis %+v", recorded.Basis)
	}
}

func TestConfirmRefusesWhenTheBasisChanged(t *testing.T) {
	manuscript := newFakeManuscript()
	providers := newStageProviders()
	service, project := newTestService(t, manuscript, providers)
	shown := recommendationFor(t, service, "c-0002")
	setRecording(providers, SignalMet, "fp-after-a-new-take")

	_, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if !errors.Is(err, ErrBasisChanged) {
		t.Fatalf("Confirm error %v, want ErrBasisChanged", err)
	}
	if manuscript.writes != 0 || manuscript.status("c-0002") != StageRecording {
		t.Fatal("a refused Confirm changed the status")
	}
	if _, statErr := os.Stat(DecisionsFile(project)); !os.IsNotExist(statErr) {
		t.Fatal("a refused Confirm wrote a decision")
	}
	if _, err := service.Confirm(context.Background(), "c-0002", StageProofing, shown.BasisKey); !errors.Is(err, ErrBasisChanged) {
		t.Fatalf("Confirm for another target: %v", err)
	}
}

func TestConfirmRefusesWhatIsNotRecommended(t *testing.T) {
	providers := newStageProviders()
	setRecording(providers, SignalNotMet, "fp-text")
	service, _ := newTestService(t, newFakeManuscript(), providers)
	shown := recommendationFor(t, service, "c-0002")
	if shown.Verdict != VerdictNotReady {
		t.Fatalf("verdict %q", shown.Verdict)
	}
	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey); !errors.Is(err, ErrNotRecommended) {
		t.Fatalf("Confirm of a not_ready chapter: %v", err)
	}
	if _, err := service.Confirm(context.Background(), "c-9999", StageEditing, shown.BasisKey); err == nil {
		t.Fatal("Confirm of an unknown chapter succeeded")
	}
	if _, err := service.Confirm(context.Background(), "c-0001", StageEditing, shown.BasisKey); err == nil {
		t.Fatal("Confirm of a front-matter chapter succeeded")
	}
}

func TestConfirmRollsBackTheRecordWhenTheStatusWriteFails(t *testing.T) {
	manuscript := newFakeManuscript()
	service, project := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	manuscript.statusErr = errors.New("disk full")

	_, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if err == nil || !errors.Is(err, manuscript.statusErr) {
		t.Fatalf("Confirm error %v, want the status failure", err)
	}
	decisions, listErr := NewDecisionStore(project, nil).List("doc-1")
	if listErr != nil || len(decisions) != 0 {
		t.Fatalf("the record was not rolled back: %+v, %v", decisions, listErr)
	}
	if again := recommendationFor(t, service, "c-0002"); again.Verdict != VerdictRecommended || again.Confirmation != nil {
		t.Fatalf("after a failed Confirm %+v", again)
	}
}

// A crash after the record is written and before the status is set leaves a
// confirmation whose target is not the chapter's status: it is ignored, and
// the suggestion can be confirmed again.
func TestACrashBetweenTheTwoWritesLeavesAnIgnoredRecord(t *testing.T) {
	manuscript := newFakeManuscript()
	service, project := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	orphan := Decision{ChapterID: "c-0002", Kind: DecisionConfirmed, From: StageRecording, Target: StageEditing, BasisKey: shown.BasisKey, Basis: []SignalBasis{}, At: testNow}
	if err := NewDecisionStore(project, nil).Append("doc-1", orphan); err != nil {
		t.Fatal(err)
	}

	after := recommendationFor(t, service, "c-0002")
	if after.Verdict != VerdictRecommended || after.Confirmation != nil || after.Contradiction != nil {
		t.Fatalf("the orphaned record was trusted: %+v", after)
	}
	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, after.BasisKey); err != nil {
		t.Fatalf("confirming again after a crash: %v", err)
	}
	if manuscript.status("c-0002") != StageEditing {
		t.Fatal("status not set by the second Confirm")
	}
}

func TestAManualStatusChangeRetiresTheConfirmation(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey); err != nil {
		t.Fatal(err)
	}
	// The narrator moves the chapter on with the <select>, which writes no record.
	if err := manuscript.setStatus("c-0002", StageProofing); err != nil {
		t.Fatal(err)
	}

	after := recommendationFor(t, service, "c-0002")
	if after.Confirmation != nil || after.Contradiction != nil {
		t.Fatalf("a confirmation outlived a manual status change: %+v", after)
	}
	if _, err := service.Revert(context.Background(), "c-0002"); !errors.Is(err, ErrNothingToRevert) {
		t.Fatalf("Revert after a manual change: %v", err)
	}
}

func TestDismissHidesTheSuggestionUntilItsBasisChanges(t *testing.T) {
	manuscript := newFakeManuscript()
	providers := newStageProviders()
	service, _ := newTestService(t, manuscript, providers)
	shown := recommendationFor(t, service, "c-0002")

	got, err := service.Dismiss(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if err != nil {
		t.Fatal(err)
	}
	if got.Verdict != VerdictDismissed || manuscript.writes != 0 {
		t.Fatalf("after Dismiss %+v (status writes %d)", got, manuscript.writes)
	}
	// A re-save with the same fingerprints keeps it dismissed.
	providers.recording.signals[0].Basis.ProjectFileModTime = testNow
	if again := recommendationFor(t, service, "c-0002"); again.Verdict != VerdictDismissed {
		t.Fatalf("a re-save brought the suggestion back: %+v", again)
	}
	if _, err := service.Dismiss(context.Background(), "c-0002", StageEditing, shown.BasisKey); err != nil {
		t.Fatalf("dismissing twice: %v", err)
	}
	if decisions, _ := service.store.List("doc-1"); len(decisions) != 1 {
		t.Fatalf("a repeat Dismiss wrote again: %+v", decisions)
	}

	setRecording(providers, SignalMet, "fp-new-evidence")
	if back := recommendationFor(t, service, "c-0002"); back.Verdict != VerdictRecommended {
		t.Fatalf("new evidence did not bring the suggestion back: %+v", back)
	}
}

func TestDismissRefusesAChangedBasisOrNoSuggestion(t *testing.T) {
	providers := newStageProviders()
	service, _ := newTestService(t, newFakeManuscript(), providers)
	shown := recommendationFor(t, service, "c-0002")
	if _, err := service.Dismiss(context.Background(), "c-0002", StageEditing, "stale-key"); !errors.Is(err, ErrBasisChanged) {
		t.Fatalf("Dismiss with a stale key: %v", err)
	}
	setRecording(providers, SignalUnknown, "fp-text")
	unknown := recommendationFor(t, service, "c-0002")
	if _, err := service.Dismiss(context.Background(), "c-0002", StageEditing, unknown.BasisKey); !errors.Is(err, ErrNotRecommended) {
		t.Fatalf("Dismiss of an unknown verdict: %v (shown key %s)", err, shown.BasisKey)
	}
}

func TestAConfirmedDismissalCanStillBeConfirmed(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	if _, err := service.Dismiss(context.Background(), "c-0002", StageEditing, shown.BasisKey); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey); err != nil {
		t.Fatalf("confirming a dismissed suggestion: %v", err)
	}
	if manuscript.status("c-0002") != StageEditing {
		t.Fatal("status not set")
	}
}

func confirmChapterOne(t *testing.T, service *Service) ChapterRecommendation {
	t.Helper()
	shown := recommendationFor(t, service, "c-0002")
	confirmed, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if err != nil {
		t.Fatal(err)
	}
	return confirmed
}

// Q10 B: only a fresh not_met of the signals that justified a confirmation
// raises the notice; stale evidence alone is shown quietly.
func TestAContradictionIsRaisedOnlyByAFreshNotMet(t *testing.T) {
	manuscript := newFakeManuscript()
	providers := newStageProviders()
	service, _ := newTestService(t, manuscript, providers)
	confirmChapterOne(t, service)

	if quiet := recommendationFor(t, service, "c-0002"); quiet.Contradiction != nil || quiet.Confirmation == nil || quiet.Confirmation.EvidenceChanged {
		t.Fatalf("unchanged evidence: %+v", quiet)
	}

	stale := UnknownSignal("recording.text", StageRecording, CauseStale, "the chapter was edited")
	providers.recording.signals = []Signal{stale}
	edited := recommendationFor(t, service, "c-0002")
	if edited.Contradiction != nil {
		t.Fatalf("stale evidence alone raised the notice: %+v", edited.Contradiction)
	}
	if edited.Confirmation == nil || !edited.Confirmation.EvidenceChanged {
		t.Fatalf("stale evidence is not shown as changed: %+v", edited.Confirmation)
	}

	setRecording(providers, SignalNotMet, "fp-paragraph-deleted")
	contradicted := recommendationFor(t, service, "c-0002")
	if contradicted.Contradiction == nil || contradicted.Contradiction.RevertTo != StageRecording {
		t.Fatalf("a fresh not_met raised no notice: %+v", contradicted)
	}
	if len(contradicted.Contradiction.Signals) != 1 || contradicted.Contradiction.Signals[0].State != SignalNotMet {
		t.Fatalf("notice signals %+v", contradicted.Contradiction.Signals)
	}
	if manuscript.status("c-0002") != StageEditing {
		t.Fatal("a contradiction changed the status by itself")
	}
}

func TestRevertRestoresThePreviousStageAndRetiresTheConfirmation(t *testing.T) {
	manuscript := newFakeManuscript()
	providers := newStageProviders()
	service, _ := newTestService(t, manuscript, providers)
	confirmed := confirmChapterOne(t, service)
	setRecording(providers, SignalNotMet, "fp-paragraph-deleted")

	got, err := service.Revert(context.Background(), "c-0002")
	if err != nil {
		t.Fatal(err)
	}
	if manuscript.status("c-0002") != StageRecording || got.From != StageRecording || got.Confirmation != nil || got.Contradiction != nil {
		t.Fatalf("after Revert: status %q, %+v", manuscript.status("c-0002"), got)
	}
	decisions, _ := service.store.List("doc-1")
	last := decisions[len(decisions)-1]
	if last.Kind != DecisionReverted || last.From != StageEditing || last.Target != StageRecording || last.BasisKey != confirmed.Confirmation.BasisKey {
		t.Fatalf("revert record %+v", last)
	}
	if _, err := service.Revert(context.Background(), "c-0002"); !errors.Is(err, ErrNothingToRevert) {
		t.Fatalf("a second Revert: %v", err)
	}
}

func TestRevertRollsBackItsRecordWhenTheStatusWriteFails(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	confirmChapterOne(t, service)
	manuscript.statusErr = errors.New("locked")

	if _, err := service.Revert(context.Background(), "c-0002"); err == nil {
		t.Fatal("Revert reported success after the status write failed")
	}
	decisions, _ := service.store.List("doc-1")
	if len(decisions) != 1 || decisions[0].Kind != DecisionConfirmed {
		t.Fatalf("the revert record was not rolled back: %+v", decisions)
	}
	manuscript.statusErr = nil
	if still := recommendationFor(t, service, "c-0002"); still.Confirmation == nil {
		t.Fatal("the confirmation was lost by a failed Revert")
	}
}

// Decisions kept for a previous import never apply after a re-import, even if
// resetDerived did not get to clear the file.
func TestDecisionsFromAPreviousImportAreIgnored(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	confirmChapterOne(t, service)

	manuscript.documentID = "doc-2"
	after := recommendationFor(t, service, "c-0002")
	if after.Confirmation != nil {
		t.Fatalf("a previous import's confirmation applied: %+v", after)
	}
}

// With the real clock, a decision's time has nanoseconds; the record written
// before a failed status write must still be found and taken back after its
// JSON round trip.
func TestARealClockRecordIsTakenBackWhenTheStatusWriteFails(t *testing.T) {
	manuscript := newFakeManuscript()
	service := NewService(Config{
		Project: t.TempDir(), LoadManuscript: manuscript.load, Chapters: manuscript.list, SetChapterStatus: manuscript.setStatus,
		Providers: newStageProviders().all(),
		Now:       func() time.Time { return time.Date(2026, 9, 23, 12, 0, 0, 123456789, time.Local) },
	})
	shown := recommendationFor(t, service, "c-0002")
	manuscript.statusErr = errors.New("disk full")

	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey); !errors.Is(err, manuscript.statusErr) {
		t.Fatalf("Confirm error %v", err)
	}
	if decisions, err := service.store.List("doc-1"); err != nil || len(decisions) != 0 {
		t.Fatalf("a nanosecond timestamp defeated the rollback: %+v, %v", decisions, err)
	}
}

// A confirmed stage whose providers no longer declare any signal cannot be
// re-checked: the confirmation reads as changed, and no notice is raised.
func TestAConfirmedStageWithNoSignalsLeftIsChangedButNotContradicted(t *testing.T) {
	manuscript := newFakeManuscript()
	providers := newStageProviders()
	service, _ := newTestService(t, manuscript, providers)
	confirmChapterOne(t, service)
	providers.recording.ids = nil
	providers.recording.signals = nil

	after := recommendationFor(t, service, "c-0002")
	if after.Confirmation == nil || !after.Confirmation.EvidenceChanged || after.Contradiction != nil {
		t.Fatalf("with no recording signals left: %+v", after)
	}
}

func TestRecommendationsReportChaptersThatCannotBeRead(t *testing.T) {
	manuscript := newFakeManuscript()
	manuscript.chaptersErr = errors.New("notes unreadable")
	service, _ := newTestService(t, manuscript, newStageProviders())
	if _, err := service.Recommendations(context.Background()); !errors.Is(err, manuscript.chaptersErr) {
		t.Fatalf("Recommendations error %v", err)
	}
}

func TestADecisionThatCannotBeWrittenLeavesTheStatusAlone(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	blocked := errors.New("rename blocked")
	service.store.rename = func(string, string) error { return blocked }

	if _, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey); !errors.Is(err, blocked) {
		t.Fatalf("Confirm error %v", err)
	}
	if _, err := service.Dismiss(context.Background(), "c-0002", StageEditing, shown.BasisKey); !errors.Is(err, blocked) {
		t.Fatalf("Dismiss error %v", err)
	}
	if manuscript.writes != 0 {
		t.Fatal("the status was written although the decision was not")
	}
}

// When the status write fails and the record cannot be taken back either, both
// failures are reported; the orphaned record is ignored because its target is
// not the chapter's status.
func TestConfirmReportsARollbackThatFails(t *testing.T) {
	manuscript := newFakeManuscript()
	service, _ := newTestService(t, manuscript, newStageProviders())
	shown := recommendationFor(t, service, "c-0002")
	manuscript.statusErr = errors.New("disk full")
	blocked := errors.New("rename blocked")
	renames := 0
	service.store.rename = func(oldPath, newPath string) error {
		renames++
		if renames > 1 {
			return blocked
		}
		return os.Rename(oldPath, newPath)
	}

	_, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if !errors.Is(err, manuscript.statusErr) || !errors.Is(err, blocked) {
		t.Fatalf("Confirm error %v, want both failures", err)
	}
	manuscript.statusErr = nil
	if after := recommendationFor(t, service, "c-0002"); after.Confirmation != nil || after.Verdict != VerdictRecommended {
		t.Fatalf("the orphaned record was trusted: %+v", after)
	}
}

func TestRevertReportsWhatItCannotRead(t *testing.T) {
	service, project := newTestService(t, newFakeManuscript(), newStageProviders())
	if _, err := service.Revert(context.Background(), "c-9999"); err == nil || errors.Is(err, ErrNothingToRevert) {
		t.Fatalf("Revert of an unknown chapter: %v", err)
	}
	writeRaw(t, project, "{broken")
	if _, err := service.Revert(context.Background(), "c-0002"); err == nil || errors.Is(err, ErrNothingToRevert) {
		t.Fatalf("Revert over a corrupt decisions file: %v", err)
	}
}

func TestDecisionsAreStampedWithTheClockByDefault(t *testing.T) {
	manuscript := newFakeManuscript()
	service := NewService(Config{
		Project: t.TempDir(), LoadManuscript: manuscript.load, Chapters: manuscript.list, SetChapterStatus: manuscript.setStatus,
		Providers: newStageProviders().all(),
	})
	shown := recommendationFor(t, service, "c-0002")
	before := time.Now().UTC()
	confirmed, err := service.Confirm(context.Background(), "c-0002", StageEditing, shown.BasisKey)
	if err != nil {
		t.Fatal(err)
	}
	if at := confirmed.Confirmation.At; at.Before(before.Add(-time.Second)) || at.Location() != time.UTC {
		t.Fatalf("stamped %v, want now in UTC", at)
	}
}
