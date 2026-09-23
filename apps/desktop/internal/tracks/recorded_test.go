package tracks

import (
	"math"
	"path/filepath"
	"testing"
)

func parseChapterTracks(t *testing.T) Project {
	t.Helper()
	project, err := Parse(filepath.Join("testdata", "chapter-tracks.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	return project
}

func trackNamed(t *testing.T, project Project, name string) Track {
	t.Helper()
	for _, track := range project.Tracks {
		if track.Name == name {
			return track
		}
	}
	t.Fatalf("no track named %q", name)
	return Track{}
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestParseReadsRegionsAndSkipsPlainMarkers(t *testing.T) {
	project := parseChapterTracks(t)
	want := []Region{
		{Index: 1, Name: "Chapter Two", Start: 28, End: 40, GUID: "{5A1B8E53-2B0D-4E1C-9A55-3E4C1B1D0A02}"},
		{Index: 2, Name: "Epilogue", Start: 60, End: 70, GUID: "{5A1B8E53-2B0D-4E1C-9A55-3E4C1B1D0A03}"},
	}
	if len(project.Regions) != len(want) {
		t.Fatalf("regions = %#v, want %#v", project.Regions, want)
	}
	for i, region := range project.Regions {
		if region != want[i] {
			t.Fatalf("regions[%d] = %#v, want %#v", i, region, want[i])
		}
	}
}

func TestParseReadsTheChapterRegionsREAPERSaved(t *testing.T) {
	// saved-cases.rpp: three chapter regions interleaved with PICKUP markers
	// that share their numbers (markers and regions are numbered separately).
	project, err := Parse(filepath.Join("testdata", "reaper", "saved-cases.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	want := []struct {
		name       string
		start, end float64
	}{{"Chapter 1", 0, 11.9}, {"Chapter 2", 12, 19.9}, {"Chapter 3", 20, 23}}
	if len(project.Regions) != len(want) {
		t.Fatalf("regions = %#v", project.Regions)
	}
	for i, region := range project.Regions {
		if region.Name != want[i].name || !near(region.Start, want[i].start) || !near(region.End, want[i].end) {
			t.Fatalf("regions[%d] = %#v, want %+v", i, region, want[i])
		}
	}
}

func TestRecordedEndIsTheLastItemsEndWithItsSourceTimeScaledByRateAndOffset(t *testing.T) {
	// Items are not in time order in the file; the one ending last (12 + 5)
	// wins. Its source time is SOFFS + length * PLAYRATE = 2 + 5 * 1.5.
	end, ok := trackNamed(t, parseChapterTracks(t), "Chapter 1").RecordedEnd(nil)
	if !ok {
		t.Fatal("no recorded end")
	}
	if !near(end.ProjectTime, 17) || !near(end.SourceTime, 9.5) || !near(end.SourceStart, 2) {
		t.Fatalf("end = %+v, want project 17, source 9.5, starting at SOFFS 2", end)
	}
	if end.ItemGUID != "{B0000000-0000-4000-8000-000000000002}" || end.TakeGUID != "{C0000000-0000-4000-8000-000000000002}" {
		t.Fatalf("end = %+v, want the second item and its take", end)
	}
	if !end.SourceAvailable || !end.Supported || end.Approximate {
		t.Fatalf("end = %+v, want an available, supported, exact source", end)
	}
	if filepath.Base(end.SourceFile) != "ch1_take1.wav" {
		t.Fatalf("source file = %q", end.SourceFile)
	}
}

func TestRecordedEndFollowsTheActiveTakeOfAMultiTakeItem(t *testing.T) {
	end, ok := trackNamed(t, parseChapterTracks(t), "Chapter 11").RecordedEnd(nil)
	if !ok {
		t.Fatal("no recorded end")
	}
	if end.TakeGUID != "{C0000000-0000-4000-8000-000000000012}" || filepath.Base(end.SourceFile) != "ch11_take2.wav" {
		t.Fatalf("end = %+v, want the active (second) take", end)
	}
	// No PLAYRATE line reads as rate 1: 3 + 4.
	if !near(end.SourceTime, 7) || end.SourceAvailable {
		t.Fatalf("end = %+v, want source time 7 and a missing file", end)
	}
}

func TestRecordedEndAddsASectionsStartAndSkipsMutedItems(t *testing.T) {
	narration := trackNamed(t, parseChapterTracks(t), "Narration")
	// Within the Chapter Two region (28-40): the section item ends at 36; the
	// muted item (38-43) does not count. Source time = STARTPOS + SOFFS +
	// length = 40 + 1 + 6.
	end, ok := narration.RecordedEnd(&Span{Start: 28, End: 40})
	if !ok {
		t.Fatal("no recorded end")
	}
	if !near(end.ProjectTime, 36) || !near(end.SourceTime, 47) || !near(end.SourceStart, 41) || end.Approximate {
		t.Fatalf("end = %+v, want project 36 and source 41 to 47", end)
	}

	// Over the whole track the epilogue item (62-65) ends last, and its
	// stretch markers make the source time approximate.
	whole, ok := narration.RecordedEnd(nil)
	if !ok || !near(whole.ProjectTime, 65) || !whole.Approximate {
		t.Fatalf("whole = %+v, want the epilogue item, approximate", whole)
	}
}

func TestRecordedEndMarksASectionThatLoopsAsApproximate(t *testing.T) {
	track := Track{Items: []Item{{
		Position: 0, Length: 30, GUID: "item",
		Takes: []Take{{GUID: "take", Section: &SectionOffsets{StartPos: 5, Length: 20}}},
	}}}
	end, ok := track.RecordedEnd(nil)
	if !ok || !end.Approximate {
		t.Fatalf("end = %+v, want approximate: 30 s of a 20 s section loops", end)
	}
}

func TestRecordedEndOfTheREAPERSavedRateAndSectionItems(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "reaper", "saved-cases.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	section, ok := trackNamed(t, project, "Section").RecordedEnd(nil)
	if !ok || !near(section.ProjectTime, 13.5) || !near(section.SourceTime, 2) || section.Approximate {
		t.Fatalf("section = %+v, want project 13.5 and source 0.5 + 0 + 1.5", section)
	}
	rate, ok := trackNamed(t, project, "Rate and stretch").RecordedEnd(nil)
	if !ok || !near(rate.ProjectTime, 16.4) || !near(rate.SourceTime, 3.5) || !rate.Approximate {
		t.Fatalf("rate = %+v, want project 16.4, source 0.5 + 2.4 * 1.25, approximate (stretch markers)", rate)
	}
}

func TestRecordedEndOfATrackWithNothingAudibleIsNone(t *testing.T) {
	project := parseChapterTracks(t)
	for _, name := range []string{"Room Tone", "Chapter 1 pickups"} {
		if end, ok := trackNamed(t, project, name).RecordedEnd(nil); ok {
			t.Fatalf("%s: end = %+v, want none (only muted items, or no items)", name, end)
		}
	}
	if end, ok := trackNamed(t, project, "Chapter 1").RecordedEnd(&Span{Start: 100, End: 200}); ok {
		t.Fatalf("end = %+v, want none outside every item", end)
	}
}
