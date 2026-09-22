package project

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeManifestWithLink creates projectsDir/name as a project folder whose
// manifest links rpp, and returns the project folder path.
func writeManifestWithLink(t *testing.T, projectsDir, name, rpp string) string {
	t.Helper()
	folder := filepath.Join(projectsDir, name)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	link, err := BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := New(name, fixedNow())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}
	return folder
}

func TestFindByDawFileMatchesTheProjectWhoseManifestLinksTheRpp(t *testing.T) {
	projectsDir := t.TempDir()
	rpp := filepath.Join(projectsDir, "Elsewhere", "Book.rpp")
	writeFile(t, rpp, "rpp")
	want := writeManifestWithLink(t, projectsDir, "Alice", rpp)
	// A second, unrelated project must not confuse the match.
	otherRpp := filepath.Join(projectsDir, "Other.rpp")
	writeFile(t, otherRpp, "rpp")
	writeManifestWithLink(t, projectsDir, "Voltage", otherRpp)

	folder, name, ok := FindByDawFile(nil, projectsDir, rpp)
	if !ok {
		t.Fatal("ok = false, want true: one project links this exact rpp")
	}
	if folder != want {
		t.Fatalf("folder = %q, want %q", folder, want)
	}
	if name != "Alice" {
		t.Fatalf("name = %q, want %q", name, "Alice")
	}
}

func TestFindByDawFileMatchesARelativeLinkResolvedAgainstItsOwnProjectFolder(t *testing.T) {
	projectsDir := t.TempDir()
	folder := filepath.Join(projectsDir, "Alice")
	rpp := filepath.Join(folder, "Alice.rpp")
	writeFile(t, rpp, "rpp")
	writeManifestWithLink(t, projectsDir, "Alice", rpp)

	got, name, ok := FindByDawFile(nil, projectsDir, rpp)
	if !ok || got != folder || name != "Alice" {
		t.Fatalf("FindByDawFile() = (%q, %q, %v), want (%q, %q, true)", got, name, ok, folder, "Alice")
	}
}

func TestFindByDawFileMatchesCaseInsensitivelyLikeWindowsPaths(t *testing.T) {
	projectsDir := t.TempDir()
	rpp := filepath.Join(projectsDir, "Alice", "Book.rpp")
	writeFile(t, rpp, "rpp")
	folder := writeManifestWithLink(t, projectsDir, "Alice", rpp)

	upper := strings.ToUpper(rpp)
	got, _, ok := FindByDawFile(nil, projectsDir, upper)
	if !ok || got != folder {
		t.Fatalf("FindByDawFile(upper-cased rpp) = (%q, %v), want (%q, true)", got, ok, folder)
	}
}

func TestFindByDawFileReturnsNotOkWhenNoProjectLinksTheRpp(t *testing.T) {
	projectsDir := t.TempDir()
	rpp := filepath.Join(projectsDir, "Book.rpp")
	writeFile(t, rpp, "rpp")
	writeManifestWithLink(t, projectsDir, "Alice", filepath.Join(projectsDir, "Different.rpp"))

	_, _, ok := FindByDawFile(nil, projectsDir, rpp)
	if ok {
		t.Fatal("ok = true, want false: no manifest links this rpp")
	}
}

func TestFindByDawFileIgnoresProjectFoldersWithNoManifestOrNoLink(t *testing.T) {
	projectsDir := t.TempDir()
	rpp := filepath.Join(projectsDir, "Book.rpp")
	writeFile(t, rpp, "rpp")
	// A folder with no manifest at all.
	if err := os.MkdirAll(filepath.Join(projectsDir, "NotAProject"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A folder with a manifest but no DAW link.
	unlinked := filepath.Join(projectsDir, "Unlinked")
	if err := os.MkdirAll(unlinked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := New("Unlinked", fixedNow()).Save(unlinked); err != nil {
		t.Fatal(err)
	}

	_, _, ok := FindByDawFile(nil, projectsDir, rpp)
	if ok {
		t.Fatal("ok = true, want false: nothing here links the rpp")
	}
}

func TestFindByDawFileReturnsNotOkWhenTheLinkedFileNoLongerExists(t *testing.T) {
	projectsDir := t.TempDir()
	rpp := filepath.Join(projectsDir, "Book.rpp")
	writeFile(t, rpp, "rpp")
	writeManifestWithLink(t, projectsDir, "Alice", rpp)
	if err := os.Remove(rpp); err != nil {
		t.Fatal(err)
	}

	_, _, ok := FindByDawFile(nil, projectsDir, rpp)
	if ok {
		t.Fatal("ok = true, want false: the linked file no longer resolves")
	}
}

func TestFindByDawFileWithAnEmptyRppOrProjectsDirIsNotOk(t *testing.T) {
	projectsDir := t.TempDir()
	if _, _, ok := FindByDawFile(nil, projectsDir, ""); ok {
		t.Fatal("ok = true with an empty rpp path, want false (unsaved REAPER project, W5)")
	}
	if _, _, ok := FindByDawFile(nil, "", filepath.Join(projectsDir, "Book.rpp")); ok {
		t.Fatal("ok = true with no projects directory, want false")
	}
}

func TestFindByDawFileWithAnUnreadableProjectsDirIsNotOk(t *testing.T) {
	_, _, ok := FindByDawFile(nil, filepath.Join(t.TempDir(), "does-not-exist"), "C:\\some\\Book.rpp")
	if ok {
		t.Fatal("ok = true for a projects directory that cannot be listed, want false")
	}
}
