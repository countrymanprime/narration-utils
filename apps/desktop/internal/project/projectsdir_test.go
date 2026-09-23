package project

import (
	"os"
	"path/filepath"
	"testing"
)

// clearHomeEnv wipes every env var DefaultDir consults, so a test controls
// exactly which one (if any) is set, regardless of the host machine running it.
func clearHomeEnv(t *testing.T) {
	t.Helper()
	t.Setenv("USERPROFILE", "")
	t.Setenv("HOME", "")
}

func TestDefaultDirResolvesToNarrationUtilsUnderUSERPROFILE(t *testing.T) {
	clearHomeEnv(t)
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)

	dir, err := DefaultDir()
	if err != nil {
		t.Fatalf("DefaultDir() error = %v", err)
	}
	if want := filepath.Join(home, "NarrationUtils"); dir != want {
		t.Fatalf("DefaultDir() = %q, want %q", dir, want)
	}
}

func TestDefaultDirFallsBackToHOMEWhenUSERPROFILEIsUnset(t *testing.T) {
	clearHomeEnv(t)
	home := t.TempDir()
	t.Setenv("HOME", home)

	dir, err := DefaultDir()
	if err != nil {
		t.Fatalf("DefaultDir() error = %v", err)
	}
	if want := filepath.Join(home, "NarrationUtils"); dir != want {
		t.Fatalf("DefaultDir() = %q, want %q", dir, want)
	}
}

func TestDefaultDirFailsNonFatallyWhenNoHomeDirectoryCanBeResolved(t *testing.T) {
	clearHomeEnv(t)

	_, err := DefaultDir()
	if err == nil {
		t.Fatalf("DefaultDir() error = nil, want an error the caller can log and continue past")
	}
}

func TestEnsureDirCreatesAMissingDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "NarrationUtils")

	if err := EnsureDir(dir); err != nil {
		t.Fatalf("EnsureDir() error = %v", err)
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		t.Fatalf("EnsureDir() did not create a directory at %s: %v", dir, err)
	}
}

func TestEnsureDirIsANoOpWhenTheDirectoryAlreadyExists(t *testing.T) {
	dir := t.TempDir()

	if err := EnsureDir(dir); err != nil {
		t.Fatalf("EnsureDir() error = %v", err)
	}
}

func TestEnsureDirFailsNonFatallyOnAnEmptyPath(t *testing.T) {
	if err := EnsureDir(""); err == nil {
		t.Fatalf("EnsureDir(\"\") error = nil, want an error")
	}
}

func TestResolveDirPrefersAGlobalOverrideOverTheComputedDefault(t *testing.T) {
	clearHomeEnv(t)
	t.Setenv("USERPROFILE", t.TempDir())
	override := filepath.Join(t.TempDir(), "Books")

	dir, err := ResolveDir(override)
	if err != nil {
		t.Fatalf("ResolveDir() error = %v", err)
	}
	if dir != override {
		t.Fatalf("ResolveDir() = %q, want the override %q", dir, override)
	}
}

func TestResolveDirFallsBackToTheComputedDefaultWhenNoOverrideIsSet(t *testing.T) {
	clearHomeEnv(t)
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)

	dir, err := ResolveDir("")
	if err != nil {
		t.Fatalf("ResolveDir() error = %v", err)
	}
	if want := filepath.Join(home, "NarrationUtils"); dir != want {
		t.Fatalf("ResolveDir() = %q, want %q", dir, want)
	}
}
