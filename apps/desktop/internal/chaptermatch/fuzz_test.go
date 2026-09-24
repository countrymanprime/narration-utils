package chaptermatch

import "testing"

// Track and region names come from a .rpp the app did not write (threat model
// row 6d): matching one must never panic and must stay within its contract.
func FuzzFindChapterByTrackName(f *testing.F) {
	for _, seed := range [][2]string{
		{"Chapter 1", "CHAPTER ONE"}, {"", ""}, {"one hundred and", "and"}, {"billion billion billion billion", "1"},
		{"Sentinel’s", "sentinels"}, {"'s", "'"}, {"Chapter\x00 1", "Chapter 1"}, {"Chäpter 1", "Chapter 1"},
		{"Ch. VI v2", "Chapter the Sixth"}, {"06 - Chapter 6 (pickups)", "twenty first chapter"}, {"End Credits", "Chapter MMMM"},
		{"take take 2", "v"}, {"Ch", "ch ch 0000"},
	} {
		f.Add(seed[0], seed[1])
	}
	f.Fuzz(func(t *testing.T, name, title string) {
		titles := []string{title, "Chapter 1", title + " 2"}
		index, score := FindChapterByTrackName(titles, name)
		if index < -1 || index >= len(titles) {
			t.Fatalf("index %d out of range", index)
		}
		if (index < 0) != (score == 0) || score < 0 || score > 1 {
			t.Fatalf("index %d with score %v", index, score)
		}
		// The label pre-pass (daw-chapter-track-auto-sync PRD Phase 1): a take or pickup match is never confident.
		if match := MatchTitle(titles, name); (match.Marker == MarkerTake || match.Marker == MarkerPickup) && match.Confident {
			t.Fatalf("a %s match %+v is confident", match.Marker, match)
		}
	})
}
