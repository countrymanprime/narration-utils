package pronunciationlookup

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestURLBuildsEachSitesTemplate(t *testing.T) {
	tests := []struct {
		name   string
		source Source
		word   string
		want   string
	}{
		{"forvo, one word", Forvo, "croquet", "https://forvo.com/word/croquet/"},
		{"forvo, a space", Forvo, "Mock Turtle", "https://forvo.com/word/Mock%20Turtle/"},
		{"forvo, an accent", Forvo, "café", "https://forvo.com/word/caf%C3%A9/"},
		{"youglish, one word", YouGlish, "croquet", "https://youglish.com/pronounce/croquet/english"},
		{"youglish, a space", YouGlish, "Mock Turtle", "https://youglish.com/pronounce/Mock%20Turtle/english"},
		{"youglish, an accent", YouGlish, "café", "https://youglish.com/pronounce/caf%C3%A9/english"},
		{"merriam-webster, one word", MerriamWebster, "croquet", "https://www.merriam-webster.com/dictionary/croquet"},
		{"merriam-webster, a space", MerriamWebster, "Mock Turtle", "https://www.merriam-webster.com/dictionary/Mock%20Turtle"},
		{"merriam-webster, an accent", MerriamWebster, "café", "https://www.merriam-webster.com/dictionary/caf%C3%A9"},
		// Howjsay (Phase 0 assumption, unverified): a space becomes a hyphen in its "how-to-pronounce-<word>" slug,
		// before path escaping the rest.
		{"howjsay, one word", Howjsay, "croquet", "https://howjsay.com/how-to-pronounce-croquet"},
		{"howjsay, a space becomes a hyphen", Howjsay, "Mock Turtle", "https://howjsay.com/how-to-pronounce-Mock-Turtle"},
		{"howjsay, an accent", Howjsay, "café", "https://howjsay.com/how-to-pronounce-caf%C3%A9"},
		// Punctuation the narrator's manuscript might carry into a name (an apostrophe, a period).
		{"forvo, punctuation", Forvo, "O'Brien's Jr.", "https://forvo.com/word/O%27Brien%27s%20Jr./"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := URL(tt.source, tt.word)
			if err != nil {
				t.Fatalf("URL(%q, %q) error = %v", tt.source, tt.word, err)
			}
			if got != tt.want {
				t.Errorf("URL(%q, %q) = %q, want %q", tt.source, tt.word, got, tt.want)
			}
		})
	}
}

func TestURLRefusesAnUnknownSource(t *testing.T) {
	if _, err := URL(Source("wiktionary"), "croquet"); err == nil {
		t.Fatal("URL with an unknown source = nil error, want one")
	}
}

func TestURLRefusesAnEmptyWord(t *testing.T) {
	if _, err := URL(Forvo, ""); err == nil {
		t.Fatal("URL with an empty word = nil error, want one")
	}
	if _, err := URL(Forvo, "   "); err == nil {
		t.Fatal("URL with a blank word = nil error, want one")
	}
}

func TestSourcesListsExactlyTheFourSites(t *testing.T) {
	want := []Source{Forvo, YouGlish, MerriamWebster, Howjsay}
	got := Sources()
	if len(got) != len(want) {
		t.Fatalf("Sources() = %v, want %v", got, want)
	}
	for i, source := range want {
		if got[i] != source {
			t.Errorf("Sources()[%d] = %q, want %q", i, got[i], source)
		}
	}
}

// The app never fetches, scrapes or caches a lookup site (PRD "What We're NOT Building"; Success Metrics: "No network
// call from the app for a lookup"): this package never imports net/http, so it cannot construct an HTTP client no
// matter what a future edit adds to it. A static import check, not a runtime one, so it holds even for a code path
// this test never exercises.
func TestPackageNeverImportsNetHTTP(t *testing.T) {
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
		if entry.IsDir() || !strings.HasSuffix(name, ".go") {
			continue
		}
		found = true
		file, err := parser.ParseFile(fset, filepath.Join(dir, name), nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, imp := range file.Imports {
			path := strings.Trim(imp.Path.Value, `"`)
			if path == "net/http" || strings.HasPrefix(path, "net/http/") {
				t.Errorf("%s imports %q; this package must never construct an HTTP client", name, path)
			}
		}
	}
	if !found {
		t.Fatal("found no .go files in this package to check")
	}
}
