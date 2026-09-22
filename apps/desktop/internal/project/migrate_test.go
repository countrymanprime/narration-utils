package project

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestEnsureDawLinkReusesAnAlreadyLinkedManifestWithoutTouchingDisk(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")
	manifest := New("Alice", fixedNow())
	manifest.DawProjectFile = &DawLink{Absolute: rpp, Relative: "alice.rpp"}

	link, changed, err := EnsureDawLink(project, manifest, "")
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if changed {
		t.Fatalf("changed = true, want false: an already-resolving link needs no migration")
	}
	if link.Absolute != rpp {
		t.Fatalf("link.Absolute = %q, want %q", link.Absolute, rpp)
	}
}

func TestEnsureDawLinkMigratesFromTracksSelectedRppWhenNoManifestLinkResolves(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")

	link, changed, err := EnsureDawLink(project, nil, rpp)
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if !changed {
		t.Fatalf("changed = false, want true: a fresh migration from Tracks.selectedRpp")
	}
	if link.Absolute != rpp || link.Relative != "alice.rpp" {
		t.Fatalf("link = %+v, want absolute %q and relative %q", link, rpp, "alice.rpp")
	}
}

func TestEnsureDawLinkIgnoresATracksSelectedRppThatNoLongerExistsOnDisk(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")
	stale := filepath.Join(project, "gone.rpp")

	link, changed, err := EnsureDawLink(project, nil, stale)
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if !changed {
		t.Fatalf("changed = false, want true: falls through to auto-adopting the sole .rpp")
	}
	if link.Absolute != rpp {
		t.Fatalf("link.Absolute = %q, want the sole real .rpp %q", link.Absolute, rpp)
	}
}

func TestEnsureDawLinkSilentlyAutoAdoptsASoleRppWhenNothingElseResolves(t *testing.T) {
	project := t.TempDir()
	rpp := filepath.Join(project, "alice.rpp")
	writeFile(t, rpp, "rpp")

	link, changed, err := EnsureDawLink(project, nil, "")
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if !changed {
		t.Fatalf("changed = false, want true: the sole .rpp was silently adopted")
	}
	if link.Absolute != rpp {
		t.Fatalf("link.Absolute = %q, want %q", link.Absolute, rpp)
	}
}

func TestEnsureDawLinkAsksInsteadOfGuessingWhenSeveralRppFilesExist(t *testing.T) {
	project := t.TempDir()
	writeFile(t, filepath.Join(project, "alice.rpp"), "rpp")
	writeFile(t, filepath.Join(project, "alice-2.rpp"), "rpp")

	_, changed, err := EnsureDawLink(project, nil, "")
	if err == nil {
		t.Fatalf("EnsureDawLink() error = nil, want ErrAmbiguousRpp")
	}
	var ambiguous *AmbiguousRppError
	if !errors.As(err, &ambiguous) {
		t.Fatalf("error = %v (%T), want *AmbiguousRppError", err, err)
	}
	if len(ambiguous.Candidates) != 2 {
		t.Fatalf("Candidates = %v, want 2 entries", ambiguous.Candidates)
	}
	if changed {
		t.Fatalf("changed = true, want false when the caller must choose")
	}
}

func TestEnsureDawLinkReturnsNothingToLinkWhenTheFolderHasNoRppAndNothingToMigrate(t *testing.T) {
	project := t.TempDir()

	link, changed, err := EnsureDawLink(project, nil, "")
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if changed {
		t.Fatalf("changed = true, want false: nothing to link")
	}
	if link != (DawLink{}) {
		t.Fatalf("link = %+v, want the zero value", link)
	}
}

func TestEnsureDawLinkPrefersTheAlreadyLinkedManifestOverASoleRppElsewhere(t *testing.T) {
	project := t.TempDir()
	linked := filepath.Join(t.TempDir(), "alice.rpp")
	writeFile(t, linked, "rpp")
	// A second .rpp lives in the project folder itself; it must not override an
	// existing, still-resolving manifest link (W3 only auto-adopts when nothing
	// already resolves).
	writeFile(t, filepath.Join(project, "other.rpp"), "rpp")
	manifest := New("Alice", fixedNow())
	manifest.DawProjectFile = &DawLink{Absolute: linked}

	link, changed, err := EnsureDawLink(project, manifest, "")
	if err != nil {
		t.Fatalf("EnsureDawLink() error = %v", err)
	}
	if changed {
		t.Fatalf("changed = true, want false")
	}
	if link.Absolute != linked {
		t.Fatalf("link.Absolute = %q, want %q", link.Absolute, linked)
	}
}
