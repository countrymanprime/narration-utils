package wiktextract

import (
	"os"
	"path/filepath"
	"testing"
)

// wiktextractFixture is a few lines in the real Wiktextract JSON Lines shape (docs/research/wiktextract-pronunciation-source.md):
// one JSON object per line, a "word" and a "sounds" list carrying "ipa" and/or "audio".
const wiktextractFixture = `{"word": "happy", "pos": "adj", "sounds": [{"ipa": "/ˈhæpi/", "tags": ["General-American"]}, {"audio": "En-us-happy.ogg"}]}
{"word": "run", "pos": "v", "sounds": [{"ipa": "/ɹʌn/"}]}
{"word": "run", "pos": "n", "sounds": [{"ipa": "/ɹʌn/ (a second sense, ignored: the first entry for a word wins)"}]}
{"word": "cat burglar", "pos": "n", "sounds": [{"ipa": "/ˈkæt ˌbɜːɡlɚ/"}]}
{"word": "silent", "pos": "adj", "sounds": [{"audio": "En-us-silent.ogg"}]}
{"word": "", "sounds": [{"ipa": "/blank/"}]}
not json at all
`

func writeFixtureDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "en-extract.jsonl"), []byte(wiktextractFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	// A file BuildIndex must ignore.
	if err := os.WriteFile(filepath.Join(dir, "README.txt"), []byte("not a jsonl file"), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestBuildIndexKeepsOneEntryPerSingleWordHeadwordWithAnIPA(t *testing.T) {
	dir := writeFixtureDir(t)
	built := filepath.Join(t.TempDir(), IndexName)
	if err := BuildIndex(dir, built); err != nil {
		t.Fatal(err)
	}
	words, err := LoadIndex(built)
	if err != nil {
		t.Fatal(err)
	}

	if got, want := words["happy"].IPA, "/ˈhæpi/"; got != want {
		t.Errorf("happy.ipa = %q, want %q", got, want)
	}
	if got, want := words["happy"].Audio, "En-us-happy.ogg"; got != want {
		t.Errorf("happy.audio = %q, want %q", got, want)
	}
	if got, want := words["run"].IPA, "/ɹʌn/"; got != want {
		t.Errorf("run.ipa = %q (first sense must win over the second), want %q", got, want)
	}
	if _, ok := words["cat burglar"]; ok {
		t.Error(`"cat burglar" (a multi-word headword) must not appear in the index`)
	}
	if _, ok := words["silent"]; ok {
		t.Error(`"silent" (an entry with no ipa) must not appear in the index`)
	}
	if _, ok := words[""]; ok {
		t.Error("a blank word must not appear in the index")
	}
	if got, want := len(words), 2; got != want {
		t.Errorf("len(words) = %d, want %d (happy, run only): %v", got, want, words)
	}
}

func TestBuildIndexIgnoresFilesThatAreNotJsonl(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte(`{"word": "ignored", "sounds": [{"ipa": "/x/"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	built := filepath.Join(t.TempDir(), IndexName)
	if err := BuildIndex(dir, built); err != nil {
		t.Fatal(err)
	}
	words, err := LoadIndex(built)
	if err != nil {
		t.Fatal(err)
	}
	if len(words) != 0 {
		t.Errorf("words = %v, want none (a .txt file must be ignored)", words)
	}
}

func TestBuildIndexRefusesAMissingDirectory(t *testing.T) {
	built := filepath.Join(t.TempDir(), IndexName)
	if err := BuildIndex(filepath.Join(t.TempDir(), "does-not-exist"), built); err == nil {
		t.Fatal("want an error for a missing release directory")
	}
}
