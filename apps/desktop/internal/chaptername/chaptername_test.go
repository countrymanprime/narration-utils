package chaptername

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

// fixtureCase is one row of tests/fixtures/chapter-names.json: a chapter's title and subtitle (null when the chapter
// has no subtitle field) and its name in every form. The Go, Python and TypeScript helpers all read it.
type fixtureCase struct {
	Title     string  `json:"title"`
	Subtitle  *string `json:"subtitle"`
	Full      string  `json:"full"`
	Short     string  `json:"short"`
	Plain     string  `json:"plain"`
	ReadAloud string  `json:"readAloud"`
}

type fixture struct {
	About string        `json:"about"`
	Cases []fixtureCase `json:"cases"`
}

func text(s string) *string { return &s }

// inputs are the cases the three languages must agree on: a plain title and subtitle, none, a legacy title holding
// its subtitle after a line break (with and without an explicit subtitle), separators the title already ends with,
// a separator inside a title, runs of whitespace (a tab and a no-break space included), three heading lines, an empty
// title, and text outside ASCII.
var inputs = []struct {
	title    string
	subtitle *string
}{
	{"CHAPTER ONE", text("Bad Ideas Look Great in Neon")},
	{"Prologue", nil},
	{"CHAPTER ONE\nBad Ideas Look Great in Neon", nil},
	{"CHAPTER ONE\nBad Ideas", text("")},
	{"CHAPTER ONE\nBad Ideas", text("The Real Subtitle")},
	{"Chapter 1:", text("The Beginning")},
	{"Chapter 3 —", text("Night")},
	{"Chapter 4 -  ", text("Dawn")},
	{"Chapter One: The Storm", nil},
	{"  A   Message from\tthe Author ", text("   ")},
	{"PART ONE\nCHAPTER TWO\nThe Storm", nil},
	{"", text("Only a Subtitle")},
	{"Épilogue", text("L’été — encore")},
	{"Ch 5", text("No break  here")},
}

func build() fixture {
	out := fixture{About: "Written by apps/desktop/internal/chaptername's test (UPDATE_CONTRACTS=1); never edit by hand. The Go, Python and TypeScript chapter-name helpers must each give these names."}
	for _, in := range inputs {
		out.Cases = append(out.Cases, fixtureCase{
			Title: in.title, Subtitle: in.subtitle,
			Full: Name(in.title, in.subtitle, Full), Short: Name(in.title, in.subtitle, Short),
			Plain: Name(in.title, in.subtitle, Plain), ReadAloud: Name(in.title, in.subtitle, Context("Read aloud")),
		})
	}
	return out
}

func TestTheNamesFollowTheRule(t *testing.T) {
	want := map[int][4]string{
		0:  {"CHAPTER ONE — Bad Ideas Look Great in Neon", "CHAPTER ONE", "CHAPTER ONE - Bad Ideas Look Great in Neon", "Read aloud: CHAPTER ONE — Bad Ideas Look Great in Neon"},
		1:  {"Prologue", "Prologue", "Prologue", "Read aloud: Prologue"},
		2:  {"CHAPTER ONE — Bad Ideas Look Great in Neon", "CHAPTER ONE", "CHAPTER ONE - Bad Ideas Look Great in Neon", "Read aloud: CHAPTER ONE — Bad Ideas Look Great in Neon"},
		3:  {"CHAPTER ONE", "CHAPTER ONE", "CHAPTER ONE", "Read aloud: CHAPTER ONE"},
		5:  {"Chapter 1 — The Beginning", "Chapter 1:", "Chapter 1 - The Beginning", "Read aloud: Chapter 1 — The Beginning"},
		6:  {"Chapter 3 — Night", "Chapter 3 —", "Chapter 3 - Night", "Read aloud: Chapter 3 — Night"},
		8:  {"Chapter One: The Storm", "Chapter One: The Storm", "Chapter One: The Storm", "Read aloud: Chapter One: The Storm"},
		9:  {"A Message from the Author", "A Message from the Author", "A Message from the Author", "Read aloud: A Message from the Author"},
		10: {"PART ONE — CHAPTER TWO The Storm", "PART ONE", "PART ONE - CHAPTER TWO The Storm", "Read aloud: PART ONE — CHAPTER TWO The Storm"},
		11: {"Only a Subtitle", "", "Only a Subtitle", "Read aloud: Only a Subtitle"},
		13: {"Ch 5 — No break here", "Ch 5", "Ch 5 - No break here", "Read aloud: Ch 5 — No break here"},
	}
	for i, in := range inputs {
		expected, ok := want[i]
		if !ok {
			continue
		}
		got := [4]string{Name(in.title, in.subtitle, Full), Name(in.title, in.subtitle, Short), Name(in.title, in.subtitle, Plain), Name(in.title, in.subtitle, Context("Read aloud"))}
		if got != expected {
			t.Errorf("case %d (%q, %v) = %q, want %q", i, in.title, in.subtitle, got, expected)
		}
	}
}

func TestAFullNameNeverDoublesASeparatorAndAlwaysHoldsTheShortOne(t *testing.T) {
	for _, in := range inputs {
		full, short := Name(in.title, in.subtitle, Full), Name(in.title, in.subtitle, Short)
		for _, bad := range []string{" —  — ", ": —", " — —", "  "} {
			if strings.Contains(full, bad) {
				t.Errorf("%q holds %q", full, bad)
			}
		}
		if strings.HasPrefix(full, " ") || strings.HasSuffix(full, " ") || strings.HasPrefix(full, "— ") || strings.HasSuffix(full, " —") {
			t.Errorf("%q has a leading or trailing separator or space", full)
		}
		if stripped := strings.TrimSpace(trailingSeparator.ReplaceAllString(short, "")); !strings.Contains(full, stripped) {
			t.Errorf("full %q does not hold short %q", full, short)
		}
	}
}

// TestTheSharedFixtureIsCurrent pins tests/fixtures/chapter-names.json to this package's output; UPDATE_CONTRACTS=1
// rewrites it.
func TestTheSharedFixtureIsCurrent(t *testing.T) {
	dir, err := contractfile.Dir()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(filepath.Dir(dir), "chapter-names.json")
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(build()); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(contractfile.UpdateEnv) != "" {
		if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v; run the test with %s=1", err, contractfile.UpdateEnv)
	}
	if !bytes.Equal(bytes.ReplaceAll(committed, []byte("\r\n"), []byte("\n")), buffer.Bytes()) {
		t.Fatalf("%s no longer matches the Go helper; run the test with %s=1 and check the Python and TypeScript helpers agree", path, contractfile.UpdateEnv)
	}
}
