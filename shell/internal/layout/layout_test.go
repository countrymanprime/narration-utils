package layout

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPathJoinsASlashSeparatedRepoRelativePathOntoTheRoot(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "repo")

	got := Path(root, "a/b/c.txt")

	want := filepath.Join(root, "a", "b", "c.txt")
	if got != want {
		t.Fatalf("Path = %q, want %q", got, want)
	}
}

func TestFindRootWalksUpToTheDirectoryHoldingTheDefaultsFile(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(Path(root, ConfigDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(Path(root, DefaultsFile), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	nested := Path(root, DesktopDir+"/nested/deeper")

	if got := FindRoot(nested); got != root {
		t.Fatalf("FindRoot = %q, want %q", got, root)
	}
}

func TestFindRootReturnsTheFilesystemRootWhenNoCheckoutIsFound(t *testing.T) {
	got := FindRoot(t.TempDir())

	if filepath.Dir(got) != got {
		t.Fatalf("FindRoot = %q, want a filesystem root so a packaged build stays resource-relative", got)
	}
}

func TestEveryRepoRelativePathNamesSomethingInTheCheckout(t *testing.T) {
	paths := map[string]string{
		"DesktopDir":               DesktopDir,
		"ConfigDir":                ConfigDir,
		"DefaultsFile":             DefaultsFile,
		"TTSCatalogFile":           TTSCatalogFile,
		"WhisperCatalogFile":       WhisperCatalogFile,
		"ReaperDir":                ReaperDir,
		"LauncherFile":             LauncherFile,
		"FixturesDir":              FixturesDir,
		"ManuscriptGuideBackend":   ManuscriptGuideBackend,
		"TranscriptCompareBackend": TranscriptCompareBackend,
		"TeleprompterBackend":      TeleprompterBackend,
	}
	for name, rel := range paths {
		if _, err := os.Stat(RepoFile(rel)); err != nil {
			t.Errorf("%s = %q does not exist in the checkout: %v", name, rel, err)
		}
	}
}
