package audacity

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	abt "github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func newSession(t *testing.T) (*Session, *abt.Server) {
	t.Helper()
	server := abt.NewServer()
	client := audacitybridge.New(server.Transport(), audacitybridge.Options{Timeout: time.Second})
	t.Cleanup(func() { _ = client.Close() })
	return NewSession(client), server
}

func at(v float64) *float64 { return &v }

func TestFindingLabelText(t *testing.T) {
	cases := []struct {
		id       string
		reviewed bool
		words    string
		want     string
	}{
		{"f-1", false, "misread: \"their\" for \"there\"", "[nu:f-1] misread: ”their” for ”there”"},
		{"f.2_x", true, "skipped   words\n here", "[nu:f.2_x reviewed] skipped words here"},
		{"f3", false, "", "[nu:f3]"},
		{"f4", false, `C:\path`, "[nu:f4] C:\u2216path"},
		{"f5", false, strings.Repeat("long ", 100), ("[nu:f5] " + strings.Repeat("long ", 100))[:maxLabelBytes]},
	}
	for _, tc := range cases {
		got, err := FindingLabelText(tc.id, tc.reviewed, tc.words)
		if err != nil || got != tc.want {
			t.Errorf("FindingLabelText(%q) = %q, %v; want %q", tc.id, got, err, tc.want)
		}
		if len(got) > maxLabelBytes {
			t.Errorf("%q is %d bytes", got, len(got))
		}
		id, reviewed, _, ok := ParseFindingLabel(got)
		if !ok || id != tc.id || reviewed != tc.reviewed {
			t.Errorf("ParseFindingLabel(%q) = %q %v %v", got, id, reviewed, ok)
		}
	}
	for _, id := range []string{"", "a b", "a]", "-lead", "x" + strings.Repeat("y", 64), "a\"b", "a:b"} {
		if _, err := FindingLabelText(id, false, "w"); !errors.Is(err, audacitybridge.ErrInvalidValue) {
			t.Errorf("FindingLabelText(%q) err = %v, want ErrInvalidValue", id, err)
		}
	}
	for _, text := range []string{"", "a narrator's own label", "[nu:]", "[nu:f1", "nu:f1] x", "[nu:f1 done] x", " [nu:f1]"} {
		if _, _, _, ok := ParseFindingLabel(text); ok {
			t.Errorf("ParseFindingLabel(%q) matched a label the adapter did not write", text)
		}
	}
}

func TestWriteLabelFile(t *testing.T) {
	var b strings.Builder
	err := WriteLabelFile(&b, []audacitybridge.LabelInfo{{Start: 1.5, End: 2, Text: "[nu:f1 reviewed] a\tb"}, {Start: 0, End: 0, Text: ""}})
	if err != nil {
		t.Fatal(err)
	}
	want := "1.500000\t2.000000\t[nu:f1 reviewed] a b\n0.000000\t0.000000\t\n"
	if b.String() != want {
		t.Errorf("got %q, want %q", b.String(), want)
	}
}

// Importing findings creates one label each on the "Narration Utils" track; importing them again adds nothing (PRD Phase 6's
// success signal).
func TestImportFindingsIsIdempotent(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddWaveTrack("Chapter 1", 0, 300)
		p.AddLabelTrack("My notes", abt.Label{Start: 5, End: 5, Text: "breath here"})
		p.Tracks[1].Selected = true // the narrator's own label track is selected: the import must not add to it
	})
	findings := []Finding{
		{ID: "f1", Start: 12.5, End: 13, Words: "misread: their/there"},
		{ID: "f2", Start: 40, End: 40, Words: "skipped: very"},
	}
	ctx := t.Context()
	preview, err := session.PreviewImport(ctx, findings)
	if err != nil || !reflect.DeepEqual(preview.Added, []string{"f1", "f2"}) || preview.Skipped != nil {
		t.Fatalf("preview = %+v, %v", preview, err)
	}
	first, err := session.ImportFindings(ctx, findings)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Added, []string{"f1", "f2"}) || len(first.Skipped) != 0 {
		t.Errorf("first import = %+v", first)
	}
	second, err := session.ImportFindings(ctx, append(findings, Finding{ID: "f3", Start: 50, End: 51}))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(second.Added, []string{"f3"}) || !reflect.DeepEqual(second.Skipped, []string{"f1", "f2"}) {
		t.Errorf("second import = %+v", second)
	}
	server.With(func(p *abt.Project) {
		if len(p.Tracks) != 3 || p.Tracks[2].Name != LabelTrackName || p.Tracks[2].Kind != "label" {
			t.Fatalf("tracks = %+v", p.Tracks)
		}
		if got := p.Tracks[1].Labels; !reflect.DeepEqual(got, []abt.Label{{Start: 5, End: 5, Text: "breath here"}}) {
			t.Errorf("the narrator's own track changed: %+v", got)
		}
		want := []abt.Label{
			{Start: 12.5, End: 13, Text: "[nu:f1] misread: their/there"},
			{Start: 40, End: 40, Text: "[nu:f2] skipped: very"},
			{Start: 50, End: 51, Text: "[nu:f3]"},
		}
		if got := p.Tracks[2].Labels; !reflect.DeepEqual(got, want) {
			t.Errorf("labels = %+v\nwant %+v", got, want)
		}
	})
}

// A finding the narrator already reviewed is still recognised by its identity, and a whole import is refused before anything is
// written when one finding cannot be labelled.
func TestImportRecognisesReviewedAndRefusesBadInputUpFront(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack(LabelTrackName, abt.Label{Start: 1, End: 1, Text: "[nu:f1 reviewed] x"})
	})
	result, err := session.ImportFindings(t.Context(), []Finding{{ID: "f1", Start: 1, End: 1}})
	if err != nil || len(result.Added) != 0 || !reflect.DeepEqual(result.Skipped, []string{"f1"}) {
		t.Errorf("result = %+v, %v", result, err)
	}
	for name, bad := range map[string]Finding{
		"a bad id":          {ID: "a b", Start: 1, End: 1},
		"a negative time":   {ID: "f9", Start: -1, End: 1},
		"ends before start": {ID: "f9", Start: 2, End: 1},
	} {
		before := len(server.Log())
		if _, err := session.ImportFindings(t.Context(), []Finding{{ID: "ok", Start: 1, End: 2}, bad}); !errors.Is(err, audacitybridge.ErrInvalidValue) {
			t.Errorf("%s: err = %v", name, err)
		}
		if len(server.Log()) != before {
			t.Errorf("%s: sent %q before refusing", name, server.Log()[before:])
		}
	}
}

// Marking reviewed rewrites the label in place (PRD Phase 7): its place, even after the narrator moved it, and its words are kept,
// and no second label appears.
func TestMarkReviewedRewritesInPlace(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack(LabelTrackName,
			abt.Label{Start: 3, End: 3, Text: "[nu:f0] other"},
			abt.Label{Start: 20.25, End: 21, Text: "[nu:f1] misread"}) // moved by the narrator since the import
	})
	ctx := t.Context()
	changed, err := session.MarkReviewed(ctx, "f1")
	if err != nil || !changed {
		t.Fatalf("MarkReviewed = %v, %v", changed, err)
	}
	again, err := session.MarkReviewed(ctx, "f1")
	if err != nil || again {
		t.Errorf("a second MarkReviewed = %v, %v; want no change", again, err)
	}
	server.With(func(p *abt.Project) {
		want := []abt.Label{{Start: 3, End: 3, Text: "[nu:f0] other"}, {Start: 20.25, End: 21, Text: "[nu:f1 reviewed] misread"}}
		if got := p.AllLabels(); !reflect.DeepEqual(got, want) {
			t.Errorf("labels = %+v", got)
		}
	})
	labels, err := session.FindingLabels(ctx)
	if err != nil || len(labels) != 2 || labels[1].ID != "f1" || !labels[1].Reviewed || labels[0].Reviewed {
		t.Errorf("FindingLabels = %+v, %v", labels, err)
	}
}

func TestMarkReviewedAndGoToRefuseWhatTheyCannotFindOnce(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack("A", abt.Label{Start: 1, End: 1, Text: "[nu:dup] one"})
		p.AddLabelTrack("B", abt.Label{Start: 2, End: 2, Text: "[nu:dup] two"})
	})
	ctx := t.Context()
	cases := []struct {
		id   string
		want error
	}{
		{"missing", ErrLabelNotFound},
		{"dup", ErrLabelAmbiguous},
		{"bad id", audacitybridge.ErrInvalidValue},
	}
	for _, tc := range cases {
		if _, err := session.MarkReviewed(ctx, tc.id); !errors.Is(err, tc.want) {
			t.Errorf("MarkReviewed(%q) = %v, want %v", tc.id, err, tc.want)
		}
		if _, err := session.GoToFinding(ctx, tc.id); !errors.Is(err, tc.want) {
			t.Errorf("GoToFinding(%q) = %v, want %v", tc.id, err, tc.want)
		}
	}
}

func TestGoToFindingSelectsTheLabelWhereItIsNow(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack(LabelTrackName, abt.Label{Start: 7, End: 9.5, Text: "[nu:f1] x"})
		p.Playing = true
	})
	label, err := session.GoToFinding(t.Context(), "f1")
	if err != nil || label.Start != 7 {
		t.Fatalf("GoToFinding = %+v, %v", label, err)
	}
	server.With(func(p *abt.Project) {
		if p.SelStart != 7 || p.SelEnd != 9.5 || p.Playing {
			t.Errorf("selection %v..%v playing=%v", p.SelStart, p.SelEnd, p.Playing)
		}
	})
}

func TestNavigateLoopAndStop(t *testing.T) {
	session, server := newSession(t)
	ctx := t.Context()
	nav, err := session.Navigate(ctx, dawport.Target{SourceStart: at(12.5), SourceEnd: at(13)})
	if err != nil || nav.ProjectTime != 12.5 {
		t.Fatalf("Navigate = %+v, %v", nav, err)
	}
	server.With(func(p *abt.Project) {
		if p.SelStart != 12.5 || p.SelEnd != 12.5 {
			t.Errorf("cursor %v..%v", p.SelStart, p.SelEnd)
		}
	})
	loop, err := session.Loop(ctx, dawport.Target{SourceStart: at(1), SourceEnd: at(3)})
	if err != nil || loop.Start != 0 || loop.End != 5 {
		t.Fatalf("Loop = %+v, %v; want 0..5 (padded, never before the start)", loop, err)
	}
	server.With(func(p *abt.Project) {
		if !p.Looping || p.LoopStart != 0 || p.LoopEnd != 5 {
			t.Errorf("looping=%v %v..%v", p.Looping, p.LoopStart, p.LoopEnd)
		}
	})
	if _, err := session.StopLoop(ctx); err != nil {
		t.Fatal(err)
	}
	server.With(func(p *abt.Project) {
		if p.Playing || p.Looping {
			t.Error("still playing after StopLoop")
		}
	})
	want := []string{
		"Stop:", "SelectTime: Start=12.5 End=12.5 RelativeTo=ProjectStart",
		"Stop:", "SelectTime: Start=0 End=5 RelativeTo=ProjectStart", "PlayAtSpeedLooped:",
		"Stop:",
	}
	if got := server.Log(); !reflect.DeepEqual(got, want) {
		t.Errorf("sent %q\nwant %q", got, want)
	}
}

// A place made for REAPER (an item GUID) is refused, never read as a project time it never was; so is a target with no usable time.
func TestTargetsAudacityCannotUse(t *testing.T) {
	session, server := newSession(t)
	ctx := t.Context()
	cases := map[string]struct {
		target dawport.Target
		want   error
	}{
		"a REAPER item":   {dawport.Target{ItemGUID: "{A}", SourceStart: at(1)}, ErrItemTarget},
		"a REAPER take":   {dawport.Target{TakeGUID: "{T}", SourceStart: at(1)}, ErrItemTarget},
		"no time":         {dawport.Target{}, ErrNoTime},
		"a negative time": {dawport.Target{SourceStart: at(-1)}, ErrNoTime},
	}
	for name, tc := range cases {
		if _, err := session.Navigate(ctx, tc.target); !errors.Is(err, tc.want) {
			t.Errorf("%s: Navigate = %v", name, err)
		}
		if _, err := session.Loop(ctx, tc.target); !errors.Is(err, tc.want) {
			t.Errorf("%s: Loop = %v", name, err)
		}
		if _, err := session.AddMarker(ctx, tc.target, dawport.Marker{Name: "x"}); !errors.Is(err, tc.want) {
			t.Errorf("%s: AddMarker = %v", name, err)
		}
	}
	if len(server.Log()) != 0 {
		t.Errorf("sent %q", server.Log())
	}
}

func TestAddMarkerAddsOnce(t *testing.T) {
	session, server := newSession(t)
	ctx := t.Context()
	target := dawport.Target{SourceStart: at(30)}
	first, err := session.AddMarker(ctx, target, dawport.Marker{Name: "Misread: \"there\"", Color: "FF4040"})
	if err != nil || !first.Added || first.Name != "Misread: ”there”" || first.SourceTime != 30 {
		t.Fatalf("first = %+v, %v", first, err)
	}
	second, err := session.AddMarker(ctx, dawport.Target{SourceStart: at(30.1)}, dawport.Marker{Name: "Misread: \"there\""})
	if err != nil || second.Added {
		t.Errorf("second = %+v, %v; want the existing label", second, err)
	}
	if _, err := session.AddMarker(ctx, target, dawport.Marker{Name: " \n "}); !errors.Is(err, audacitybridge.ErrInvalidValue) {
		t.Errorf("a blank name: %v", err)
	}
	server.With(func(p *abt.Project) {
		if got := p.AllLabels(); len(got) != 1 {
			t.Errorf("labels = %+v", got)
		}
	})
}

// When Audacity's AddLabel puts the label somewhere the adapter cannot find it again, nothing is renamed by guesswork.
func TestAddLabelThatCannotBeFoundAgainIsReported(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack("A", abt.Label{Start: 10, End: 10})
		p.AddLabelTrack("B", abt.Label{Start: 10, End: 10})
	})
	// Two empty labels already sit at 10 s on the narrator's tracks; a third, on a new track, makes three candidates if the
	// adapter could not tell old from new. It can, so this succeeds; then a scripted hang-up proves errors pass through.
	if _, err := session.AddMarker(t.Context(), dawport.Target{SourceStart: at(10)}, dawport.Marker{Name: "m"}); err != nil {
		t.Fatalf("AddMarker: %v", err)
	}
	if _, ok := newEmptyLabel(nil, []audacitybridge.LabelInfo{{Track: 1, Start: 1}, {Track: 2, Start: 1}}, 1, -1); ok {
		t.Error("two new empty labels and no own track: must not guess")
	}
	server.Script(abt.FaultFail)
	if _, err := session.AddMarker(t.Context(), dawport.Target{SourceStart: at(20)}, dawport.Marker{Name: "n"}); !errors.Is(err, audacitybridge.ErrCommandFailed) {
		t.Errorf("err = %v", err)
	}
}

func TestProjectInfo(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddWaveTrack("a", 0, 90)
		p.AddWaveTrack("b", 5, 120.5)
		p.AddLabelTrack("L", abt.Label{Start: 1, End: 1})
	})
	info, err := session.Project(t.Context())
	if err != nil || info.Duration != 120.5 || info.Labels != 1 || len(info.Tracks) != 3 {
		t.Errorf("info = %+v, %v", info, err)
	}
}

func TestWriteReviewedLabels(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) {
		p.AddLabelTrack(LabelTrackName,
			abt.Label{Start: 1, End: 1, Text: "[nu:f1 reviewed] a"},
			abt.Label{Start: 2, End: 3, Text: "[nu:f2] b"},
			abt.Label{Start: 4, End: 4, Text: "narrator's own"},
			abt.Label{Start: 5, End: 6, Text: "[nu:f3 reviewed] c"})
	})
	folder := t.TempDir()
	path, n, err := session.WriteReviewedLabels(t.Context(), folder)
	if err != nil || n != 2 {
		t.Fatalf("WriteReviewedLabels = %q, %d, %v", path, n, err)
	}
	if filepath.Dir(path) != ExportFolder(folder) {
		t.Errorf("wrote %q outside %q", path, ExportFolder(folder))
	}
	body, _ := os.ReadFile(path)
	if want := "1.000000\t1.000000\t[nu:f1 reviewed] a\n5.000000\t6.000000\t[nu:f3 reviewed] c\n"; string(body) != want {
		t.Errorf("file = %q", body)
	}
	second, _, err := session.WriteReviewedLabels(t.Context(), folder)
	if err != nil || second == path {
		t.Errorf("a second export = %q, %v; want a new file beside the first", second, err)
	}
	if _, _, err := session.WriteReviewedLabels(t.Context(), "relative"); !errors.Is(err, audacitybridge.ErrInvalidValue) {
		t.Errorf("a relative folder: %v", err)
	}
	entries, _ := os.ReadDir(ExportFolder(folder))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("left a temporary file: %s", e.Name())
		}
	}
}

func TestExportChapter(t *testing.T) {
	session, server := newSession(t)
	server.With(func(p *abt.Project) { p.AddWaveTrack("Chapter 1", 0, 600) })
	folder := t.TempDir()
	ctx := t.Context()
	if _, err := session.ExportChapter(ctx, folder, "Ch 1", 5, 5); !errors.Is(err, audacitybridge.ErrInvalidValue) {
		t.Errorf("an empty range: %v", err)
	}
	if _, err := session.ExportChapter(ctx, "relative", "Ch 1", 0, 5); !errors.Is(err, audacitybridge.ErrInvalidValue) {
		t.Errorf("a relative folder: %v", err)
	}
	path, err := session.ExportChapter(ctx, folder, "Chapter 1: The \"Start\"", 10, 300)
	if runtime.GOOS != "windows" {
		// Audacity is Windows-only here (D74): a path that is not on a drive is refused before it reaches the pipe.
		if !errors.Is(err, audacitybridge.ErrInvalidValue) {
			t.Fatalf("a non-Windows path: %v", err)
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(ExportFolder(folder), "Chapter-1-The-Start-01.wav"); path != want {
		t.Errorf("path = %q, want %q", path, want)
	}
	server.With(func(p *abt.Project) {
		want := []abt.Export{{Filename: filepath.ToSlash(path), NumChannels: 1, Start: 10, End: 300}}
		if !reflect.DeepEqual(p.Exports, want) {
			t.Errorf("exports = %+v", p.Exports)
		}
	})
}

func TestExportChapterNeedsAudio(t *testing.T) {
	session, _ := newSession(t)
	if _, err := session.ExportChapter(t.Context(), t.TempDir(), "c", 0, 5); err == nil || !strings.Contains(err.Error(), "no audio") {
		t.Errorf("err = %v", err)
	}
}

func TestFreshPath(t *testing.T) {
	folder := t.TempDir()
	first, err := freshPath(folder, "../../etc/passwd", ".wav")
	if err != nil || filepath.Dir(first) != folder || filepath.Base(first) != "etc-passwd-01.wav" {
		t.Fatalf("freshPath = %q, %v", first, err)
	}
	if err := os.WriteFile(first, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	second, _ := freshPath(folder, "../../etc/passwd", ".wav")
	if filepath.Base(second) != "etc-passwd-02.wav" {
		t.Errorf("second = %q", second)
	}
	if blank, _ := freshPath(folder, "...", ".wav"); filepath.Base(blank) != "chapter-01.wav" {
		t.Errorf("blank = %q", blank)
	}
}
