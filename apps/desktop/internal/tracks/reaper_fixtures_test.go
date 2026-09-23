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

// REAPER writes a track's selection (SEL) and record-arm (REC's first field) on its own lines; an item's own SEL line
// (inside <ITEM>) is not the track's. The chapter suggestion (ADR 0113) reads the saved pair.
func TestTheSavedTrackSelectionAndRecordArmAreRead(t *testing.T) {
	project := parseReaperFixture(t, "line-identity.rpp")
	if len(project.Tracks) != 1 || !project.Tracks[0].Selected || project.Tracks[0].Armed {
		t.Fatalf("tracks = %+v, want the one track selected (SEL 1) and not armed (REC 0 ...)", project.Tracks)
	}
	for _, track := range parseReaperFixture(t, "resave-noop.rpp").Tracks {
		if track.Selected || track.Armed {
			t.Errorf("%s: selected=%v armed=%v, want neither (SEL 0, REC 0 ...)", track.Name, track.Selected, track.Armed)
		}
	}
}

func TestASectionSourceIsUnwrappedToItsFile(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	item := project.Tracks[2].Items[0]
	if item.SourceKind != "WAVE" || filepath.Base(item.SourceFile) != "take_c.wav" || item.Length != 1.5 {
		t.Fatalf("section item = %#v", item)
	}
	section := item.Active().Section
	if section == nil || section.StartPos != 0.5 || section.Length != 1.5 || section.Overlap != 0.01 {
		t.Fatalf("section offsets = %#v, want StartPos 0.5, Length 1.5, Overlap 0.01", section)
	}
}

// The fixture's active take is "take B" (`TAKE SEL`); the parser superset (EL Phase 1) follows the active take, not
// the first one, and exposes every take.
func TestAMultiTakeItemIsReportedAsItsActiveTake(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	item := project.Tracks[0].Items[0]
	if item.Name != "take B" || filepath.Base(item.SourceFile) != "take_b.wav" {
		t.Fatalf("multi-take item = %#v, want the active take (take B)", item)
	}
	if len(item.Takes) != 3 {
		t.Fatalf("Takes = %#v, want 3", item.Takes)
	}
	wantNames := []string{"take A", "take B", "take C"}
	for index, want := range wantNames {
		if item.Takes[index].Name != want {
			t.Errorf("Takes[%d].Name = %q, want %q", index, item.Takes[index].Name, want)
		}
	}
	if item.ActiveTake != 1 {
		t.Errorf("ActiveTake = %d, want 1 (take B)", item.ActiveTake)
	}
	if item.GUID != "{83F2BBC9-F579-4D70-8EC2-63E9FCF1BE8C}" {
		t.Errorf("item.GUID = %q, want the IGUID value", item.GUID)
	}
	if item.Takes[1].GUID != "{F5614A11-80D0-425B-82BB-B4D942CD241E}" {
		t.Errorf("Takes[1].GUID = %q, want take B's own GUID", item.Takes[1].GUID)
	}
}

// Take review Phase 2 (Q6: the item GUID is the explicit target identity a
// scan resolves to, no manuscript line-identity stamp required) needs to
// resolve an item by its own GUID regardless of which track holds it or
// which take is active, so a finding's target can be re-resolved against
// the live project before any mutation.
func TestItemByGUIDFindsAMultiTakeItemAcrossTracksByItsOwnGUIDNotATakes(t *testing.T) {
	project := parseReaperFixture(t, "saved-cases.rpp")

	track, item, ok := project.ItemByGUID("{83F2BBC9-F579-4D70-8EC2-63E9FCF1BE8C}")
	if !ok {
		t.Fatal("ItemByGUID did not find the multi-take item by its IGUID")
	}
	if track.Name != "Multi-take" {
		t.Errorf("track = %q, want Multi-take", track.Name)
	}
	if len(item.Takes) != 3 || item.Name != "take B" {
		t.Fatalf("item = %#v, want the multi-take item resolved to its active take", item)
	}

	// A take's own GUID is not an item GUID: looking one up must fail, not
	// silently match the item that happens to hold it.
	if _, _, ok := project.ItemByGUID("{F5614A11-80D0-425B-82BB-B4D942CD241E}"); ok {
		t.Error("ItemByGUID matched a take GUID; it must only match IGUID")
	}

	if _, _, ok := project.ItemByGUID("{00000000-0000-0000-0000-000000000000}"); ok {
		t.Error("ItemByGUID matched a GUID no item has")
	}

	if _, _, ok := project.ItemByGUID(""); ok {
		t.Error("ItemByGUID matched the empty string; an item with no recorded GUID must never match a blank query")
	}
}

// The parser superset (EL Phase 1) now reads the item GUID (from IGUID, not a take's own GUID), mute, every take
// with its own GUID/source/SOFFS/PLAYRATE, which take is active, FX-chain presence and stretch-marker count as
// evidence, and item/take extension data (P_EXT/TAKE EXT, including <BIN> blocks).
func TestTheParserNowReadsMuteRateStretchFxAndExtensionData(t *testing.T) {
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
	if muted.Name != "muted item" || muted.Position != 4 || !muted.Muted {
		t.Fatalf("muted item = %#v, want Muted = true", muted)
	}
	if muted.GUID != "{387FD4B2-BBE4-4CA2-A48C-E2398699D421}" {
		t.Errorf("muted item GUID = %q, want the IGUID value, not a take's GUID", muted.GUID)
	}
	audible := project.Tracks[1].Items[1]
	if audible.Name != "audible item" || audible.Muted {
		t.Fatalf("audible item = %#v, want Muted = false", audible)
	}

	rate := project.Tracks[3].Items[0]
	active := rate.Active()
	if active.PlayRate != 1.25 || active.SOFFS != 0.5 {
		t.Fatalf("rate 1.25 item active take = %#v, want PlayRate 1.25 and SOFFS 0.5", active)
	}
	if active.StretchMarkerCount != 1 {
		t.Errorf("StretchMarkerCount = %d, want 1 (one SM line)", active.StretchMarkerCount)
	}

	if !project.Tracks[4].HasFXChain {
		t.Error("the FX chains track's own <FXCHAIN> is not read")
	}
	fxItem := project.Tracks[4].Items[0]
	if !fxItem.Active().HasFXChain {
		t.Error("the take's <TAKEFX> is not read")
	}

	stamped := project.Tracks[5].Items[0]
	if stamped.Ext["narration_utils_line_id"] != "line-000001" {
		t.Errorf("item extension data narration_utils_line_id = %q", stamped.Ext["narration_utils_line_id"])
	}
	if stamped.Ext["narration_utils_line_text"] != `The first line, with | a pipe.` {
		t.Errorf("item extension data narration_utils_line_text = %q", stamped.Ext["narration_utils_line_text"])
	}
	if stamped.Active().Ext["narration_utils_take_note"] != "take-level value" {
		t.Errorf("take extension data narration_utils_take_note = %q", stamped.Active().Ext["narration_utils_take_note"])
	}

	tricky := project.Tracks[5].Items[1]
	wantHostile := "She said \"hello\", then left.\\ Café 100% done; it's fine."
	if tricky.Ext["narration_utils_line_text"] != wantHostile {
		t.Errorf("hostile-value extension data = %q, want %q", tricky.Ext["narration_utils_line_text"], wantHostile)
	}
	longValue := tricky.Ext["narration_utils_long"]
	if !strings.HasPrefix(longValue, "word word word") || !strings.HasSuffix(longValue, "word end") || len(longValue) < 3000 {
		t.Errorf("<BIN> extension data narration_utils_long decoded wrong: prefix/suffix/length = %q.../%q/%d", firstN(longValue, 20), lastN(longValue, 20), len(longValue))
	}
	if tricky.Ext["narration_utils_multiline"] != "first line\nsecond line" {
		t.Errorf("<BIN> extension data narration_utils_multiline = %q", tricky.Ext["narration_utils_multiline"])
	}
}

func firstN(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}

func lastN(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[len(s)-n:]
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
