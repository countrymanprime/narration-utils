package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSystemOpenLogFolderOpensTheRunLogsDirectory(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	var opened string
	host.openFolder = func(dir string) error { opened = dir; return nil }

	if _, err := host.SystemOpenLogFolder(); err != nil {
		t.Fatal(err)
	}
	if opened != filepath.Dir(host.runLog.Path()) {
		t.Fatalf("opened %q, want the run log's folder %q", opened, filepath.Dir(host.runLog.Path()))
	}
}

func TestSystemCopyDiagnosticsSavesTheLastRunAndReturnsItsPath(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	run := host.runLog.Begin("guide")
	run.End("ok")

	destFolder := t.TempDir()
	host.pickDiagnosticsFolder = func() (string, error) { return destFolder, nil }

	raw, err := host.SystemCopyDiagnostics(string(CopyDiagnosticsLastRun))
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatalf("SystemCopyDiagnostics did not return valid JSON: %v (%q)", err, raw)
	}
	if filepath.Dir(result.Path) != destFolder {
		t.Fatalf("saved to %q, want inside %q", result.Path, destFolder)
	}
	if !strings.HasSuffix(result.Path, ".jsonl") {
		t.Fatalf("saved path %q does not look like a .jsonl file", result.Path)
	}
	data, err := os.ReadFile(result.Path)
	if err != nil {
		t.Fatalf("the saved diagnostics file could not be read: %v", err)
	}
	if !strings.Contains(string(data), run.ID()) {
		t.Fatalf("the saved diagnostics file does not mention the run: %s", data)
	}
}

func TestSystemCopyDiagnosticsRefusesLastRunWithNothingLoggedYet(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.pickDiagnosticsFolder = func() (string, error) { return t.TempDir(), nil }

	if _, err := host.copyDiagnostics(CopyDiagnosticsLastRun); err == nil {
		t.Fatal("expected an error when nothing has run yet")
	}
}

func TestSystemCopyDiagnosticsWithNoFolderChosenSavesNothing(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.runLog.Begin("guide").End("ok")
	host.pickDiagnosticsFolder = func() (string, error) { return "", nil }

	path, err := host.copyDiagnostics(CopyDiagnosticsLastRun)
	if err != nil {
		t.Fatal(err)
	}
	if path != "" {
		t.Fatalf("path = %q, want empty when the narrator cancelled the folder picker", path)
	}
}

func TestSystemCopyDiagnosticsLast30MinutesUsesTheWindowScope(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.runLog.Begin("guide").End("ok")
	destFolder := t.TempDir()
	host.pickDiagnosticsFolder = func() (string, error) { return destFolder, nil }

	path, err := host.copyDiagnostics(CopyDiagnosticsLast30Min)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != destFolder {
		t.Fatalf("saved to %q, want inside %q", path, destFolder)
	}
}
