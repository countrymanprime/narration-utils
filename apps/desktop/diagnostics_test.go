package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/tts"
)

func TestSystemReportDiagnosticWritesTheClientReportToTheHostLog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "host.log")
	host := &Host{log: hostlog.New(path, 0)}

	result, err := host.SystemReportDiagnostic("wire_invalid", "host.binding Bootstrap did not match its schema: projectName: Invalid input: expected string, received number")
	if err != nil || result != "null" {
		t.Fatalf("result = %q, err = %v, want null and no error", result, err)
	}

	bytes, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !strings.Contains(string(bytes), " wire_invalid host.binding Bootstrap did not match its schema: projectName") {
		t.Fatalf("log = %q", bytes)
	}
}

func TestSystemReportDiagnosticNeverFailsTheCaller(t *testing.T) {
	// A log that cannot be written must not turn a client report into a binding error: the client ignores it anyway,
	// and an error here would be reported back through the same path.
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	host := &Host{log: hostlog.New(filepath.Join(blocker, "host.log"), 0)}
	if _, err := host.SystemReportDiagnostic("window_error", "boom"); err != nil {
		t.Fatalf("unwritable log failed the binding: %v", err)
	}
	if _, err := (&Host{}).SystemReportDiagnostic("window_error", "boom"); err != nil {
		t.Fatalf("a host without a log failed the binding: %v", err)
	}
}

// A voice install reports the phase the UI polls for ("downloading", contracts/tts.ts), with a percent and an error, from the
// moment it starts (ADR 0069: the schema found the host sending "running", which the Story Bible's download prompt never matched).
func TestStartTtsInstallReportsTheDownloadingPhaseTheUIPollsFor(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer server.Close()
	defer close(release)
	catalogPath := filepath.Join(t.TempDir(), "tts.json")
	catalog := `{"catalogVersion":1,"voices":[{"id":"v1","provider":"piper","displayName":"V","files":[{"name":"v.onnx","url":"` + server.URL + `","sha256":"00","size":10}]}]}`
	if err := os.WriteFile(catalogPath, []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := tts.New(catalogPath, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host := &Host{tts: manager, ttsJobs: map[string]*ttsJob{}}

	started, err := host.startTtsInstall("v1")
	if err != nil {
		t.Fatal(err)
	}
	if started["phase"] != "downloading" || started["percent"] != 0 || started["error"] != "" {
		t.Fatalf("started job = %#v, want phase downloading, percent 0 and no error", started)
	}
}
