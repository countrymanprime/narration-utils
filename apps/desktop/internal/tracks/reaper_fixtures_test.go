package tracks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The projects under testdata/reaper were written by REAPER 7.80 itself (see testdata/reaper/README.md), not by hand.
// These tests pin what this parser makes of real REAPER output, including what it does not see yet, so the parser
// superset planned for the evidence ledger changes them on purpose.

func parseReaperFixture(t *testing.T, name string) Project {
	t.Helper()
	project, err := Parse(filepath.Join("testdata", "reaper", name))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return project
}

func trackNames(project Project) []string {
	names := make([]string, 0, len(project.Tracks))
	for _, track := range project.Tracks {
		names = append(names, track.Name)
	}
	return names
}

func TestSavedCasesParsesEveryTrackAndItem(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	want := []string{"Multi-take", "Muted", "Section", "Rate and stretch", "FX chains", "Stamped"}
	if got := trackNames(project); len(got) != len(want) {
		t.Fatalf("tracks = %v, want %v", got, want)
	} else {
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("tracks = %v, want %v", got, want)
			}
		}
	}
	items := 0
	for _, track := range project.Tracks {
		items += len(track.Items)
		for _, item := range track.Items {
			if !item.Supported || item.SourceKind != "WAVE" || !item.SourceAvailable {
				t.Errorf("%s / %s: kind=%q supported=%v available=%v, want a resolvable WAVE source", track.Name, item.Name, item.SourceKind, item.Supported, item.SourceAvailable)
			}
		}
	}
	if items != 8 {
		t.Fatalf("items = %d, want 8 (the multi-take item counts once)", items)
	}
	if !project.Tracks[1].Muted {
		t.Error("the Muted track's MUTESOLO flag is not read")
	}
}

func TestASectionSourceIsUnwrappedToItsFile(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	item := project.Tracks[2].Items[0]
	if item.SourceKind != "WAVE" || filepath.Base(item.SourceFile) != "take_c.wav" || item.Length != 1.5 {
		t.Fatalf("section item = %#v", item)
	}
}

// The parser reads the first <SOURCE> and the first NAME of an item, which are the first take's. The fixture's
// active take is "take B" (`TAKE SEL`), so the ledger's parser superset must follow the active take instead.
func TestAMultiTakeItemIsReportedAsItsFirstTakeNotTheActiveOne(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	item := project.Tracks[0].Items[0]
	if item.Name != "take A" || filepath.Base(item.SourceFile) != "take_a.wav" {
		t.Fatalf("multi-take item = %#v; if this now reports take B, update the fixture README and this test", item)
	}
}

// An item's mute flag (`MUTE 1 0`), the play rate, stretch markers, FX chains and extension data are all in the file
// and none of them is read yet: the parser only keeps position, length, name and source.
func TestTheFileCarriesWhatTheParserDoesNotReadYet(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "reaper", "saved-cases.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, marker := range []string{"MUTE 1 0", "PLAYRATE 1.25", "SM 0.4 0.5", "<FXCHAIN", "<TAKEFX", "<EXTI", "<EXT\r\n", "IGUID {", "TAKE SEL"} {
		if !strings.Contains(text, marker) {
			t.Errorf("the fixture no longer contains %q: the README and this test describe it", marker)
		}
	}

	project := parseReaperFixture(t, "saved-cases.rpp")
	muted := project.Tracks[1].Items[0]
	if muted.Name != "muted item" || muted.Position != 4 {
		t.Fatalf("muted item = %#v", muted)
	}
	// Item is a plain value with no Muted, PlayRate, GUID or extension fields, so the parser cannot report any of the
	// above. When it gains them, assert `muted item` is muted and `audible item` is not, that `rate 1.25` has rate
	// 1.25, and that the item GUID comes from IGUID (the item's), not GUID (each take has its own).
}

func TestANoOpResavedProjectKeepsItsTracksButNotTheRelativeMediaPaths(t *testing.T) {
	first := parseReaperFixture(t, "saved-cases.rpp")
	second := parseReaperFixture(t, "resave-noop.rpp")

	if len(first.Tracks) != len(second.Tracks) {
		t.Fatalf("track counts differ: %d vs %d", len(first.Tracks), len(second.Tracks))
	}
	for index := range first.Tracks {
		if first.Tracks[index].GUID != second.Tracks[index].GUID || first.Tracks[index].Name != second.Tracks[index].Name {
			t.Errorf("track %d changed on a no-op re-save", index)
		}
	}
	// REAPER rewrote the media paths as absolute on the re-save, so this fixture's media is not found from here.
	if !first.Tracks[0].Items[0].SourceAvailable || second.Tracks[0].Items[0].SourceAvailable {
		t.Errorf("relative paths resolve (%v) and the re-saved absolute ones do not (%v)", first.Tracks[0].Items[0].SourceAvailable, second.Tracks[0].Items[0].SourceAvailable)
	}
}

func TestLineIdentityFixtureListsTheSplitDuplicatedAndCopiedItems(t *testing.T) {
	project := parseReaperFixture(t, "line-identity.rpp")

	if len(project.Tracks) != 1 {
		t.Fatalf("tracks = %d, want 1", len(project.Tracks))
	}
	if len(project.Tracks[0].Items) != 6 {
		t.Fatalf("items = %d, want 6", len(project.Tracks[0].Items))
	}
	if project.Tracks[0].Items[2].Position != 1.5 {
		t.Errorf("the right half of the split item should start at 1.5, got %v", project.Tracks[0].Items[2].Position)
	}
}
