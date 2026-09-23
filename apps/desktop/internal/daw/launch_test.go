package daw

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// launchHelperEnv, when set, makes this test binary itself stand in for the program Launch starts: TestMain
// intercepts before the real test suite runs, the same self-exec pattern apps/desktop/internal/guide/preview_test.go
// uses for a fake sidecar.
const launchHelperEnv = "NARRATION_UTILS_DAW_LAUNCH_TEST_HELPER"

func TestMain(m *testing.M) {
	if marker := os.Getenv(launchHelperEnv); marker != "" {
		_ = os.WriteFile(marker, []byte("ok"), 0o600)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestLaunchStartsADetachedProcessThatOutlivesTheCaller(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "launched.marker")
	t.Setenv(launchHelperEnv, marker)
	if err := Launch(exe); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(marker); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the launched process never wrote its marker file")
}

func TestLaunchReturnsAnErrorForAProgramThatDoesNotExist(t *testing.T) {
	if err := Launch(filepath.Join(t.TempDir(), "does-not-exist.exe")); err == nil {
		t.Fatal("want an error launching a program that does not exist")
	}
}
