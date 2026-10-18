package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
	"github.com/countrymanprime/narration-utils/shell/internal/runlog"
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

func TestSystemReportDiagnosticSendsUiEventsToTheRunLogAndNotTheHostLog(t *testing.T) {
	dir := t.TempDir()
	hostPath, runPath := filepath.Join(dir, "host.log"), filepath.Join(dir, "run.jsonl")
	host := &Host{log: hostlog.New(hostPath, 0), runLog: runlog.New(runPath, 0)}

	if _, err := host.SystemReportDiagnostic("ui.toast", "saved C:/Users/Count/Book.rpp"); err != nil {
		t.Fatal(err)
	}
	if _, err := host.SystemReportDiagnostic("ui.call.fail", "DawLaunch failed"); err != nil {
		t.Fatal(err)
	}

	runText, err := os.ReadFile(runPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"event":"ui.toast"`, `"msg":"saved <path>"`, `"tool":"app"`, `"event":"ui.call.fail"`, `"level":"warn"`} {
		if !strings.Contains(string(runText), want) {
			t.Fatalf("run log missing %s:\n%s", want, runText)
		}
	}
	if strings.Contains(string(runText), "Count") {
		t.Fatalf("run log kept a user name:\n%s", runText)
	}
	if hostText, _ := os.ReadFile(hostPath); strings.Contains(string(hostText), "ui.") {
		t.Fatalf("a UI trace event landed in host.log: %s", hostText)
	}
}
