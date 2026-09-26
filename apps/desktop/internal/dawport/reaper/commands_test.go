package reaper

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
)

// Each asynchronous role method writes exactly the line its service's `Send` writes today (internal/pickups, lineidentity,
// renderconfig, cleanuptools, retakelanes, projectstate, takereview/createtake.go), so a P5 migration that swaps the Send for the
// method changes nothing REAPER sees.
func TestAsynchronousRolesWriteTodaysCommandLines(t *testing.T) {
	trace := dawport.Trace{RunID: "log-run", Level: "debug"}
	for name, tc := range map[string]struct {
		call func(a *Adapter) error
		want []string
	}{
		"import_pickups": {func(a *Adapter) error { return pickups(a).ImportPickups("r1", "C:/in.json") }, []string{"import_pickups", "r1", "C:/in.json"}},
		"export_pickups": {func(a *Adapter) error { return pickups(a).ExportPickups("r1", "C:/out.csv") }, []string{"export_pickups", "r1", "C:/out.csv"}},
		"next_pickup":    {func(a *Adapter) error { return pickups(a).NextPickup("r1") }, []string{"next_pickup", "r1"}},
		// pickups.Service formats the position with strconv.FormatFloat(position, 'f', 6, 64).
		"resolve_pickup": {func(a *Adapter) error { return pickups(a).ResolvePickup("r1", 12.5) }, []string{"resolve_pickup", "r1", "12.500000"}},
		"count_pickups":  {func(a *Adapter) error { return pickups(a).CountPickups("r1") }, []string{"count_pickups", "r1"}},
		"stamp_item_lines keep": {func(a *Adapter) error { return lines(a).StampLines("r1", "C:/lines.txt", false) },
			[]string{"stamp_item_lines", "r1", "C:/lines.txt", "0"}},
		"stamp_item_lines overwrite": {func(a *Adapter) error { return lines(a).StampLines("r1", "C:/lines.txt", true) },
			[]string{"stamp_item_lines", "r1", "C:/lines.txt", "1"}},
		"read_line_ids": {func(a *Adapter) error { return lines(a).ReadLineIDs("r1", "C:/ids.txt") }, []string{"read_line_ids", "r1", "C:/ids.txt"}},
		"configure_chapter_render": {func(a *Adapter) error {
			return a.Role(dawport.CapRenderConfig).(dawport.RenderConfigurer).ConfigureChapterRender("r1", "C:/renders")
		}, []string{"configure_chapter_render", "r1", "C:/renders"}},
		"launch_cleanup_tool": {func(a *Adapter) error {
			return a.Role(dawport.CapCleanupTools).(dawport.CleanupLauncher).LaunchCleanupTool("r1", "strip_silence", trace)
		}, []string{"launch_cleanup_tool", "r1", "strip_silence", "log-run", "debug"}},
		"pick_retake_lane": {func(a *Adapter) error {
			return a.Role(dawport.CapRetakeLanes).(dawport.RetakeLanePicker).PickRetakeLane("r1", "L-7", "{ITEM}", trace)
		}, []string{"pick_retake_lane", "r1", "L-7", "{ITEM}", "log-run", "debug"}},
		"project_state": {func(a *Adapter) error {
			return a.Role(dawport.CapProjectState).(dawport.ProjectStateReader).RequestProjectState("r1")
		}, []string{"project_state", "r1"}},
		"create_take": {func(a *Adapter) error {
			return a.Role(dawport.CapTakeCreate).(dawport.TakeCreator).CreateTake("r1", "C:/take.json")
		}, []string{"create_take", "r1", "C:/take.json"}},
	} {
		t.Run(name, func(t *testing.T) {
			adapter, dir := newAdapter(t, nil)
			if err := tc.call(adapter); err != nil {
				t.Fatalf("call: %v", err)
			}
			if got, want := sentCommands(t, dir), [][]string{tc.want}; !slices.EqualFunc(got, want, slices.Equal) {
				t.Errorf("wrote %q, want %q", got, want)
			}
		})
	}
}

// A failed write is returned, never swallowed: the service turns it into the run's failure message.
func TestAsynchronousRolesReturnASendFailure(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if err := pickups(adapter).NextPickup("r1"); err == nil {
		t.Error("NextPickup over a closed session returned nil")
	}
}

// Every asynchronous role shares the client's one fan-out: a subscription made through a role receives the client's events.
func TestAsynchronousRolesShareTheClientsEvents(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	var got []string
	unsubscribe := pickups(adapter).Subscribe(dawport.Subscription{
		Tags:   []string{"PICKUPS_COUNTED"},
		Handle: func(e dawport.Event) { got = append(got, e.Tag+" "+e.RunID) },
	})
	defer unsubscribe()
	line := bridge.EncodeFields([]string{"PICKUPS_COUNTED", "r1", "3", "5"}) + "\n"
	if err := os.WriteFile(filepath.Join(dir, "events.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	// Dispatched through another role: one client, one cursor.
	if err := lines(adapter).Dispatch(); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if !slices.Equal(got, []string{"PICKUPS_COUNTED r1"}) {
		t.Errorf("delivered %q, want the one PICKUPS_COUNTED", got)
	}
}

func pickups(a *Adapter) dawport.PickupList { return a.Role(dawport.CapPickups).(dawport.PickupList) }
func lines(a *Adapter) dawport.LineStamper {
	return a.Role(dawport.CapLineIdentity).(dawport.LineStamper)
}

// sentCommands decodes every command file in the session, in order, without the protocol version.
func sentCommands(t *testing.T, dir string) [][]string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(dir, "commands", "*.cmd"))
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(paths)
	var commands [][]string
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fields, err := bridge.DecodeFields(strings.TrimSuffix(string(raw), "\n"))
		if err != nil {
			t.Fatalf("decoding %s: %v", path, err)
		}
		if len(fields) == 0 || fields[0] != "1" {
			t.Fatalf("%s has protocol %q, want 1", path, fields)
		}
		commands = append(commands, fields[1:])
	}
	return commands
}
