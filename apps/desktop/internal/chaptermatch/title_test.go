package chaptermatch

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
)

// parityCases is tests/fixtures/chapter-track-match/parity-cases.json: what the
// Python matcher (find_chapter_by_track_name) returns for each input. The
// Python suite (sidecars/transcript-compare/tests/test_chapter_track_parity.py)
// reads the same file.
type parityCases struct {
	NormalizedTokens []struct {
		Input  string   `json:"input"`
		Tokens []string `json:"tokens"`
	} `json:"normalizedTokens"`
	Matches []struct {
		Name     string   `json:"name"`
		Chapters []string `json:"chapters"`
		Track    string   `json:"track"`
		Index    *int     `json:"index"`
		Score    float64  `json:"score"`
	} `json:"matches"`
}

func loadParity(t *testing.T) parityCases {
	t.Helper()
	raw, err := os.ReadFile(layout.RepoFile(layout.FixturesDir + "/chapter-track-match/parity-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases parityCases
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases.NormalizedTokens) == 0 || len(cases.Matches) == 0 {
		t.Fatal("the parity file holds no cases")
	}
	return cases
}

func TestNormalizedTokensMatchThePythonMatcher(t *testing.T) {
	for _, c := range loadParity(t).NormalizedTokens {
		got := NormalizedTokens(c.Input)
		if len(got) == 0 && len(c.Tokens) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.Tokens) {
			t.Errorf("NormalizedTokens(%q) = %q, want %q", c.Input, got, c.Tokens)
		}
	}
}

func TestFindChapterByTrackNameMatchesThePythonMatcher(t *testing.T) {
	for _, c := range loadParity(t).Matches {
		t.Run(c.Name, func(t *testing.T) {
			index, score := FindChapterByTrackName(c.Chapters, c.Track)
			want := -1
			if c.Index != nil {
				want = *c.Index
			}
			if index != want {
				t.Fatalf("index = %d, want %d", index, want)
			}
			if math.Abs(score-c.Score) > 1e-12 {
				t.Fatalf("score = %.17g, want %.17g", score, c.Score)
			}
		})
	}
}

func TestTheEmbeddedHomophoneListIsTheSidecarsOwn(t *testing.T) {
	sidecar, err := os.ReadFile(layout.RepoFile("sidecars/transcript-compare/core/homophones.csv"))
	if err != nil {
		t.Fatal(err)
	}
	normalize := func(text string) string { return strings.ReplaceAll(text, "\r\n", "\n") }
	if normalize(string(sidecar)) != normalize(homophonesCSV) {
		t.Fatal("apps/desktop/internal/chaptermatch/homophones.csv drifted from sidecars/transcript-compare/core/homophones.csv; copy it again")
	}
}

func TestSequenceRatioMatchesDifflib(t *testing.T) {
	// Values from Python's difflib.SequenceMatcher(None, a, b).ratio().
	cases := []struct {
		a, b string
		want float64
	}{
		{"", "", 1},
		{"abc", "", 0},
		{"abcd", "bcde", 0.75},
		{"chapter 11", "chapter 1", 18.0 / 19.0},
		{"the beginning", "the begining", 0.96},
		{"private thread", "thread private", 0.5},
	}
	for _, c := range cases {
		if got := sequenceRatio(c.a, c.b); math.Abs(got-c.want) > 1e-12 {
			t.Errorf("sequenceRatio(%q, %q) = %.17g, want %.17g", c.a, c.b, got, c.want)
		}
	}
}
