package audacitybridge_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	abt "github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
)

func ptr[T any](v T) *T { return &v }

// Every typed command: the exact line it sends and what the fake project looks like afterwards.
func TestCommands(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name  string
		setup func(*abt.Project)
		run   func(*audacitybridge.Client) error
		sent  []string
		check func(*testing.T, *abt.Project)
	}{
		{
			name: "SelectTime puts the cursor at a time",
			run:  func(c *audacitybridge.Client) error { return c.SelectTime(ctx, 12.5, 12.5) },
			sent: []string{"SelectTime: Start=12.5 End=12.5 RelativeTo=ProjectStart"},
			check: func(t *testing.T, p *abt.Project) {
				if p.SelStart != 12.5 || p.SelEnd != 12.5 {
					t.Errorf("selection = %v..%v", p.SelStart, p.SelEnd)
				}
			},
		},
		{
			name:  "SelectTracks selects exactly the named tracks",
			setup: func(p *abt.Project) { p.AddWaveTrack("a", 0, 1); p.AddLabelTrack("b"); p.AddWaveTrack("c", 0, 1) },
			run:   func(c *audacitybridge.Client) error { return c.SelectTracks(ctx, 1, 1) },
			sent:  []string{"SelectTracks: Track=1 TrackCount=1 Mode=Set"},
			check: func(t *testing.T, p *abt.Project) {
				if p.Tracks[0].Selected || !p.Tracks[1].Selected || p.Tracks[2].Selected {
					t.Errorf("tracks = %+v", p.Tracks)
				}
			},
		},
		{
			name: "AddLabel with no label track makes one",
			run: func(c *audacitybridge.Client) error {
				if err := c.SelectTime(ctx, 2, 3); err != nil {
					return err
				}
				return c.AddLabel(ctx)
			},
			sent: []string{"SelectTime: Start=2 End=3 RelativeTo=ProjectStart", "AddLabel:"},
			check: func(t *testing.T, p *abt.Project) {
				if got := p.AllLabels(); !reflect.DeepEqual(got, []abt.Label{{Start: 2, End: 3}}) {
					t.Errorf("labels = %+v", got)
				}
			},
		},
		{
			name: "SetLabel renames and moves one label",
			setup: func(p *abt.Project) {
				p.AddLabelTrack("L", abt.Label{Start: 1, End: 1, Text: "a"}, abt.Label{Start: 5, End: 5})
			},
			run: func(c *audacitybridge.Client) error {
				return c.SetLabel(ctx, 1, audacitybridge.LabelEdit{Text: ptr("nu:f2 skipped"), Start: ptr(4.0), End: ptr(4.5)})
			},
			sent: []string{`SetLabel: Label=1 Text="nu:f2 skipped" Start=4 End=4.5`},
			check: func(t *testing.T, p *abt.Project) {
				want := []abt.Label{{Start: 1, End: 1, Text: "a"}, {Start: 4, End: 4.5, Text: "nu:f2 skipped"}}
				if got := p.AllLabels(); !reflect.DeepEqual(got, want) {
					t.Errorf("labels = %+v", got)
				}
			},
		},
		{
			name:  "SetTrackName renames a track",
			setup: func(p *abt.Project) { p.AddLabelTrack("Label") },
			run:   func(c *audacitybridge.Client) error { return c.SetTrackName(ctx, 0, "Narration Utils") },
			sent:  []string{`SetTrackStatus: Track=0 Name="Narration Utils"`},
			check: func(t *testing.T, p *abt.Project) {
				if p.Tracks[0].Name != "Narration Utils" {
					t.Errorf("name = %q", p.Tracks[0].Name)
				}
			},
		},
		{
			name: "Play, PlayLooped and Stop",
			run: func(c *audacitybridge.Client) error {
				return errors.Join(c.SelectTime(ctx, 1, 2), c.PlayLooped(ctx), c.Stop(ctx), c.Play(ctx))
			},
			sent: []string{"SelectTime: Start=1 End=2 RelativeTo=ProjectStart", "PlayAtSpeedLooped:", "Stop:", "Play:"},
			check: func(t *testing.T, p *abt.Project) {
				if !p.Playing || p.Looping {
					t.Errorf("playing=%v looping=%v", p.Playing, p.Looping)
				}
			},
		},
		{
			name:  "Export writes the selection",
			setup: func(p *abt.Project) { p.AddWaveTrack("a", 0, 10) },
			run: func(c *audacitybridge.Client) error {
				return errors.Join(c.SelectTime(ctx, 1, 9), c.Export(ctx, `C:\book\ch01.wav`, 1))
			},
			sent: []string{"SelectTime: Start=1 End=9 RelativeTo=ProjectStart", `Export2: Filename="C:/book/ch01.wav" NumChannels=1`},
			check: func(t *testing.T, p *abt.Project) {
				want := []abt.Export{{Filename: "C:/book/ch01.wav", NumChannels: 1, Start: 1, End: 9}}
				if !reflect.DeepEqual(p.Exports, want) {
					t.Errorf("exports = %+v", p.Exports)
				}
			},
		},
		{
			name: "ApplyMacro runs a saved macro by name",
			run:  func(c *audacitybridge.Client) error { return c.ApplyMacro(ctx, "Mastering for ACX") },
			sent: []string{`ApplyMacro: MacroName="Mastering for ACX"`},
			check: func(t *testing.T, p *abt.Project) {
				if !reflect.DeepEqual(p.MacrosApplied, []string{"Mastering for ACX"}) {
					t.Errorf("macros applied = %v", p.MacrosApplied)
				}
			},
		},
		{
			name: "Import adds audio",
			run:  func(c *audacitybridge.Client) error { return c.Import(ctx, `D:\takes\pickup 3.flac`) },
			sent: []string{`Import2: Filename="D:/takes/pickup 3.flac"`},
			check: func(t *testing.T, p *abt.Project) {
				if !reflect.DeepEqual(p.Imported, []string{"D:/takes/pickup 3.flac"}) {
					t.Errorf("imported = %v", p.Imported)
				}
			},
		},
		{
			name: "OpenProject opens an .aup3 without adding it to the recent list",
			run:  func(c *audacitybridge.Client) error { return c.OpenProject(ctx, `C:\book\Book.aup3`) },
			sent: []string{`OpenProject2: Filename="C:/book/Book.aup3" AddToHistory=0`},
			check: func(t *testing.T, p *abt.Project) {
				if p.Opened != "C:/book/Book.aup3" {
					t.Errorf("opened = %q", p.Opened)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client, server := newClient(t, time.Second)
			if tc.setup != nil {
				server.With(tc.setup)
			}
			if err := tc.run(client); err != nil {
				t.Fatalf("run: %v", err)
			}
			if got := server.Log(); !reflect.DeepEqual(got, tc.sent) {
				t.Errorf("sent %q\nwant %q", got, tc.sent)
			}
			server.With(func(p *abt.Project) { tc.check(t, p) })
		})
	}
}

// Refused before sending: the extensions that would pick another exporter or importer (Export2's "CL" runs an external
// program), and ranges or indexes that name nothing.
func TestCommandsRefuseBeforeSending(t *testing.T) {
	ctx := context.Background()
	cases := map[string]func(*audacitybridge.Client) error{
		"the external-program exporter":  func(c *audacitybridge.Client) error { return c.Export(ctx, `C:\a\x.CL`, 1) },
		"an export with no extension":    func(c *audacitybridge.Client) error { return c.Export(ctx, `C:\a\x`, 1) },
		"three channels":                 func(c *audacitybridge.Client) error { return c.Export(ctx, `C:\a\x.wav`, 3) },
		"importing a label file":         func(c *audacitybridge.Client) error { return c.Import(ctx, `C:\a\labels.txt`) },
		"opening an Audacity 2 project":  func(c *audacitybridge.Client) error { return c.OpenProject(ctx, `C:\a\old.aup`) },
		"a negative time":                func(c *audacitybridge.Client) error { return c.SelectTime(ctx, -1, 2) },
		"a selection that ends first":    func(c *audacitybridge.Client) error { return c.SelectTime(ctx, 3, 2) },
		"no tracks":                      func(c *audacitybridge.Client) error { return c.SelectTracks(ctx, 0, 0) },
		"a negative label":               func(c *audacitybridge.Client) error { return c.SetLabel(ctx, -1, audacitybridge.LabelEdit{}) },
		"a negative track":               func(c *audacitybridge.Client) error { return c.SetTrackName(ctx, -1, "x") },
		"a track name with a quote":      func(c *audacitybridge.Client) error { return c.SetTrackName(ctx, 0, `a"b`) },
		"a macro name with a quote":      func(c *audacitybridge.Client) error { return c.ApplyMacro(ctx, `a"b`) },
		"an export path on another host": func(c *audacitybridge.Client) error { return c.Export(ctx, `\\nas\book\x.wav`, 1) },
	}
	for name, run := range cases {
		t.Run(name, func(t *testing.T) {
			client, server := newClient(t, time.Second)
			if err := run(client); !errors.Is(err, audacitybridge.ErrInvalidValue) {
				t.Fatalf("err = %v, want ErrInvalidValue", err)
			}
			if len(server.Log()) != 0 {
				t.Errorf("sent %q", server.Log())
			}
		})
	}
}

func TestInfoRoundTripsThroughTheFake(t *testing.T) {
	client, server := newClient(t, time.Second)
	server.With(func(p *abt.Project) {
		p.AddWaveTrack("Chapter 1", 0, 90.5)
		p.AddLabelTrack("Narration Utils", abt.Label{Start: 4, End: 4, Text: "nu:f1 misread"}, abt.Label{Start: 1, End: 2, Text: `a "quoted" note`})
	})
	ctx := context.Background()
	labels, err := client.Labels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []audacitybridge.LabelInfo{
		{Index: 0, Track: 1, Start: 1, End: 2, Text: `a "quoted" note`},
		{Index: 1, Track: 1, Start: 4, End: 4, Text: "nu:f1 misread"},
	}
	if !reflect.DeepEqual(labels, want) {
		t.Errorf("labels = %+v", labels)
	}
	tracks, err := client.Tracks(ctx)
	if err != nil || len(tracks) != 2 || tracks[0].Kind != "wave" || tracks[0].End != 90.5 || tracks[1].Kind != "label" {
		t.Errorf("tracks = %+v, %v", tracks, err)
	}
	clips, err := client.Clips(ctx)
	if err != nil || !reflect.DeepEqual(clips, []audacitybridge.ClipInfo{{Track: 0, Start: 0, End: 90.5, Name: "Chapter 1"}}) {
		t.Errorf("clips = %+v, %v", clips, err)
	}
	if got := server.Log(); !reflect.DeepEqual(got, []string{"GetInfo: Type=Labels Format=JSON", "GetInfo: Type=Tracks Format=JSON", "GetInfo: Type=Clips Format=JSON"}) {
		t.Errorf("sent %q", got)
	}
}

// A GetInfo body that is not the documented JSON is a protocol error, never a silent empty list.
func TestAnUnrecognisedCommandFails(t *testing.T) {
	client, _ := newClient(t, time.Second)
	_, err := client.Do(context.Background(), audacitybridge.NewCommand("NoSuchCommand"))
	var ce *audacitybridge.CommandError
	if !errors.As(err, &ce) || len(ce.Lines) != 1 {
		t.Fatalf("err = %v", err)
	}
}
