package teleprompter

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAnchorsRoundTripSortedAndDeduplicated(t *testing.T) {
	project := t.TempDir()
	for _, anchor := range []Anchor{{Word: 10, Position: 5}, {Word: 2, Position: 1}, {Word: 10, Position: 5.5}} {
		if err := AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	got, err := LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	want := []Anchor{{Word: 2, Position: 1}, {Word: 10, Position: 5.5}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("LoadAnchors = %+v, want %+v", got, want)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "teleprompter", "c1.anchors.json")); err != nil {
		t.Fatal(err)
	}
	if other, err := LoadAnchors(project, "c2"); err != nil || other != nil {
		t.Fatalf("another chapter's anchors = %+v, %v", other, err)
	}
}

func TestAppendAnchorCapsTheFileAtMaxAnchorsKeepingTheNewest(t *testing.T) {
	project := t.TempDir()
	for word := 0; word < maxAnchors+10; word++ {
		if err := AppendAnchor(project, "c1", Anchor{Word: word, Position: float64(word)}); err != nil {
			t.Fatal(err)
		}
	}
	got, err := LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != maxAnchors {
		t.Fatalf("len(got) = %d, want %d", len(got), maxAnchors)
	}
	if got[0].Word != 10 || got[len(got)-1].Word != maxAnchors+9 {
		t.Fatalf("kept the wrong window: first %+v last %+v", got[0], got[len(got)-1])
	}
}

func TestDropAnchorsFromRemovesAWordAndEverythingAfterIt(t *testing.T) {
	project := t.TempDir()
	for _, anchor := range []Anchor{{Word: 1, Position: 1}, {Word: 5, Position: 5}, {Word: 9, Position: 9}} {
		if err := AppendAnchor(project, "c1", anchor); err != nil {
			t.Fatal(err)
		}
	}
	if err := DropAnchorsFrom(project, "c1", 5); err != nil {
		t.Fatal(err)
	}
	got, err := LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Word != 1 {
		t.Fatalf("LoadAnchors after drop = %+v", got)
	}
}

func TestLoadAnchorsIsEmptyWithNoFile(t *testing.T) {
	project := t.TempDir()
	got, err := LoadAnchors(project, "c1")
	if err != nil || got != nil {
		t.Fatalf("LoadAnchors = %+v, %v", got, err)
	}
}

func TestLoadAnchorsIgnoresACorruptFile(t *testing.T) {
	project := t.TempDir()
	dir := filepath.Join(project, "narration-utils", "teleprompter")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "c1.anchors.json"), []byte("not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadAnchors(project, "c1")
	if err != nil || got != nil {
		t.Fatalf("LoadAnchors of a corrupt file = %+v, %v", got, err)
	}
}

func TestResolveWordTimeWithNoAnchorsCannotResolve(t *testing.T) {
	if _, _, ok := ResolveWordTime(nil, 5); ok {
		t.Fatal("resolved with no anchors")
	}
}

func TestResolveWordTimeWithOneAnchorCannotResolveAnotherWord(t *testing.T) {
	if _, _, ok := ResolveWordTime([]Anchor{{Word: 5, Position: 10}}, 6); ok {
		t.Fatal("resolved from a single anchor")
	}
}

func TestResolveWordTimeAnExactAnchorIsReturnedVerbatim(t *testing.T) {
	position, source, ok := ResolveWordTime([]Anchor{{Word: 3, Position: 1.5}, {Word: 9, Position: 4.5}}, 3)
	if !ok || source != SourceAnchor || position != 1.5 {
		t.Fatalf("ResolveWordTime = %v, %q, %v", position, source, ok)
	}
}

func TestResolveWordTimeInterpolatesBetweenTwoAnchors(t *testing.T) {
	// Word 6 is halfway between word 3 at 1.5s and word 9 at 4.5s: 3s of runway over 6 words is 0.5s/word, so word 6
	// (3 words in) lands at 1.5 + 3*0.5 = 3.0s.
	position, source, ok := ResolveWordTime([]Anchor{{Word: 3, Position: 1.5}, {Word: 9, Position: 4.5}}, 6)
	if !ok || source != SourceAnchor || position != 3.0 {
		t.Fatalf("ResolveWordTime = %v, %q, %v", position, source, ok)
	}
}

func TestResolveWordTimeExtrapolatesPastTheLastAnchorAsAnEstimate(t *testing.T) {
	// Pace is 0.5s/word (from word 0 at 0s to word 10 at 5s); word 14 is 4 words past the last anchor, so 5 + 4*0.5 = 7s.
	position, source, ok := ResolveWordTime([]Anchor{{Word: 0, Position: 0}, {Word: 10, Position: 5}}, 14)
	if !ok || source != SourceEstimate || position != 7 {
		t.Fatalf("ResolveWordTime = %v, %q, %v", position, source, ok)
	}
}

func TestResolveWordTimeExtrapolatesBeforeTheFirstAnchorClampedAtZero(t *testing.T) {
	position, source, ok := ResolveWordTime([]Anchor{{Word: 10, Position: 1}, {Word: 20, Position: 6}}, 0)
	if !ok || source != SourceEstimate || position != 0 {
		t.Fatalf("ResolveWordTime = %v, %q, %v", position, source, ok)
	}
}

func TestResolveWordTimeSortsUnsortedInput(t *testing.T) {
	position, source, ok := ResolveWordTime([]Anchor{{Word: 9, Position: 4.5}, {Word: 3, Position: 1.5}}, 6)
	if !ok || source != SourceAnchor || position != 3.0 {
		t.Fatalf("ResolveWordTime = %v, %q, %v", position, source, ok)
	}
}
