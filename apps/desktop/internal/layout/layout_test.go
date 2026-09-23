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

// writeFiles creates each repo-relative file (empty JSON) under root.
func writeFiles(t *testing.T, root string, rels ...string) {
	t.Helper()
	for _, rel := range rels {
		if err := os.MkdirAll(filepath.Dir(Path(root, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(Path(root, rel), []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFindRootWalksUpToTheCheckoutRoot(t *testing.T) {
	root := t.TempDir()
	writeFiles(t, root, DefaultsFile, DesktopConfigFile)
	nested := Path(root, DesktopDir+"/nested/deeper")

	if got := FindRoot(nested); got != root {
		t.Fatalf("FindRoot = %q, want %q", got, root)
	}
}

func TestFindRootIgnoresAForeignProjectThatOnlyHasAConfigDefaultsFile(t *testing.T) {
	foreign := t.TempDir()
	writeFiles(t, foreign, DefaultsFile)

	got := FindRoot(Path(foreign, "some/where"))

	if got == foreign || filepath.Dir(got) != got {
		t.Fatalf("FindRoot = %q, want the filesystem root: %s alone does not mark this repository", got, DefaultsFile)
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
		"DesktopConfigFile":        DesktopConfigFile,
		"ConfigDir":                ConfigDir,
		"DefaultsFile":             DefaultsFile,
		"TTSCatalogFile":           TTSCatalogFile,
		"WhisperCatalogFile":       WhisperCatalogFile,
		"SpacyCatalogFile":         SpacyCatalogFile,
		"MoonshineCatalogFile":     MoonshineCatalogFile,
		"DictionaryCatalogFile":    DictionaryCatalogFile,
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
