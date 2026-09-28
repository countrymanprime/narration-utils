package audacity

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	abt "github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func newTestClient(t *testing.T) (*audacitybridge.Client, *abt.Server) {
	t.Helper()
	server := abt.NewServer()
	client := audacitybridge.New(server.Transport(), audacitybridge.Options{Timeout: time.Second})
	return client, server
}

func TestRenderWithMacroRefusesWithoutApproval(t *testing.T) {
	client, server := newTestClient(t)
	role := macroRender{client}
	_, err := role.RenderWithMacro(t.Context(), dawport.MacroRender{Source: `C:\book\ch01.wav`, Macro: "Mastering for ACX"})
	if !errors.Is(err, ErrNoApproval) {
		t.Fatalf("err = %v, want ErrNoApproval", err)
	}
	if len(server.Log()) != 0 {
		t.Errorf("sent %q before checking approval", server.Log())
	}
}

func TestRenderWithMacroRefusesWithNoMacroName(t *testing.T) {
	client, server := newTestClient(t)
	role := macroRender{client}
	_, err := role.RenderWithMacro(t.Context(), dawport.MacroRender{Source: `C:\book\ch01.wav`, Approval: "tok"})
	if !errors.Is(err, ErrNoMacro) {
		t.Fatalf("err = %v, want ErrNoMacro", err)
	}
	if len(server.Log()) != 0 {
		t.Errorf("sent %q before checking the macro name", server.Log())
	}
}

// The happy path imports the source as its own track, selects only that track (never whatever else is open), applies the named
// macro, and exports at the imported track's own channel count.
func TestRenderWithMacroImportsSelectsAppliesAndExports(t *testing.T) {
	client, server := newTestClient(t)
	server.With(func(p *abt.Project) { p.AddWaveTrack("Existing narration", 0, 30) })
	role := macroRender{client}
	req := dawport.MacroRender{
		Source:     `C:\book\ch01.wav`,
		Macro:      "Mastering for ACX",
		OutputPath: `C:\book\narration-utils\mastering\master-abc\out.wav`,
		Approval:   "a-fresh-token",
	}
	result, err := role.RenderWithMacro(t.Context(), req)
	if err != nil {
		t.Fatalf("RenderWithMacro: %v", err)
	}
	if result.Path != req.OutputPath {
		t.Errorf("Path = %q, want %q", result.Path, req.OutputPath)
	}
	want := []string{
		`Import2: Filename="C:/book/ch01.wav"`,
		"GetInfo: Type=Tracks Format=JSON",
		"SelectTracks: Track=1 TrackCount=1 Mode=Set",
		`ApplyMacro: MacroName="Mastering for ACX"`,
		`Export2: Filename="C:/book/narration-utils/mastering/master-abc/out.wav" NumChannels=1`,
	}
	if got := server.Log(); !reflect.DeepEqual(got, want) {
		t.Errorf("sent %q\nwant %q", got, want)
	}
	server.With(func(p *abt.Project) {
		if !p.Tracks[1].Selected || p.Tracks[0].Selected {
			t.Errorf("tracks selected = %+v, want only the imported one", p.Tracks)
		}
		if !reflect.DeepEqual(p.MacrosApplied, []string{"Mastering for ACX"}) {
			t.Errorf("macros applied = %v", p.MacrosApplied)
		}
	})
}

// A refusal from any step comes back as-is, and nothing later in the sequence runs.
func TestRenderWithMacroStopsAtTheFirstRefusal(t *testing.T) {
	client, server := newTestClient(t)
	server.SetDown(true)
	role := macroRender{client}
	_, err := role.RenderWithMacro(t.Context(), dawport.MacroRender{
		Source: `C:\book\ch01.wav`, Macro: "Mastering for ACX", OutputPath: `C:\book\out.wav`, Approval: "tok",
	})
	if err == nil {
		t.Fatal("RenderWithMacro succeeded against a closed transport")
	}
	if len(server.Log()) != 0 {
		t.Errorf("sent %q against a closed transport", server.Log())
	}
}
