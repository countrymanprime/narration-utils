package tracks

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoverFindsTopLevelRppOnly(t *testing.T) {
	folder := t.TempDir()
	write := func(name string) {
		if err := os.WriteFile(filepath.Join(folder, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("Novel.RPP")
	write("Novel.rpp-bak")
	write("notes.txt")
	if err := os.MkdirAll(filepath.Join(folder, "Backups"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "Backups", "Novel-bak1.RPP"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	found, err := Discover(folder)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0] != filepath.Join(folder, "Novel.RPP") {
		t.Fatalf("found = %#v, want exactly [%s]", found, filepath.Join(folder, "Novel.RPP"))
	}
}

func TestDiscoverReturnsEveryRppWhenMoreThanOne(t *testing.T) {
	folder := t.TempDir()
	for _, name := range []string{"Draft.rpp", "Final.rpp"} {
		if err := os.WriteFile(filepath.Join(folder, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	found, err := Discover(folder)
	if err != nil {
		t.Fatal(err)
	}
	if len(found) != 2 {
		t.Fatalf("found = %#v, want 2 entries", found)
	}
}

func TestDiscoverOnMissingFolderReturnsError(t *testing.T) {
	if _, err := Discover(filepath.Join(t.TempDir(), "does-not-exist")); err == nil {
		t.Fatal("want an error for a missing folder")
	}
}

func TestParseReturnsTracksInFileOrder(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(project.Tracks) != 3 {
		t.Fatalf("len(Tracks) = %d, want 3", len(project.Tracks))
	}
	names := []string{project.Tracks[0].Name, project.Tracks[1].Name, project.Tracks[2].Name}
	want := []string{"Chapter 1", "Click Track", "Chapter 2"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("Tracks[%d].Name = %q, want %q", i, names[i], want[i])
		}
	}
}

func TestParseResolvesAvailableWaveSource(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	track := project.Tracks[0]
	if len(track.Items) != 1 {
		t.Fatalf("len(Items) = %d, want 1", len(track.Items))
	}
	item := track.Items[0]
	want := filepath.Join("testdata", "media", "ch1_take1.wav")
	if item.SourceFile != want {
		t.Fatalf("SourceFile = %q, want %q", item.SourceFile, want)
	}
	if !item.SourceAvailable {
		t.Fatal("want SourceAvailable = true for a file that exists on disk")
	}
	if !item.Supported {
		t.Fatal("want Supported = true for a WAVE source")
	}
	if item.Position != 0 || item.Length != 12.5 {
		t.Fatalf("Position/Length = %v/%v, want 0/12.5", item.Position, item.Length)
	}
}

func TestParseFlagsMissingSourceAsUnavailable(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	item := project.Tracks[2].Items[0]
	if item.SourceAvailable {
		t.Fatal("want SourceAvailable = false for a file that does not exist on disk")
	}
	if !item.Supported {
		t.Fatal("a WAVE source that is merely missing on disk is still a supported kind")
	}
}

func TestParseFlagsMidiItemAsUnsupported(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	item := project.Tracks[1].Items[0]
	if item.Supported {
		t.Fatal("want Supported = false for a MIDI source")
	}
	if item.SourceFile != "" {
		t.Fatalf("SourceFile = %q, want empty for a MIDI source with no FILE attribute", item.SourceFile)
	}
}

func TestParseDecodesMuteSoloAndCustomColor(t *testing.T) {
	project, err := Parse(filepath.Join("testdata", "basic.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	if project.Tracks[0].Muted {
		t.Fatal("Chapter 1 should not be muted")
	}
	if !project.Tracks[1].Muted {
		t.Fatal("Click Track should be muted")
	}
	// PEAKCOL 17919243 = 0x0111CB0B: custom-color flag (0x1000000) set,
	// packing red=0x0B, green=0xCB, blue=0x11 (COLORREF order).
	if got := project.Tracks[0].Color; got != "#0BCB11" {
		t.Fatalf("Color = %q, want #0BCB11", got)
	}
	if got := project.Tracks[1].Color; got != "" {
		t.Fatalf("Color = %q, want empty for PEAKCOL 0 (no custom color)", got)
	}
}

func TestParseOnNonProjectFileReturnsError(t *testing.T) {
	folder := t.TempDir()
	path := filepath.Join(folder, "not-a-project.rpp")
	if err := os.WriteFile(path, []byte("this is not REAPER project text\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(path); err == nil {
		t.Fatal("want an error for a file with no REAPER_PROJECT chunk")
	}
}

func TestParseOnMissingFileReturnsError(t *testing.T) {
	if _, err := Parse(filepath.Join(t.TempDir(), "missing.rpp")); err == nil {
		t.Fatal("want an error for a file that does not exist")
	}
}

func TestTokenizeHandlesEachSafeStringDelimiter(t *testing.T) {
	tests := []struct {
		line string
		want []string
	}{
		{`NAME "hello world"`, []string{"NAME", "hello world"}},
		{`NAME 'has "quotes"'`, []string{"NAME", `has "quotes"`}},
		{"NAME `has \"both' kinds`", []string{"NAME", `has "both' kinds`}},
		{"POSITION 0 1", []string{"POSITION", "0", "1"}},
	}
	for _, test := range tests {
		got := tokenize(test.line)
		if len(got) != len(test.want) {
			t.Fatalf("tokenize(%q) = %#v, want %#v", test.line, got, test.want)
		}
		for i := range got {
			if got[i] != test.want[i] {
				t.Fatalf("tokenize(%q) = %#v, want %#v", test.line, got, test.want)
			}
		}
	}
}
