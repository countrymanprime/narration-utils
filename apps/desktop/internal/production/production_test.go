package production

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

var nineAM = time.Date(2026, 9, 27, 9, 0, 0, 0, time.UTC)

// clock is a settable stand-in for time.Now.
type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func newTestService(t *testing.T) (*Service, *clock) {
	t.Helper()
	c := &clock{at: nineAM}
	service := New(Config{Project: t.TempDir()})
	service.now = c.now
	return service, c
}

func TestSessionsIsEmptyForAProjectThatNeverLoggedTime(t *testing.T) {
	service, _ := newTestService(t)
	sessions, err := service.Sessions()
	if err != nil {
		t.Fatal(err)
	}
	if sessions == nil || len(sessions) != 0 {
		t.Fatalf("want an empty, non-nil list, got %#v", sessions)
	}
	if _, running, err := service.Running(); err != nil || running {
		t.Fatalf("want no running timer, got running=%v err=%v", running, err)
	}
}

func TestStartThenStopLogsOneManualSession(t *testing.T) {
	service, c := newTestService(t)
	started, err := service.Start("ch-4", stages.StageRecording)
	if err != nil {
		t.Fatal(err)
	}
	if started.ChapterID != "ch-4" || started.Stage != stages.StageRecording || !started.StartedAt.Equal(nineAM) || started.EndedAt != nil {
		t.Fatalf("unexpected started session: %#v", started)
	}
	if started.Source != SourceManual || started.ID == "" {
		t.Fatalf("want a manual session with an id, got %#v", started)
	}
	running, ok, err := service.Running()
	if err != nil || !ok || running.ID != started.ID {
		t.Fatalf("want the started session running, got %#v ok=%v err=%v", running, ok, err)
	}

	c.at = nineAM.Add(95 * time.Minute)
	stopped, ok, err := service.Stop()
	if err != nil || !ok {
		t.Fatalf("want a stopped session, got ok=%v err=%v", ok, err)
	}
	if stopped.ID != started.ID || stopped.EndedAt == nil || !stopped.EndedAt.Equal(c.at) {
		t.Fatalf("unexpected stopped session: %#v", stopped)
	}
	if got := stopped.Duration(); got != 95*time.Minute {
		t.Fatalf("want 95m, got %v", got)
	}
	if _, running, _ := service.Running(); running {
		t.Fatal("want no running timer after Stop")
	}
	sessions, err := service.Sessions()
	if err != nil || len(sessions) != 1 || sessions[0].ID != started.ID || sessions[0].EndedAt == nil {
		t.Fatalf("want the one logged session, got %#v err=%v", sessions, err)
	}
}

func TestStartWhileOneIsRunningIsRefusedAndNeverSwitches(t *testing.T) {
	service, c := newTestService(t)
	if _, err := service.Start("ch-4", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	c.at = nineAM.Add(time.Minute)
	_, err := service.Start("ch-5", stages.StageEditing)
	if !errors.Is(err, ErrTimerRunning) {
		t.Fatalf("want ErrTimerRunning, got %v", err)
	}
	if !strings.Contains(err.Error(), "ch-4") {
		t.Fatalf("want the error to name the running chapter, got %q", err)
	}
	running, ok, _ := service.Running()
	if !ok || running.ChapterID != "ch-4" || running.Stage != stages.StageRecording {
		t.Fatalf("want the first timer still running, got %#v", running)
	}
	sessions, _ := service.Sessions()
	if len(sessions) != 1 {
		t.Fatalf("want one session, got %#v", sessions)
	}
}

func TestStopWithNothingRunningIsANoOp(t *testing.T) {
	service, _ := newTestService(t)
	if _, ok, err := service.Stop(); err != nil || ok {
		t.Fatalf("want a no-op, got ok=%v err=%v", ok, err)
	}
	if _, err := os.Stat(sessionsPath(service.config.Project)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a no-op Stop must not write the file, stat err=%v", err)
	}
	if _, err := service.Start("ch-1", stages.StageEditing); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := service.Stop(); !ok {
		t.Fatal("want the first Stop to stop the timer")
	}
	if _, ok, err := service.Stop(); err != nil || ok {
		t.Fatalf("want the second Stop to be a no-op, got ok=%v err=%v", ok, err)
	}
}

func TestStartValidatesTheChapterAndStage(t *testing.T) {
	service, _ := newTestService(t)
	if _, err := service.Start("  ", stages.StageRecording); err == nil {
		t.Fatal("want an error for a blank chapter id")
	}
	if _, err := service.Start("ch-1", stages.Stage("mastering")); err == nil {
		t.Fatal("want an error for a stage that is not one of the five chapter statuses")
	}
	sessions, _ := service.Sessions()
	if len(sessions) != 0 {
		t.Fatalf("a refused Start must log nothing, got %#v", sessions)
	}
}

func TestEveryChapterStatusIsATimeableStage(t *testing.T) {
	for _, stage := range []stages.Stage{stages.StageNotStarted, stages.StageRecording, stages.StageEditing, stages.StageProofing, stages.StageFinalized} {
		service, _ := newTestService(t)
		if _, err := service.Start("ch-1", stage); err != nil {
			t.Fatalf("%s: %v", stage, err)
		}
	}
}

func TestARunningTimerSurvivesANewService(t *testing.T) {
	service, c := newTestService(t)
	started, err := service.Start("ch-2", stages.StageProofing)
	if err != nil {
		t.Fatal(err)
	}
	reopened := New(Config{Project: service.config.Project})
	reopened.now = c.now
	running, ok, err := reopened.Running()
	if err != nil || !ok || running.ID != started.ID {
		t.Fatalf("want the timer still running after a restart, got %#v ok=%v err=%v", running, ok, err)
	}
	c.at = nineAM.Add(time.Hour)
	if _, ok, err := reopened.Stop(); err != nil || !ok {
		t.Fatalf("want the reopened service to stop it, ok=%v err=%v", ok, err)
	}
}

func TestSessionsAreReturnedInStartOrderAsCopies(t *testing.T) {
	service, c := newTestService(t)
	for i, chapter := range []string{"ch-1", "ch-2", "ch-3"} {
		c.at = nineAM.Add(time.Duration(i) * time.Hour)
		if _, err := service.Start(chapter, stages.StageRecording); err != nil {
			t.Fatal(err)
		}
		c.at = c.at.Add(30 * time.Minute)
		if _, _, err := service.Stop(); err != nil {
			t.Fatal(err)
		}
	}
	sessions, err := service.Sessions()
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 3 || sessions[0].ChapterID != "ch-1" || sessions[2].ChapterID != "ch-3" {
		t.Fatalf("unexpected order: %#v", sessions)
	}
	moved := sessions[0].EndedAt.Add(time.Hour)
	*sessions[0].EndedAt = moved
	again, _ := service.Sessions()
	if again[0].EndedAt.Equal(moved) {
		t.Fatal("Sessions must hand out copies, not the stored values")
	}
}

func TestDurationOfAClockThatWentBackwardsIsZero(t *testing.T) {
	service, c := newTestService(t)
	if _, err := service.Start("ch-1", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	c.at = nineAM.Add(-time.Minute)
	stopped, _, err := service.Stop()
	if err != nil {
		t.Fatal(err)
	}
	if stopped.Duration() != 0 {
		t.Fatalf("want 0 for an end before the start, got %v", stopped.Duration())
	}
	running := Session{StartedAt: nineAM}
	if running.Duration() != 0 {
		t.Fatal("a running session has no logged duration yet")
	}
}

func TestAMalformedFileIsReportedAndKeptAsideNotGuessedAt(t *testing.T) {
	service, _ := newTestService(t)
	path := sessionsPath(service.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Sessions(); err == nil {
		t.Fatal("want the malformed file reported")
	}
	kept, _ := filepath.Glob(path + ".corrupt-*")
	if len(kept) != 1 {
		t.Fatalf("want the malformed file kept aside, got %v", kept)
	}
	if bytes, _ := os.ReadFile(kept[0]); string(bytes) != "{not json" {
		t.Fatalf("the kept copy must be the original bytes, got %q", bytes)
	}
}

func TestAFileFromANewerAppIsRefusedAndNeverOverwritten(t *testing.T) {
	service, _ := newTestService(t)
	path := sessionsPath(service.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	newer := `{"schemaVersion": 99, "sessions": []}`
	if err := os.WriteFile(path, []byte(newer), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Sessions(); err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Fatalf("want a newer-version error, got %v", err)
	}
	if _, err := service.Start("ch-1", stages.StageRecording); err == nil {
		t.Fatal("want Start refused on a newer file")
	}
	if bytes, _ := os.ReadFile(path); string(bytes) != newer {
		t.Fatalf("the newer file must be left untouched, got %q", bytes)
	}
}

func TestASessionWithAnUnknownStageInTheFileIsReported(t *testing.T) {
	service, _ := newTestService(t)
	path := sessionsPath(service.config.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"schemaVersion": 1, "sessions": [{"id": "a", "chapterId": "ch-1", "stage": "mastering", "startedAt": "2026-09-27T09:00:00Z", "source": "manual"}]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Sessions(); err == nil {
		t.Fatal("want a file naming an unknown stage reported, not read as something it is not")
	}
}

func TestAFailedRenameLeavesTheLogAsItWas(t *testing.T) {
	service, c := newTestService(t)
	if _, err := service.Start("ch-1", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	service.rename = func(string, string) error { return errors.New("disk full") }
	c.at = nineAM.Add(time.Hour)
	if _, _, err := service.Stop(); err == nil {
		t.Fatal("want the failed write reported")
	}
	service.rename = nil
	if _, running, _ := service.Running(); !running {
		t.Fatal("a Stop that could not be saved must leave the timer running")
	}
}

func TestTheFileIsWrittenUnderTheProjectsProductionFolder(t *testing.T) {
	service, _ := newTestService(t)
	if _, err := service.Start("ch-1", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(service.config.Project, "narration-utils", "production", "sessions.json")
	if _, err := os.Stat(want); err != nil {
		t.Fatalf("want %s written: %v", want, err)
	}
	if _, err := os.Stat(want + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("the temporary file must not be left behind")
	}
}
