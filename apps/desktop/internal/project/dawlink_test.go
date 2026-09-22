package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildDawLinkStoresBothTheAbsoluteAndProjectRelativePath(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")

	link, err := BuildDawLink(project, rpp)
	if err != nil {
		t.Fatalf("BuildDawLink() error = %v", err)
	}
	if link.Absolute != rpp {
		t.Fatalf("Absolute = %q, want %q", link.Absolute, rpp)
	}
	if link.Relative != "alice.rpp" {
		t.Fatalf("Relative = %q, want %q", link.Relative, "alice.rpp")
	}
}

func TestBuildDawLinkOnAFileOutsideTheProjectFolderStillStoresTheAbsolutePath(t *testing.T) {
	project := t.TempDir()
	elsewhere := t.TempDir()
	rpp := filepath.Join(elsewhere, "alice.rpp")
	writeFile(t, rpp, "rpp")

	link, err := BuildDawLink(project, rpp)
	if err != nil {
		t.Fatalf("BuildDawLink() error = %v", err)
	}
	if link.Absolute != rpp {
		t.Fatalf("Absolute = %q, want %q", link.Absolute, rpp)
	}
	if link.Relative != "" {
		t.Fatalf("Relative = %q, want empty for a file outside the project folder", link.Relative)
	}
}

func TestResolvePrefersTheAbsolutePathWhenBothExist(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")
	link := DawLink{Absolute: rpp, Relative: "alice.rpp"}

	resolved, ok := link.Resolve(project)
	if !ok || resolved != rpp {
		t.Fatalf("Resolve() = %q, %v, want %q, true", resolved, ok, rpp)
	}
}

func TestResolveFallsBackToTheRelativePathWhenTheAbsoluteOneIsGone(t *testing.T) {
	project := t.TempDir()
	moved := filepath.Join(project, "alice.rpp")
	writeFile(t, moved, "rpp")
	// The absolute path recorded when the project lived somewhere else no longer exists,
	// but the file is still where the relative path says, inside the current project folder.
	link := DawLink{Absolute: filepath.Join(t.TempDir(), "alice.rpp"), Relative: "alice.rpp"}

	resolved, ok := link.Resolve(project)
	if !ok || resolved != moved {
		t.Fatalf("Resolve() = %q, %v, want %q, true", resolved, ok, moved)
	}
}

func TestResolveReturnsFalseWhenNeitherPathExists(t *testing.T) {
	project := t.TempDir()
	link := DawLink{Absolute: filepath.Join(project, "gone.rpp"), Relative: "gone.rpp"}

	_, ok := link.Resolve(project)
	if ok {
		t.Fatalf("Resolve() ok = true, want false")
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%s): %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", path, err)
	}
}
