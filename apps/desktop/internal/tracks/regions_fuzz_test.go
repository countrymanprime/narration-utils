package tracks

import "testing"

// Region lines come from a .rpp the app did not write (threat model row 6d):
// reading them must never panic, and every region it returns is closed.
func FuzzParseRegions(f *testing.F) {
	for _, seed := range []string{
		"<REAPER_PROJECT\nMARKER 1 0 \"Chapter 1\" 1 0 1 R {G} 0 1\nMARKER 1 30 \"\" 1\n>",
		"<REAPER_PROJECT\nMARKER 1 5 \"marker\" 0\n>",
		"<REAPER_PROJECT\nMARKER 1 30 \"\" 1\nMARKER 1 0 \"backwards\" 1\n>",
		"<REAPER_PROJECT\nMARKER x y z w\nMARKER 1\n>",
		"<REAPER_PROJECT\nMARKER 1 NaN \"n\" 1\nMARKER 1 NaN \"\" 1\n>",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		project := parseChunks(text).firstChild("REAPER_PROJECT")
		if project == nil {
			return
		}
		for _, region := range parseRegions(project) {
			if !(region.End >= region.Start) {
				t.Fatalf("region %+v ends before it starts", region)
			}
		}
	})
}
