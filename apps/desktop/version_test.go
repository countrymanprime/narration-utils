package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The stamp is how every release learns its own version, so it is tested the way it is used: build this package with the
// same -X flag scripts/release/wails-build.mjs passes and ask the program for its version.
func TestTheStampedVersionIsWhatTheProgramReports(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the program")
	}
	name := "narration-utils-under-test"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join(t.TempDir(), name)
	build := exec.Command("go", "build", "-ldflags", "-X main.version=9.8.7", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, output)
	}
	output, err := exec.Command(binary, "--version").Output()
	if err != nil {
		t.Fatalf("%s --version: %v", binary, err)
	}
	if got := strings.TrimSpace(string(output)); got != "9.8.7" {
		t.Fatalf("--version printed %q, want 9.8.7", got)
	}
	if _, err := os.Stat(binary); err != nil {
		t.Fatal(err)
	}
}

func TestVersionRequestIsRecognisedOnlyAsTheOnlyArgument(t *testing.T) {
	for _, test := range []struct {
		arguments []string
		want      bool
	}{
		{[]string{"--version"}, true},
		{nil, false},
		{[]string{"--project-folder", "C:/p"}, false},
		{[]string{"--version", "--project-folder", "C:/p"}, false},
		{[]string{"--project-name", "--version"}, false},
	} {
		if got := isVersionRequest(test.arguments); got != test.want {
			t.Errorf("isVersionRequest(%q) = %v, want %v", test.arguments, got, test.want)
		}
	}
}
