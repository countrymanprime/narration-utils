package wiktextract

import (
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommonsAudioURLBuildsTheSpecialFilePathAddress(t *testing.T) {
	got, err := CommonsAudioURL("En-us-happy.ogg")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-happy.ogg"
	if got != want {
		t.Fatalf("CommonsAudioURL = %q, want %q", got, want)
	}
}

func TestCommonsAudioURLEscapesSpacesAndParentheses(t *testing.T) {
	got, err := CommonsAudioURL("LL-Q1860 (eng)-Nizil Shah-happy.wav")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://commons.wikimedia.org/wiki/Special:FilePath/LL-Q1860%20%28eng%29-Nizil%20Shah-happy.wav"
	if got != want {
		t.Fatalf("CommonsAudioURL = %q, want %q", got, want)
	}
}

func TestCommonsAudioURLRefusesAnEmptyFilename(t *testing.T) {
	if _, err := CommonsAudioURL(""); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("err = %v, want ErrNoAudio", err)
	}
	if _, err := CommonsAudioURL("   "); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("err = %v, want ErrNoAudio", err)
	}
}

func TestWordAudioURLFindsAWordCaseAndSpaceInsensitively(t *testing.T) {
	words := map[string]WordEntry{"happy": {IPA: "/ˈhæpi/", Audio: "En-us-happy.ogg"}}
	got, err := WordAudioURL(words, "  Happy  ")
	if err != nil {
		t.Fatal(err)
	}
	want := "https://commons.wikimedia.org/wiki/Special:FilePath/En-us-happy.ogg"
	if got != want {
		t.Fatalf("WordAudioURL = %q, want %q", got, want)
	}
}

func TestWordAudioURLRefusesAWordNotInTheIndex(t *testing.T) {
	words := map[string]WordEntry{"happy": {IPA: "/ˈhæpi/", Audio: "En-us-happy.ogg"}}
	if _, err := WordAudioURL(words, "sad"); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("err = %v, want ErrNoAudio", err)
	}
}

func TestWordAudioURLRefusesAWordIndexedWithNoAudioFile(t *testing.T) {
	words := map[string]WordEntry{"stoic": {IPA: "/ˈstoʊɪk/"}}
	if _, err := WordAudioURL(words, "stoic"); !errors.Is(err, ErrNoAudio) {
		t.Fatalf("err = %v, want ErrNoAudio", err)
	}
}

// TestPackageNeverImportsNet mirrors pronunciationlookup's own TestPackageNeverImportsNetHTTP (Success Metrics: "no
// client is constructed for BrowserLookup/Commons"): a static import check over this package's own production files,
// so it holds even for a code path a future edit never exercises at runtime. Test files are excluded (catalog_test.go
// legitimately imports net/http/httptest to drive the install pipeline end to end), the same "!$test" scope
// .golangci.yml's own no-network-outside-the-download-flow depguard rule uses.
func TestPackageNeverImportsNet(t *testing.T) {
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	found := false
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		found = true
		file, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range file.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			if path == "net" || strings.HasPrefix(path, "net/") {
				t.Fatalf("%s imports %q: this package must never construct a network client", name, path)
			}
		}
	}
	if !found {
		t.Fatal("no .go files found to check")
	}
}
