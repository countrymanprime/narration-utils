package reaper

import (
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/dawport/dawporttest"
)

// newClient is a bridge client over a fresh session directory, and that directory.
func newClient(t testing.TB) (*bridge.Client, string) {
	t.Helper()
	dir := t.TempDir()
	client, err := bridge.New(dir)
	if err != nil {
		t.Fatalf("bridge.New: %v", err)
	}
	return client, dir
}

func newAdapter(t testing.TB, allowed func(dawport.Capability) error) (*Adapter, string) {
	t.Helper()
	client, dir := newClient(t)
	adapter, err := New(client, allowed)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return adapter, dir
}

// The adapter over a session whose directory has gone (REAPER closed and the launcher cleaned up): every command fails to write.
func TestConformance(t *testing.T) {
	for name, allowed := range map[string]func(dawport.Capability) error{
		"experimental actions off": nil,
		"experimental actions on":  func(dawport.Capability) error { return nil },
	} {
		t.Run(name, func(t *testing.T) {
			dawporttest.Run(t, func(tb testing.TB) dawport.Adapter {
				adapter, dir := newAdapter(tb, allowed)
				if err := os.RemoveAll(dir); err != nil {
					tb.Fatalf("closing the transport: %v", err)
				}
				return adapter
			})
		})
	}
}

func TestTheFactoryIsRegisteredForREAPER(t *testing.T) {
	factory, ok := dawport.Lookup(dawport.KindREAPER)
	if !ok {
		t.Fatal("no factory registered for REAPER")
	}
	dir := t.TempDir()
	var logged []string
	adapter, err := factory(dawport.Env{SessionDir: dir, Log: func(kind, message string) { logged = append(logged, kind+": "+message) }})
	if err != nil {
		t.Fatalf("factory: %v", err)
	}
	if adapter.Kind() != dawport.KindREAPER {
		t.Errorf("Kind() = %v, want REAPER", adapter.Kind())
	}
	if _, err := os.Stat(filepath.Join(dir, "commands")); err != nil {
		t.Errorf("the factory did not open the session's bridge: %v", err)
	}
	// The factory hands Env.Log to the client: an event that fails the wire table is reported through it.
	if err := os.WriteFile(filepath.Join(dir, "events.log"), []byte(bridge.EncodeFields([]string{"NAVIGATED", "run"})+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Role(dawport.CapPickups).(dawport.PickupList).Dispatch(); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if len(logged) == 0 {
		t.Error("an invalid event was not reported through Env.Log")
	}
}

func TestTheFactoryRefusesALaunchWithNoSession(t *testing.T) {
	factory, _ := dawport.Lookup(dawport.KindREAPER)
	adapter, err := factory(dawport.Env{})
	if !errors.Is(err, ErrNoSession) || adapter != nil {
		t.Errorf("factory(no session) = %v, %v; want nil, ErrNoSession", adapter, err)
	}
}

func TestNewRefusesANilClient(t *testing.T) {
	if adapter, err := New(nil, nil); !errors.Is(err, ErrNoSession) || adapter != nil {
		t.Errorf("New(nil) = %v, %v; want nil, ErrNoSession", adapter, err)
	}
}

// experimentalCapability is the capability each of bridge.Actions' experimental commands belongs to.
var experimentalCapability = map[string]dawport.Capability{
	"chapter_track_state": dawport.CapTrackState,
	"arm_only":            dawport.CapRecord,
	"record_start":        dawport.CapRecord,
	"record_stop":         dawport.CapRecord,
	"set_active_take":     dawport.CapTakes,
	"list_fx_chains":      dawport.CapFXChains,
	"apply_fx_chain":      dawport.CapFXChains,
	"list_fx":             dawport.CapFXChains,
	"add_take_fx":         dawport.CapFXChains,
	"create_regions":      dawport.CapRegions,
	"play_position":       dawport.CapPunch,
	"punch_to":            dawport.CapPunch,
}

// supportedCommands are the commands the Supported capabilities send, none of which is gated today.
var supportedCommands = map[string]dawport.Capability{
	"prepare_compare": dawport.CapReview, "inspect_compare_results": dawport.CapReview,
	"jump_to_compare_marker": dawport.CapReview, "export_compare_markers": dawport.CapReview,
	"import_pickups": dawport.CapPickups, "export_pickups": dawport.CapPickups, "next_pickup": dawport.CapPickups,
	"resolve_pickup": dawport.CapPickups, "count_pickups": dawport.CapPickups,
	"stamp_item_lines": dawport.CapLineIdentity, "read_line_ids": dawport.CapLineIdentity,
	"configure_chapter_render": dawport.CapRenderConfig,
	"launch_cleanup_tool":      dawport.CapCleanupTools,
	"pick_retake_lane":         dawport.CapRetakeLanes,
	"project_state":            dawport.CapProjectState,
	"create_take":              dawport.CapTakeCreate,
}

// experimentalCommandsInSource reads the keys of bridge.experimentalCommands from actions.go itself, so a command added to (or
// promoted out of) that map fails this test until the declaration follows it.
func experimentalCommandsInSource(t *testing.T) []string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), filepath.Join("..", "..", "bridge", "actions.go"), nil, 0)
	if err != nil {
		t.Fatalf("parsing bridge/actions.go: %v", err)
	}
	var commands []string
	ast.Inspect(file, func(n ast.Node) bool {
		spec, ok := n.(*ast.ValueSpec)
		if !ok || len(spec.Names) != 1 || spec.Names[0].Name != "experimentalCommands" {
			return true
		}
		for _, elt := range spec.Values[0].(*ast.CompositeLit).Elts {
			key, err := strconv.Unquote(elt.(*ast.KeyValueExpr).Key.(*ast.BasicLit).Value)
			if err != nil {
				t.Fatalf("an experimentalCommands key: %v", err)
			}
			commands = append(commands, key)
		}
		return false
	})
	if len(commands) == 0 {
		t.Fatal("found no experimentalCommands map in bridge/actions.go")
	}
	slices.Sort(commands)
	return commands
}

// The declaration is today's behaviour exactly (DAW port PRD P2): a capability is Experimental when bridge.Actions gates its
// commands behind the old switch, plus the two clients that were built but never wired; everything else is Supported.
func TestTheDeclarationMatchesTodaysGating(t *testing.T) {
	inSource := experimentalCommandsInSource(t)
	if mapped := slices.Sorted(maps.Keys(experimentalCapability)); !slices.Equal(inSource, mapped) {
		t.Fatalf("bridge's experimentalCommands are %v, but this test maps %v: a command was added or promoted, so move its "+
			"capability's declaration with it", inSource, mapped)
	}
	adapter, _ := newAdapter(t, nil)
	declared := adapter.Declares()

	for command, c := range experimentalCapability {
		if !bridge.Experimental(command) {
			t.Errorf("bridge.Experimental(%q) is false", command)
		}
		if declared[c] != dawport.Experimental {
			t.Errorf("%s (sends %s, gated today) is declared %v, want Experimental", c, command, declared[c])
		}
	}
	for command, c := range supportedCommands {
		if bridge.Experimental(command) {
			t.Errorf("%s's command %s is gated today, but %s is declared Supported", c, command, c)
		}
	}

	want := map[dawport.Capability]dawport.Level{}
	for _, spec := range dawport.Capabilities() {
		want[spec.Capability] = dawport.Supported
	}
	for _, c := range experimentalCapability {
		want[c] = dawport.Experimental
	}
	// Built, never wired, so never gated: declared Experimental so they stay off by default (PRD P2).
	want[dawport.CapSilenceTrim] = dawport.Experimental
	want[dawport.CapItemGain] = dawport.Experimental
	if !maps.Equal(declared, want) {
		t.Errorf("Declares() = %v, want %v", declared, want)
	}
}

// The roles hand out today's types as they are, so a consumer moved onto a role keeps its behaviour.
func TestTheSynchronousRolesAreTodaysTypes(t *testing.T) {
	adapter, _ := newAdapter(t, nil)
	for c, want := range map[dawport.Capability]string{
		dawport.CapReview:      "*dawadapter.Reaper",
		dawport.CapNavigate:    "*bridge.Navigator",
		dawport.CapMarkers:     "*bridge.Navigator",
		dawport.CapHeartbeat:   "*daw.Reachability",
		dawport.CapTrackState:  "*bridge.Actions",
		dawport.CapRecord:      "*bridge.Actions",
		dawport.CapPunch:       "*bridge.Actions",
		dawport.CapRegions:     "*bridge.Actions",
		dawport.CapTakes:       "*bridge.Actions",
		dawport.CapFXChains:    "*bridge.Actions",
		dawport.CapSilenceTrim: "*bridge.CleanupClient",
		dawport.CapItemGain:    "*bridge.LevelMatchClient",
	} {
		if got := typeName(adapter.Role(c)); got != want {
			t.Errorf("%s's role is %s, want %s", c, got, want)
		}
	}
	if adapter.Role(dawport.CapNavigate) != adapter.Role(dawport.CapMarkers) {
		t.Error("navigate and markers have different navigators: one client subscription each is enough")
	}
}

func typeName(v any) string { return fmt.Sprintf("%T", v) }

// bridge.Actions' gating is the resolver's (DAW port PRD P3): with nothing allowed, an experimental command is refused before anything
// is written, as it was behind the old switch.
func TestActionsWithNothingAllowedWriteNothing(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	punch := adapter.Role(dawport.CapPunch).(dawport.Puncher)
	if _, err := punch.PlayPosition(t.Context()); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Errorf("PlayPosition with nothing allowed = %v, want ErrExperimentalOff", err)
	}
	if entries, _ := os.ReadDir(filepath.Join(dir, "commands")); len(entries) != 0 {
		t.Errorf("a refused command wrote %d files", len(entries))
	}
}

// resolverOver is the composition root's wiring in miniature: the adapter's Env.Allowed is a closure over the resolver built over
// that same adapter, reading the narrator's settings from values.
func resolverOver(t *testing.T, values map[string]string) (*dawport.Resolver, *Adapter, string) {
	t.Helper()
	var resolver *dawport.Resolver
	adapter, dir := newAdapter(t, func(c dawport.Capability) error { return resolver.Allowed(c) })
	effective := func(tool, key, fallback string) (string, string) {
		if v, ok := values[tool+"."+key]; ok {
			return v, "global"
		}
		return fallback, "hardcoded"
	}
	resolver = dawport.NewResolver(dawport.ResolverConfig{
		Adapter:      adapter,
		Runtime:      adapter.Runtime,
		Toggle:       dawport.SettingsToggles(effective),
		Experimental: dawport.SettingsExperimental(effective),
	})
	return resolver, adapter, dir
}

func commandsWritten(t *testing.T, dir string) int {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(dir, "commands"))
	return len(entries)
}

// The PRD's hypothesis: turning punch on alone in Settings lets punch's commands out and nothing else.
func TestTurningPunchOnAloneSendsPunchAndNothingElse(t *testing.T) {
	_, adapter, dir := resolverOver(t, map[string]string{"DAW.capability.punch": "on"})
	fx := adapter.Role(dawport.CapFXChains).(dawport.FXManager)
	if _, err := fx.ListFXChains(t.Context()); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("ListFXChains with only punch on = %v, want ErrExperimentalOff", err)
	}
	if n := commandsWritten(t, dir); n != 0 {
		t.Fatalf("a refused FX command wrote %d files", n)
	}
	adapter.roles[dawport.CapPunch].(*bridge.Actions).SetTimeout(time.Millisecond)
	punch := adapter.Role(dawport.CapPunch).(dawport.Puncher)
	if _, err := punch.PlayPosition(t.Context()); errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("PlayPosition with punch on = %v: it was refused", err)
	}
	if n := commandsWritten(t, dir); n != 1 {
		t.Fatalf("PlayPosition with punch on wrote %d command files, want 1", n)
	}
}

// The old switch keeps working through the resolver: on, it lets every Experimental capability on auto out, but not one the
// narrator turned off.
func TestTheOldSwitchStillTurnsExperimentalCapabilitiesOn(t *testing.T) {
	_, adapter, dir := resolverOver(t, map[string]string{"DAW.experimental_reaper_actions": "true", "DAW.capability.fx_chains": "off"})
	fx := adapter.Role(dawport.CapFXChains).(dawport.FXManager)
	_, err := fx.ListFXChains(t.Context())
	var refusal *dawport.NotSupportedError
	if !errors.As(err, &refusal) || refusal.Support.Reason != dawport.ReasonTurnedOff {
		t.Fatalf("ListFXChains turned off = %v, want a turned_off refusal", err)
	}
	if n := commandsWritten(t, dir); n != 0 {
		t.Fatalf("a refused FX command wrote %d files", n)
	}
	adapter.roles[dawport.CapPunch].(*bridge.Actions).SetTimeout(time.Millisecond)
	if _, err := adapter.Role(dawport.CapPunch).(dawport.Puncher).PlayPosition(t.Context()); errors.Is(err, bridge.ErrExperimentalOff) {
		t.Fatalf("PlayPosition on auto with the old switch on = %v: it was refused", err)
	}
	if n := commandsWritten(t, dir); n != 1 {
		t.Fatalf("wrote %d command files, want 1", n)
	}
}

// Gate knows every command bridge.Actions sends: each experimental command (parsed from actions.go) maps to the capability this
// test file says it belongs to, and an unknown command is refused rather than let through.
func TestGateMapsEveryActionsCommandToItsCapability(t *testing.T) {
	for _, command := range experimentalCommandsInSource(t) {
		if got, want := commandCapability[command], experimentalCapability[command]; got != want {
			t.Errorf("commandCapability[%q] = %q, want %q", command, got, want)
		}
	}
	var asked []dawport.Capability
	gate := Gate(func(c dawport.Capability) error { asked = append(asked, c); return nil })
	if err := gate("punch_to"); err != nil || len(asked) != 1 || asked[0] != dawport.CapPunch {
		t.Errorf("gate(punch_to) = %v, asked %v; want nil after asking about punch", err, asked)
	}
	if err := gate("no_such_command"); err == nil {
		t.Error("gate(no_such_command) let an unknown command through")
	}
	if err := Gate(nil)("punch_to"); !errors.Is(err, bridge.ErrExperimentalOff) {
		t.Errorf("Gate(nil)(punch_to) = %v, want ErrExperimentalOff", err)
	}
}

// Declaration is the same declaration and wording as the adapter, with no roles: the host gates with it until P5a.
func TestDeclarationIsTheAdaptersDeclarationWithNoRoles(t *testing.T) {
	adapter, _ := newAdapter(t, nil)
	d := Declaration()
	if d.Kind() != dawport.KindREAPER || !maps.Equal(d.Declares(), adapter.Declares()) {
		t.Fatalf("Declaration() = %v %v, want the adapter's %v", d.Kind(), d.Declares(), adapter.Declares())
	}
	for _, spec := range dawport.Capabilities() {
		if role := d.Role(spec.Capability); role != nil {
			t.Errorf("Declaration().Role(%s) = %T, want nil", spec.Capability, role)
		}
	}
	for _, reason := range []dawport.Reason{dawport.ReasonStandalone, dawport.ReasonNotRunning, dawport.ReasonTurnedOff} {
		if got, want := d.(dawport.Explainer).Explain(dawport.CapPunch, reason), adapter.Explain(dawport.CapPunch, reason); got != want {
			t.Errorf("Explain(%s) = %q, want the adapter's %q", reason, got, want)
		}
	}
}

func TestProjectReaderParsesTheSavedProject(t *testing.T) {
	adapter, _ := newAdapter(t, nil)
	reader := adapter.Role(dawport.CapProjectRead).(dawport.ProjectReader)
	path := filepath.Join(t.TempDir(), "book.rpp")
	rpp := "<REAPER_PROJECT 0.1 \"7.0\" 0\n  <TRACK {AAAAAAAA-0000-0000-0000-000000000001}\n    NAME \"Chapter 1\"\n  >\n>\n"
	if err := os.WriteFile(path, []byte(rpp), 0o600); err != nil {
		t.Fatal(err)
	}
	project, err := reader.ReadProject(path)
	if err != nil {
		t.Fatalf("ReadProject: %v", err)
	}
	if len(project.Tracks) != 1 || project.Tracks[0].Name != "Chapter 1" {
		t.Errorf("ReadProject = %+v, want the one track", project)
	}
	if _, err := reader.ReadProject(filepath.Join(t.TempDir(), "missing.rpp")); err == nil {
		t.Error("ReadProject of a missing file did not fail")
	}
}

func TestRuntimeFollowsTheHeartbeat(t *testing.T) {
	adapter, dir := newAdapter(t, nil)
	if got := adapter.Runtime(); got != (dawport.Runtime{Bridge: true}) {
		t.Errorf("Runtime() before a heartbeat = %+v, want a quiet bridge", got)
	}
	heartbeat := bridge.EncodeFields([]string{"PROJECT_STATUS", "", "C:/book.rpp", "0"}) + "\n"
	if err := os.WriteFile(filepath.Join(dir, "events.log"), []byte(heartbeat), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Role(dawport.CapPickups).(dawport.PickupList).Dispatch(); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if got := adapter.Runtime(); got != (dawport.Runtime{Bridge: true, Reachable: true}) {
		t.Errorf("Runtime() after a heartbeat = %+v, want an answering bridge", got)
	}
}

// REAPER words its runtime refusals the way the host already does (bindings_navigation.go, bridge.ErrUnavailable).
func TestExplainUsesREAPERsWording(t *testing.T) {
	adapter, _ := newAdapter(t, nil)
	resolver := func(rt dawport.Runtime) *dawport.Resolver {
		return dawport.NewResolver(dawport.ResolverConfig{Adapter: adapter, Runtime: func() dawport.Runtime { return rt }})
	}
	if got := resolver(dawport.Runtime{}).Support(dawport.CapNavigate).Message; got != messageStandalone {
		t.Errorf("standalone message = %q, want %q", got, messageStandalone)
	}
	if got := resolver(dawport.Runtime{Bridge: true}).Support(dawport.CapNavigate).Message; got != messageNotRunning {
		t.Errorf("not running message = %q, want %q", got, messageNotRunning)
	}
	if got := resolver(dawport.Runtime{Bridge: true, Reachable: true}).Support(dawport.CapPunch).Message; got != "Experimental: switched off in Settings." {
		t.Errorf("experimental_off message = %q, want the resolver's own", got)
	}
}
