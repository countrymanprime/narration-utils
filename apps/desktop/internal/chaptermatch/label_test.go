package chaptermatch

import (
	"reflect"
	"testing"
)

// labelTitles is the chapter list the auto-sync PRD measured the matcher against (Evidence, 2026-09-24).
var labelTitles = []string{
	"A Message from the Author", "PROLOGUE — The Last Good Applause",
	"Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Chapter 5", "Chapter 6", "Chapter 7", "Chapter 8",
	"Chapter 9", "Chapter 10", "Chapter 11", "Chapter 12", "Chapter 16", "Chapter 21", "Epilogue", "Acknowledgments",
}

const chapter6 = 7

// Every track-name form in the PRD's Evidence table matches its right chapter confidently, or (a take or pickup
// track, a credits track) is kept from ever being a confident match. "Chapter VI" no longer goes to Chapter 1, nor
// "Chapter 6 v2" to Chapter 2 (daw-chapter-track-auto-sync PRD Phase 1).
func TestTheAutoSyncEvidenceNamesMatchTheirChapter(t *testing.T) {
	cases := []struct {
		name      string
		index     int
		confident bool
		marker    Marker
	}{
		{"CHAPTER SIX", chapter6, true, MarkerNone},
		{"chapter six", chapter6, true, MarkerNone},
		{"Chapter-6", chapter6, true, MarkerNone},
		{"chapter_6", chapter6, true, MarkerNone},
		{"Chapter Twenty-One", 15, true, MarkerNone},
		{"Chapter Sixteen", 14, true, MarkerNone},
		{"Prologue", 1, true, MarkerNone},
		{"PROLOGUE", 1, true, MarkerNone},
		{"6", chapter6, true, MarkerNone},
		{"Six", chapter6, true, MarkerNone},
		{"Chapter 06", chapter6, true, MarkerNone},
		{"Chapter6", chapter6, true, MarkerNone},
		{"Chap 6", chapter6, true, MarkerNone},
		{"06 - Chapter 6", chapter6, true, MarkerNone},
		{"Ch. 6", chapter6, true, MarkerNone},
		{"Ch 6", chapter6, true, MarkerNone},
		{"Ch6", chapter6, true, MarkerNone},
		{"CH06", chapter6, true, MarkerNone},
		{"06", chapter6, true, MarkerNone},
		{"Sixth Chapter", chapter6, true, MarkerNone},
		{"6th Chapter", chapter6, true, MarkerNone},
		{"Chapter the Sixth", chapter6, true, MarkerNone},
		{"Chapter VI", chapter6, true, MarkerNone},
		{"Chapter XXI", 15, true, MarkerNone},
		{"Épilogue", 16, true, MarkerNone},
		{"Acknowledgements", 17, true, MarkerNone},
		{"Chapter 6 (pickups)", chapter6, false, MarkerPickup},
		{"Chapter 6 - take 2", chapter6, false, MarkerTake},
		{"Chapter 6 v2", chapter6, false, MarkerTake},
		{"Opening Credits", -1, false, MarkerCredits},
		{"End Credits", -1, false, MarkerCredits},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := MatchTitle(labelTitles, c.name)
			if got.Index != c.index || got.Confident != c.confident || got.Marker != c.marker {
				t.Fatalf("MatchTitle(%q) = %+v, want index %d confident %v marker %q", c.name, got, c.index, c.confident, c.marker)
			}
		})
	}
}

func TestLabelTokensReadsTheChapterLabelOnly(t *testing.T) {
	cases := []struct {
		input  string
		tokens []string
		marker Marker
	}{
		{"Ch. 6", []string{"chapter", "6"}, MarkerNone},
		{"Chapter VI: The Storm", []string{"chapter", "6", "the", "storm"}, MarkerNone},
		{"Twenty First Chapter", []string{"chapter", "21"}, MarkerNone},
		{"Part II, Chapter 3", []string{"part", "2", "chapter", "3"}, MarkerNone},
		{"Intro", []string{"introduction"}, MarkerNone},
		{"Prologue pickups", []string{"prologue"}, MarkerPickup},
		{"Chapter 6 pickups take 2", []string{"chapter", "6"}, MarkerPickup},
		// A Roman numeral, an abbreviation or a marker word away from a label is a word, not a number or marker.
		{"I Am Legend", []string{"i", "am", "legend"}, MarkerNone},
		{"A nice chap", []string{"a", "nice", "chap"}, MarkerNone},
		{"The Final Edit", []string{"the", "final", "edit"}, MarkerNone},
		{"The Second Coming", []string{"the", "2", "coming"}, MarkerNone},
		{"Intro Credits", []string{"opening", "credits"}, MarkerCredits},
	}
	for _, c := range cases {
		tokens, marker := LabelTokens(c.input)
		if !reflect.DeepEqual(tokens, c.tokens) || marker != c.marker {
			t.Errorf("LabelTokens(%q) = %q %q, want %q %q", c.input, tokens, marker, c.tokens, c.marker)
		}
	}
}

// A take or pickup track beside the chapter's own track never makes the chapter ambiguous, and alone it is only a
// candidate the narrator confirms (fuzzy and marker matches never link on their own).
func TestAPickupTrackBesideTheChapterTrackLeavesTheChapterMatched(t *testing.T) {
	titles := []string{"Chapter 5", "Chapter 6"}
	chapter, pickups := MatchTitle(titles, "Chapter 6"), MatchTitle(titles, "Chapter 6 pickups")
	if chapter.Score-pickups.Score < NearEqualMargin || pickups.Confident {
		t.Fatalf("chapter track %+v, pickups track %+v: want the pickups track clearly behind and not confident", chapter, pickups)
	}
}

// LabelTokens is called from several goroutines at once (chapter sync's watcher, its bindings and the host's own
// status emits), so it must share no stateful transformer between calls: a shared transform.Chain races and can panic.
func TestLabelTokensIsSafeForConcurrentUse(t *testing.T) {
	done := make(chan struct{})
	for g := 0; g < 8; g++ {
		go func() {
			defer func() { done <- struct{}{} }()
			for i := 0; i < 200; i++ {
				if tokens, _ := LabelTokens("Chapître Six (pickups)"); len(tokens) == 0 {
					t.Error("no tokens")
					return
				}
			}
		}()
	}
	for g := 0; g < 8; g++ {
		<-done
	}
}
