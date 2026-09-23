package chaptermatch

import "testing"

// Track and region names come from a .rpp the app did not write (threat model
// row 6d): matching one must never panic and must stay within its contract.
func FuzzFindChapterByTrackName(f *testing.F) {
	for _, seed := range [][2]string{
		{"Chapter 1", "CHAPTER ONE"}, {"", ""}, {"one hundred and", "and"}, {"billion billion billion billion", "1"},
		{"Sentinel’s", "sentinels"}, {"'s", "'"}, {"Chapter\x00 1", "Chapter 1"}, {"Chäpter 1", "Chapter 1"},
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
	})
}
