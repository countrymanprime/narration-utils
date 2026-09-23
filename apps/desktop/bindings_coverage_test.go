package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/coverage"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/whisper"
)

// whisperWithSmall is a Whisper catalog with the Transcript Compare default model, small, installed when install is set.
func whisperWithSmall(t *testing.T, install bool) *whisper.Manager {
	t.Helper()
	body := []byte("model-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	t.Cleanup(server.Close)
	sum := sha256.Sum256(body)
	catalog, err := json.Marshal(map[string]any{
		"catalogVersion": 1,
		"models": []map[string]any{{
			"id": "small", "provider": "faster-whisper", "displayName": "Small", "version": "1", "publisher": "Systran", "license": "MIT",
			"files": []map[string]any{{"name": "model.bin", "url": server.URL, "sha256": hex.EncodeToString(sum[:]), "size": len(body)}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	catalogPath := filepath.Join(t.TempDir(), "whisper-assets.json")
	if err := os.WriteFile(catalogPath, catalog, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := whisper.New(catalogPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if install {
		if err := manager.Install(context.Background(), "small"); err != nil {
			t.Fatal(err)
		}
	}
	return manager
}

// coverageChild is a finished fake sidecar.
type coverageChild struct {
	mu   sync.Mutex
	code *int
}

func (c *coverageChild) HasExited() bool { c.mu.Lock(); defer c.mu.Unlock(); return c.code != nil }
func (c *coverageChild) ExitCode() (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.code == nil {
		return 0, false
	}
	return *c.code, true
}

// fakeCoverageSidecar stands in for `compare.py --coverage`: it writes a results file with present of the chapter's 10
// words and exits 0.
func fakeCoverageSidecar(present int) coverage.Launcher {
	return func(_ context.Context, _ string, args ...string) (coverage.Child, error) {
		values := map[string]string{}
		for i := 0; i+1 < len(args); i++ {
			if strings.HasPrefix(args[i], "--") {
				values[args[i]] = args[i+1]
			}
		}
		child := &coverageChild{}
		go func() {
			missing := 10 - present
			results := fmt.Sprintf(`COVERAGE|{"schemaVersion":1,"chapterId":%q,"bodyTokens":10,"presentTokens":%d,"missingTokens":%d,"extraTokens":0,"longestMissingRun":%d,"alignment":{"maxMisreadRun":8,"minAnchorRun":3},"items":{"analyzed":1,"muted":0,"playedSeconds":4,"transcribed":1,"reused":0},"analysis":{"model":"small","language":null,"equivalencesHash":null}}`+"\n", values["--chapter-id"], present, missing, missing)
			results += fmt.Sprintf(`COVERAGE_PARAGRAPH|{"id":"p-000001","tokens":10,"present":%d,"longestMissingRun":%d}`+"\n", present, missing)
			code := 0
			if err := os.WriteFile(values["--out"], []byte(results), 0o600); err != nil {
				code = 1
			}
			_ = os.WriteFile(values["--progress"], []byte("DONE|100|Finished\n"), 0o600)
			child.mu.Lock()
			child.code = &code
			child.mu.Unlock()
		}()
		return child, nil
	}
}

// coverageHost attaches a coverage project (coverage_test.go) with a Whisper catalog and a fake sidecar.
func coverageHost(t *testing.T, project string, installed bool, launcher coverage.Launcher) *Host {
	t.Helper()
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.coverageLauncher = launcher
	host.assets = newAssetRegistry(t.TempDir(), nil, whisperWithSmall(t, installed), nil, nil)
	next := host.config
	next.projectFolder = project
	next.comparePython, next.compareBackend = "python-sidecar", "compare.py"
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	return host
}

// decodeAnswer decodes a binding's answer: decodeAnswer(t)(host.CoverageState()).
func decodeAnswer(t *testing.T) func(string, error) map[string]any {
	return func(raw string, err error) map[string]any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var answer map[string]any
		if err := json.Unmarshal([]byte(raw), &answer); err != nil {
			t.Fatal(err)
		}
		return answer
	}
}

func TestCoverageStartStopsAtTheModelGateWhenTheModelIsNotInstalled(t *testing.T) {
	launched := false
	host := coverageHost(t, coverageProject(t), false, func(context.Context, string, ...string) (coverage.Child, error) {
		launched = true
		return nil, fmt.Errorf("must not launch")
	})

	answer := decodeAnswer(t)(host.CoverageStart("c-0001"))

	if answer["status"] != "asset_required" || launched {
		t.Fatalf("answer = %v, launched = %v", answer, launched)
	}
}

func TestCoverageStartAnswersATypedRefusalAndRunsNothing(t *testing.T) {
	project := coverageProject(t)
	if err := os.Remove(evidence.MappingFile(project)); err != nil {
		t.Fatal(err)
	}
	host := coverageHost(t, project, true, fakeCoverageSidecar(10))
	events := collectJobEnds(host)

	answer := decodeAnswer(t)(host.CoverageStart("c-0001"))

	if answer["status"] != "refused" || answer["reason"] != string(coverage.ReasonUnmapped) || answer["message"] == "" {
		t.Fatalf("answer = %v", answer)
	}
	noMoreJobEnds(t, events)
	contractfile.Check(t, "coverage-start-refused", answer)
}

func TestACoverageCheckEndsWithOneJobEventAndFillsRecordedFraction(t *testing.T) {
	host := coverageHost(t, coverageProject(t), true, fakeCoverageSidecar(8))
	events := collectJobEnds(host)
	chapters := decodeChapters(t, host)
	if _, measured := chapters[0]["recordedFraction"]; measured {
		t.Fatalf("a chapter never checked has no recordedFraction: %v", chapters[0])
	}

	started := decodeAnswer(t)(host.CoverageStart("c-0001"))
	if started["status"] != "started" {
		t.Fatalf("answer = %v", started)
	}
	ended := nextJobEnd(t, events)
	host.services().coverage.Wait()

	if ended.Kind != jobKindCoverage || ended.Outcome != jobOutcomeSuccess || ended.Message != "Text present: 8 of 10 words." {
		t.Fatalf("job:ended = %+v", ended)
	}
	noMoreJobEnds(t, events)
	state := decodeAnswer(t)(host.CoverageState())
	if state["phase"] != "complete" || state["percent"] != float64(100) {
		t.Fatalf("state = %v", state)
	}
	result := decodeAnswer(t)(host.CoverageResult("c-0001"))
	if result["state"] != "current" || result["recordedFraction"] != 0.8 {
		t.Fatalf("result = %v", result)
	}
	if chapters := decodeChapters(t, host); chapters[0]["recordedFraction"] != 0.8 {
		t.Fatalf("the chapter payload carries the measurement: %v", chapters[0])
	}

	// Pinned with the run id and times fixed: they are the only values that vary.
	for _, pinned := range []struct {
		name  string
		value map[string]any
	}{{"coverage-start-started", started}, {"coverage-state-complete", state}} {
		fixCoverageRun(pinned.value)
		stable, err := contractfile.Stabilize(pinned.value)
		if err != nil {
			t.Fatal(err)
		}
		contractfile.Check(t, pinned.name, stable)
	}
}

func decodeChapters(t *testing.T, host *Host) []map[string]any {
	t.Helper()
	raw, err := host.ManuscriptChapters()
	if err != nil {
		t.Fatal(err)
	}
	var chapters []map[string]any
	if err := json.Unmarshal([]byte(raw), &chapters); err != nil || len(chapters) == 0 {
		t.Fatalf("chapters = %s, %v", raw, err)
	}
	return chapters
}

// fixCoverageRun replaces a state's run and record ids (a start answer's nested state too) with fixed ones.
func fixCoverageRun(value map[string]any) {
	if state, ok := value["state"].(map[string]any); ok {
		fixCoverageRun(state)
	}
	if _, ok := value["runId"]; ok {
		value["runId"] = "1789970042000000000"
	}
	if _, ok := value["recordId"]; ok {
		value["recordId"] = "0123456789abcdef0123456789abcdef"
	}
}

func TestCoverageBindingsWithNoProjectAreIdleAndNever(t *testing.T) {
	host := NewHost()

	state := decodeAnswer(t)(host.CoverageState())
	result := decodeAnswer(t)(host.CoverageResult("c-0001"))
	if _, err := host.CoverageCancel(); err != nil {
		t.Fatal(err)
	}
	if _, err := host.CoverageStart("c-0001"); err == nil {
		t.Fatal("a start with no project must fail")
	}

	if state["phase"] != "idle" || result["state"] != "never" {
		t.Fatalf("state = %v, result = %v", state, result)
	}
	contractfile.Check(t, "coverage-state-idle", state)
}

func TestCoverageWatchEndsEachRunOnce(t *testing.T) {
	var watch coverageWatch
	started := time.Now().Add(-2 * time.Second)
	running := coverage.State{RunID: "run-1", Phase: coverage.PhaseRunning, StartedAt: &started}
	if _, ended := watch.observe(running); ended {
		t.Fatal("a running state is not an end")
	}
	cases := []struct {
		phase   coverage.Phase
		outcome string
	}{{coverage.PhaseComplete, jobOutcomeSuccess}, {coverage.PhaseFailed, jobOutcomeError}, {coverage.PhaseCancelled, jobOutcomeCancelled}}
	for index, c := range cases {
		state := coverage.State{RunID: fmt.Sprintf("run-%d", index+2), Phase: c.phase, Message: "Said so.", StartedAt: &started}
		event, ended := watch.observe(state)
		if !ended || event.Outcome != c.outcome || event.Kind != jobKindCoverage || event.ID != state.RunID || event.DurationMs < 1900 {
			t.Fatalf("%s: event = %+v, %v", c.phase, event, ended)
		}
		if _, again := watch.observe(state); again {
			t.Fatalf("%s: a run ends once", c.phase)
		}
	}
	if _, ended := watch.observe(coverage.State{Phase: coverage.PhaseIdle}); ended {
		t.Fatal("idle is not an end")
	}
}
