package reaper

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

func renderer(a *Adapter) dawport.FXRenderer {
	return a.Role(dawport.CapRenderWithFX).(dawport.FXRenderer)
}

// render_with_fx carries the run, the approval, the run folder and the regions, one per line (narration_master_render.lua).
func TestRenderWithFXWritesTheApprovalTheFolderAndTheRegions(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	render := dawport.FXRender{Regions: []string{"Chapter 2", "Chapter 1"}, OutputFolder: "C:/p/narration-utils/mastering/run1",
		Approval: "0123456789abcdef0123456789abcdef"}
	if err := renderer(adapter).RenderWithFX("r1", render); err != nil {
		t.Fatalf("RenderWithFX: %v", err)
	}
	want := [][]string{{"render_with_fx", "r1", render.Approval, render.OutputFolder, "Chapter 2\nChapter 1"}}
	if got := sentCommands(t, dir); !slices.EqualFunc(got, want, slices.Equal) {
		t.Errorf("wrote %q, want %q", got, want)
	}
}

// The adapter refuses a request the bridge would refuse anyway before anything is written: no approval, no folder, no region, or a
// region name that would split into two.
func TestRenderWithFXRefusesAnIncompleteRequestAndWritesNothing(t *testing.T) {
	ok := dawport.FXRender{Regions: []string{"Chapter 1"}, OutputFolder: "C:/p/narration-utils/mastering/run1", Approval: "0123456789abcdef0123456789abcdef"}
	for name, tc := range map[string]struct {
		change func(*dawport.FXRender)
		want   error
	}{
		"no approval":           {func(r *dawport.FXRender) { r.Approval = "" }, ErrNoApproval},
		"no folder":             {func(r *dawport.FXRender) { r.OutputFolder = "" }, ErrBadRender},
		"no region":             {func(r *dawport.FXRender) { r.Regions = nil }, ErrBadRender},
		"an empty region":       {func(r *dawport.FXRender) { r.Regions = []string{""} }, ErrBadRender},
		"a region with a break": {func(r *dawport.FXRender) { r.Regions = []string{"Chapter\n1"} }, ErrBadRender},
	} {
		t.Run(name, func(t *testing.T) {
			adapter, dir := newAdapter(t, nil)
			render := ok
			tc.change(&render)
			if err := renderer(adapter).RenderWithFX("r1", render); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if got := sentCommands(t, dir); len(got) != 0 {
				t.Errorf("wrote %q", got)
			}
		})
	}
}

// answerCommands plays REAPER for one session: each command it finds gets answer's lines appended to events.log, and the client is
// dispatched, as the host's loop would, until the test ends.
func answerCommands(t *testing.T, client *bridge.Client, dir string, answer func(command []string) [][]string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	t.Cleanup(func() { cancel(); <-done })
	go func() {
		defer close(done)
		seen := map[string]bool{}
		for ctx.Err() == nil {
			paths, _ := filepath.Glob(filepath.Join(dir, "commands", "*.cmd"))
			for _, path := range paths {
				if seen[path] {
					continue
				}
				seen[path] = true
				raw, err := os.ReadFile(path)
				if err != nil {
					continue
				}
				fields, _ := bridge.DecodeFields(strings.TrimSuffix(string(raw), "\n"))
				log, err := os.OpenFile(filepath.Join(dir, "events.log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
				if err != nil {
					continue
				}
				for _, line := range answer(fields[1:]) {
					_, _ = log.WriteString(bridge.EncodeFields(line) + "\n")
				}
				_ = log.Close()
			}
			_ = client.Dispatch()
			time.Sleep(5 * time.Millisecond)
		}
	}()
}

func TestReadMasterChainIsTheBridgesListInTheDAWPortsShape(t *testing.T) {
	client, dir := newClient(t)
	adapter, err := New(client, func(dawport.Capability) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	answerCommands(t, client, dir, func(command []string) [][]string {
		return [][]string{
			{"MASTER_CHAIN_FX", command[1], "{00000001-0000-4000-8000-000000000001}", "Voice", "VST: ReaEQ (Cockos)", "0"},
			{"MASTER_CHAIN_FX", command[1], "master", "MASTER", "VST: ReaLimit (Cockos)", "1"},
			{"MASTER_CHAIN_READ", command[1], "2", "0"},
		}
	})
	got, err := adapter.Role(dawport.CapMasterChainRead).(dawport.MasterChainReader).ReadMasterChain(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	want := dawport.MasterChain{
		Tracks: []dawport.TrackFX{{TrackGUID: "{00000001-0000-4000-8000-000000000001}", Name: "Voice", FX: []dawport.FXSlot{{Name: "VST: ReaEQ (Cockos)"}}}},
		Master: []dawport.FXSlot{{Name: "VST: ReaLimit (Cockos)", Enabled: true}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// master_chain_read goes through bridge.Actions' gate like every experimental command: refused, and nothing written, until allowed.
func TestReadMasterChainIsGatedByTheResolver(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	if _, err := adapter.Role(dawport.CapMasterChainRead).(dawport.MasterChainReader).ReadMasterChain(t.Context()); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("err = %v, want ErrExperimentalOff", err)
	}
	if got := sentCommands(t, dir); len(got) != 0 {
		t.Errorf("wrote %q", got)
	}
}
