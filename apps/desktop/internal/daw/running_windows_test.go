//go:build windows

package daw

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsRunningFindsThisTestProcessAndNotAMissingOne(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if !IsRunning(filepath.Base(self)) {
		t.Fatalf("IsRunning(%q) = false for the running test binary", filepath.Base(self))
	}
	if IsRunning("no-such-program-for-this-test.exe") {
		t.Fatal("IsRunning reported a program that is not running")
	}
}
