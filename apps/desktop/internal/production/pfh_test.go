package production

import (
	"math"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// logged is a stopped session of the given length on chapter and stage.
func logged(chapter string, stage stages.Stage, length time.Duration) Session {
	ended := nineAM.Add(length)
	return Session{ID: chapter + string(stage), ChapterID: chapter, Stage: stage, StartedAt: nineAM, EndedAt: &ended, Source: SourceManual}
}

func running(chapter string) Session {
	return Session{ID: "running", ChapterID: chapter, Stage: stages.StageRecording, StartedAt: nineAM, Source: SourceManual}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestLoggedHoursCountsStoppedSessionsOnly(t *testing.T) {
	sessions := []Session{
		logged("ch-1", stages.StageRecording, 90*time.Minute),
		logged("ch-1", stages.StageEditing, 30*time.Minute),
		logged("ch-2", stages.StageRecording, time.Hour),
		running("ch-2"),
	}
	if got := LoggedHours(sessions); !near(got, 3) {
		t.Fatalf("want 3 hours, got %v", got)
	}
	if got := ChapterHours(sessions, "ch-1"); !near(got, 2) {
		t.Fatalf("want 2 hours on ch-1, got %v", got)
	}
	byStage := HoursByStage(sessions)
	if !near(byStage[stages.StageRecording], 2.5) || !near(byStage[stages.StageEditing], 0.5) || len(byStage) != 2 {
		t.Fatalf("unexpected hours by stage: %#v", byStage)
	}
}

func TestChapterPFH(t *testing.T) {
	sessions := []Session{
		logged("ch-1", stages.StageRecording, 3*time.Hour),
		logged("ch-1", stages.StageEditing, 3*time.Hour),
		logged("ch-2", stages.StageRecording, 2*time.Hour),
		logged("ch-3", stages.StageRecording, time.Hour),
	}
	recorded := map[string]float64{
		"ch-1": 3600, // one finished hour
		"ch-2": 0,    // measured, but nothing audible yet
		// ch-3 is not measured at all (no confirmed track)
		"ch-4": 1800, // measured, but no time logged
	}
	cases := []struct {
		chapter string
		want    float64
		ok      bool
	}{
		{"ch-1", 6, true},
		{"ch-2", 0, false},
		{"ch-3", 0, false},
		{"ch-4", 0, false},
		{"ch-9", 0, false},
	}
	for _, c := range cases {
		got, ok := ChapterPFH(sessions, recorded, c.chapter)
		if ok != c.ok || !near(got, c.want) {
			t.Errorf("%s: want (%v, %v), got (%v, %v)", c.chapter, c.want, c.ok, got, ok)
		}
	}
}

func TestBookPFHDividesEveryLoggedHourByEveryMeasuredSecond(t *testing.T) {
	sessions := []Session{
		logged("ch-1", stages.StageRecording, 4*time.Hour),
		logged("ch-2", stages.StageRecording, 2*time.Hour), // measured zero: its hours still count
		logged("ch-3", stages.StageEditing, 3*time.Hour),   // unmeasured: its hours still count
		running("ch-1"),
	}
	recorded := map[string]float64{"ch-1": 3600, "ch-2": 0, "ch-4": 1800}
	got, ok := BookPFH(sessions, recorded)
	if !ok || !near(got, 9/1.5) {
		t.Fatalf("want (6, true), got (%v, %v)", got, ok)
	}
}

func TestBookPFHIsUndefinedWithNoMeasuredTimeOrNoLoggedHours(t *testing.T) {
	sessions := []Session{logged("ch-1", stages.StageRecording, time.Hour)}
	if got, ok := BookPFH(sessions, map[string]float64{"ch-1": 0}); ok || got != 0 {
		t.Fatalf("zero recorded seconds must be undefined, got (%v, %v)", got, ok)
	}
	if _, ok := BookPFH(sessions, nil); ok {
		t.Fatal("no measurements at all must be undefined")
	}
	if _, ok := BookPFH([]Session{running("ch-1")}, map[string]float64{"ch-1": 3600}); ok {
		t.Fatal("no logged hours must be undefined, not 0")
	}
}

func TestRecordedSecondsThatAreNotARealMeasurementAreIgnored(t *testing.T) {
	sessions := []Session{logged("ch-1", stages.StageRecording, time.Hour), logged("ch-2", stages.StageRecording, time.Hour)}
	recorded := map[string]float64{"ch-1": 3600, "ch-2": math.NaN(), "ch-3": -60, "ch-4": math.Inf(1)}
	got, ok := BookPFH(sessions, recorded)
	if !ok || !near(got, 2) {
		t.Fatalf("want (2, true) with the bad values ignored, got (%v, %v)", got, ok)
	}
	if _, ok := ChapterPFH(sessions, recorded, "ch-2"); ok {
		t.Fatal("a NaN measurement is not a measurement")
	}
}

func TestEffectiveRate(t *testing.T) {
	sessions := []Session{logged("ch-1", stages.StageRecording, 4*time.Hour), running("ch-2")}
	amount := 1000.0
	if got, ok := EffectiveRate(&amount, sessions); !ok || !near(got, 250) {
		t.Fatalf("want (250, true), got (%v, %v)", got, ok)
	}
	zero := 0.0
	if got, ok := EffectiveRate(&zero, sessions); !ok || got != 0 {
		t.Fatalf("an amount the narrator set to 0 is an honest 0, got (%v, %v)", got, ok)
	}
}

func TestEffectiveRateIsUndefinedWithoutAnAmountOrHours(t *testing.T) {
	sessions := []Session{logged("ch-1", stages.StageRecording, time.Hour)}
	if got, ok := EffectiveRate(nil, sessions); ok || got != 0 {
		t.Fatalf("no contracted amount must be undefined, got (%v, %v)", got, ok)
	}
	amount := 500.0
	if _, ok := EffectiveRate(&amount, []Session{running("ch-1")}); ok {
		t.Fatal("no logged hours must be undefined, never a division by zero")
	}
	for _, bad := range []float64{-1, math.NaN(), math.Inf(1)} {
		if _, ok := EffectiveRate(&bad, sessions); ok {
			t.Errorf("amount %v must be undefined", bad)
		}
	}
}

func TestTheServiceReadsItsOwnLogAndTheRecordedPort(t *testing.T) {
	service, c := newTestService(t)
	service.config.Recorded = func() (map[string]float64, error) {
		return map[string]float64{"ch-1": 1800}, nil
	}
	if _, err := service.Start("ch-1", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	c.at = nineAM.Add(3 * time.Hour)
	if _, _, err := service.Stop(); err != nil {
		t.Fatal(err)
	}
	got, ok, err := service.PFH("ch-1")
	if err != nil || !ok || !near(got, 6) {
		t.Fatalf("want (6, true), got (%v, %v, %v)", got, ok, err)
	}
	got, ok, err = service.BookPFH()
	if err != nil || !ok || !near(got, 6) {
		t.Fatalf("want (6, true), got (%v, %v, %v)", got, ok, err)
	}
}

func TestTheServiceWithNoRecordedPortHasNoPFH(t *testing.T) {
	service, c := newTestService(t)
	if _, err := service.Start("ch-1", stages.StageRecording); err != nil {
		t.Fatal(err)
	}
	c.at = nineAM.Add(time.Hour)
	if _, _, err := service.Stop(); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := service.BookPFH(); err != nil || ok {
		t.Fatalf("want undefined with no measurements, got ok=%v err=%v", ok, err)
	}
}
