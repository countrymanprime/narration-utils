package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/hostlog"
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
