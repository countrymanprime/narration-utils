package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
)

// Background recording checks (daw-chapter-track-auto-sync PRD Phase 7, S7, D27, ADR 0211): the host's loop over the
// real coverage service, with the power state and the clock handed in.

// switchableSidecar is a coverage launcher a test can point at another fake between runs.
type switchableSidecar struct {
	mu   sync.Mutex
	next coverage.Launcher
}

func (s *switchableSidecar) use(launcher coverage.Launcher) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next = launcher
}

func (s *switchableSidecar) launch(ctx context.Context, program string, args ...string) (coverage.Child, error) {
	s.mu.Lock()
	launcher := s.next
	s.mu.Unlock()
	return launcher(ctx, program, args...)
}

// staleCoverageHost is a coverage project whose one chapter was checked and then trimmed in REAPER an hour ago, on a
// computer on mains power with REAPER closed: every condition allows a background check.
func staleCoverageHost(t *testing.T) (*Host, *switchableSidecar, time.Time) {
	t.Helper()
	project := coverageProject(t)
	sidecar := &switchableSidecar{next: fakeCoverageSidecar(8)}
	host := coverageHost(t, project, true, sidecar.launch)
	checkRecording(t, host)
	rpp := filepath.Join(project, "book.rpp")
	body, err := os.ReadFile(rpp)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rpp, []byte(strings.Replace(string(body), "LENGTH 4", "LENGTH 3", 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	anHourAgo := time.Now().Add(-time.Hour)
	for _, path := range []string{rpp, filepath.Join(project, "media", "take.wav")} {
		if err := os.Chtimes(path, anHourAgo, anHourAgo); err != nil {
			t.Fatal(err)
		}
	}
	host.powerState = func() coverage.Power { return coverage.PowerMains }
	sidecar.use(fakeCoverageSidecar(9))
	return host, sidecar, time.Now()
}

func TestAStaleChapterIsCheckedAgainInTheBackground(t *testing.T) {
	host, _, now := staleCoverageHost(t)
	events := collectJobEnds(host)

	decision := host.backgroundCheckTick(now)

	if decision.ChapterID != "c-0001" {
		t.Fatalf("decision = %+v", decision)
	}
	if state := host.services().coverage.State(); !state.Background || state.ChapterID != "c-0001" {
		t.Fatalf("the running check is not marked background: %+v", state)
	}
	ended := nextJobEnd(t, events)
	host.services().coverage.Wait()
	if ended.Outcome != jobOutcomeSuccess {
		t.Fatalf("job:ended = %+v", ended)
	}
	state, err := host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	if row := chapterRow(t, state, "c-0001"); row.Freshness != "current" {
		t.Fatalf("after the background check: %+v", row)
	}
	if next := host.backgroundCheckTick(now.Add(time.Minute)); next.ChapterID != "" || next.Wait != coverage.WaitNothing {
		t.Fatalf("a current chapter was picked again: %+v", next)
	}
}

func TestBackgroundChecksCanBeTurnedOff(t *testing.T) {
	host, _, now := staleCoverageHost(t)
	off := "false"
	if err := host.saveSettings(coverage.SettingsTool, "global", map[string]*string{"background_checks": &off}); err != nil {
		t.Fatal(err)
	}

	decision := host.backgroundCheckTick(now)

	if decision.Wait != coverage.WaitOff || host.services().coverage.Busy() {
		t.Fatalf("decision = %+v, busy = %v", decision, host.services().coverage.Busy())
	}
	state, err := host.chapterSyncState()
	if err != nil {
		t.Fatal(err)
	}
	if state.Background.Enabled || state.Background.Wait != string(coverage.WaitOff) {
		t.Fatalf("background = %+v", state.Background)
	}
}

func TestOnBatteryNothingStarts(t *testing.T) {
	host, _, now := staleCoverageHost(t)
	host.powerState = func() coverage.Power { return coverage.PowerBattery }
	if decision := host.backgroundCheckTick(now); decision.Wait != coverage.WaitBattery || host.services().coverage.Busy() {
		t.Fatalf("decision = %+v", decision)
	}
}

// heldCoverageSidecar runs until its run is cancelled (the .cancel file beside its progress file), then exits with the
// cancel code, as compare.py does.
func heldCoverageSidecar() coverage.Launcher {
	return func(_ context.Context, _ string, args ...string) (coverage.Child, error) {
		progress := ""
		for i := 0; i+1 < len(args); i++ {
			if args[i] == "--progress" {
				progress = args[i+1]
			}
		}
		child := &coverageChild{}
		go func() {
			for {
				if _, err := os.Stat(progress + ".cancel"); err == nil {
					code := 2
					child.mu.Lock()
					child.code = &code
					child.mu.Unlock()
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
		}()
		return child, nil
	}
}

func TestTheNarratorsOwnCheckPreemptsABackgroundOne(t *testing.T) {
	host, sidecar, now := staleCoverageHost(t)
	sidecar.use(heldCoverageSidecar())
	if decision := host.backgroundCheckTick(now); decision.ChapterID != "c-0001" {
		t.Fatalf("decision = %+v", decision)
	}
	sidecar.use(fakeCoverageSidecar(9))

	started := decodeAnswer(t)(host.CoverageStart("c-0001"))

	if started["status"] != "started" {
		t.Fatalf("the narrator's start was refused: %v", started)
	}
	if state := host.services().coverage.State(); state.Background {
		t.Fatalf("the narrator's run is marked background: %+v", state)
	}
	host.services().coverage.Wait()
}

func TestABackgroundCheckTheNarratorCancelledIsNotStartedAgainForTheSameChange(t *testing.T) {
	host, sidecar, now := staleCoverageHost(t)
	sidecar.use(heldCoverageSidecar())
	if decision := host.backgroundCheckTick(now); decision.ChapterID != "c-0001" {
		t.Fatalf("decision = %+v", decision)
	}

	if _, err := host.CoverageCancel(); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	if again := host.backgroundCheckTick(now.Add(time.Minute)); again.ChapterID != "" || host.services().coverage.Busy() {
		t.Fatalf("the cancelled check started again: %+v", again)
	}
}
