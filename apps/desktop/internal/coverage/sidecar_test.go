package coverage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// realSidecar finds the checkout's Python environment and compare.py, or
// skips where there is none (the pytest suite covers the sidecar on its own).
// Where both exist (a checkout after `uv sync`), this runs the host and the
// real sidecar together: the test that holds the Go manifest, arguments and
// words files to what coverage_mode.py actually reads.
func realSidecar(t *testing.T) (python, script string) {
	t.Helper()
	working, _ := os.Getwd()
	root := layout.FindRoot(working)
	python = filepath.Join(root, ".venv", "bin", "python")
	if runtime.GOOS == "windows" {
		python = filepath.Join(root, ".venv", "Scripts", "python.exe")
	}
	script = layout.Path(root, layout.TranscriptCompareBackend)
	for _, path := range []string{python, script} {
		if _, err := os.Stat(path); err != nil {
			t.Skipf("no Python sidecar environment (%s): run `uv sync` to include this test", path)
		}
	}
	return python, script
}

// seedWords puts a words file for an item's played range into the cache, as
// an earlier run would have, so the real sidecar needs no Whisper model.
func seedWords(t *testing.T, service *Service, p *testProject, source string, start, end float64, text string) {
	t.Helper()
	identity, err := evidence.Identify(filepath.Join(p.dir, filepath.FromSlash(source)), p.dir)
	if err != nil {
		t.Fatal(err)
	}
	var words []string
	for i, word := range strings.Fields(text) {
		at := start + float64(i)*0.3
		words = append(words, fmt.Sprintf(`[%q,%g,%g]`, word, at, at+0.25))
	}
	file := fmt.Sprintf(`{"schemaVersion":1,"sourceStart":%g,"sourceEnd":%g,"words":[%s],"transcription":{"model":"small","language":"en","hotwordsHash":null,"vadFilter":true}}`,
		start, end, strings.Join(words, ","))
	blob, _ := json.Marshal(wordsBlob{SchemaVersion: wordsBlobVersion, Segments: []json.RawMessage{json.RawMessage(file)}})
	cache := wordsCache{store: service.cache, paramHash: wordsParamHash(Transcription{Model: "small"}, readProjectInputs(p.dir))}
	if err := cache.store.Write(cache.key(identity), blob); err != nil {
		t.Fatal(err)
	}
}

func TestTheRealSidecarReadsTheHostsManifestAndCachedWords(t *testing.T) {
	python, script := realSidecar(t)
	p := newTestProject(t)
	p.items = append(p.items, testItem{guid: "{MUTED}", source: "media/a.wav", position: 20, length: 3, soffs: 40, playrate: 1, muted: true})
	p.writeRPP()
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	service := New(Config{
		Project: p.dir, Python: python, Backend: script,
		ProjectFile: func() (string, error) { return p.rpp, nil }, LoadManuscript: p.loadManuscript,
	}, SupervisorLauncher(supervisor), nil)
	service.pollInterval = 20 * time.Millisecond
	seedWords(t, service, p, "media/a.wav", 5, 15, "Chapter One Alice was beginning to get")
	seedWords(t, service, p, "media/b.wav", 0, 6, "very tired")

	state := run(t, service, testRequest())

	if state.Phase != PhaseComplete {
		t.Fatalf("state = %+v", state)
	}
	result := currentResult(t, service, DefaultAlignmentParams)
	if !result.Current() {
		t.Fatalf("result = %+v", result)
	}
	report := result.Result.Report
	if report.Summary.BodyTokens != 7 || report.Summary.PresentTokens != 7 || report.Summary.Items.Reused != 2 || report.Summary.Items.Transcribed != 0 || report.Summary.Items.Muted != 1 {
		t.Fatalf("summary = %+v", report.Summary)
	}
	if !report.TextComplete(DefaultThresholds) || len(report.Items) != 3 || report.Items[2].Status != "muted" {
		t.Fatalf("report = %+v", report)
	}
}

func TestTheRealSidecarRefusesAChapterItDoesNotHave(t *testing.T) {
	python, script := realSidecar(t)
	p := newTestProject(t)
	supervisor := process.NewSupervisor()
	t.Cleanup(func() { _ = supervisor.Close() })
	service := New(Config{
		Project: p.dir, Python: python, Backend: script,
		ProjectFile: func() (string, error) { return p.rpp, nil }, LoadManuscript: p.loadManuscript,
	}, SupervisorLauncher(supervisor), nil)
	service.pollInterval = 20 * time.Millisecond
	seedWords(t, service, p, "media/a.wav", 5, 15, "Alice was beginning to get")
	seedWords(t, service, p, "media/b.wav", 0, 6, "very tired")
	// The manuscript loses the chapter after the host has read it: the sidecar
	// fails with exit 1 and an ERROR line, and the run is recorded as failed.
	service.config.LoadManuscript = func() (map[string]any, error) {
		data, err := p.loadManuscript()
		p.writeFile("narration-utils/manuscript/manuscript.json", `{"schemaVersion":1,"documentId":"doc-1","chapters":[],"paragraphs":[]}`)
		return data, err
	}

	state := run(t, service, testRequest())

	if state.Phase != PhaseFailed || state.Message == "" {
		t.Fatalf("state = %+v", state)
	}
	if record := latestRecord(t, p); record.Outcome != evidence.LedgerFailed {
		t.Fatalf("record = %+v", record)
	}
}
