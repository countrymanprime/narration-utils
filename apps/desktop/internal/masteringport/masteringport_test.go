package masteringport_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/mastering"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport/masteringporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestEveryRegisteredRowPassesTheSuite(t *testing.T) {
	for _, entry := range masteringport.Rows.Entries() {
		t.Run(entry.Name, func(t *testing.T) { masteringporttest.Run(t, entry) })
	}
}

func TestTheRowsAreTheBuiltInChainThenTheDAW(t *testing.T) {
	// D86: the built-in chain is the default; the DAW row is declared and not yet available. No Audacity row until its pipe client.
	for _, platform := range port.Platforms {
		if got := masteringport.Rows.Names(platform); !reflect.DeepEqual(got, []string{masteringport.Builtin, masteringport.DAW}) {
			t.Errorf("Rows.Names(%q) = %v, want [builtin daw]", platform, got)
		}
	}
	entry, ok := masteringport.Default(masteringport.Rows)
	if !ok || entry.Name != masteringport.Builtin {
		t.Fatalf("Default = %q, %v; want builtin", entry.Name, ok)
	}
	if _, ok := masteringport.Default(masteringport.NewRegistry()); ok {
		t.Error("an empty registry has no default")
	}
}

func TestSupportSaysWhatANarratorCanChoose(t *testing.T) {
	builtin, _ := masteringport.Rows.Lookup(masteringport.Builtin)
	if got := masteringport.Support(builtin, "windows"); got != (port.Support{Level: port.Supported, Available: true}) {
		t.Errorf("Support(builtin) = %+v, want supported and available", got)
	}
	daw, _ := masteringport.Rows.Lookup(masteringport.DAW)
	got := masteringport.Support(daw, "windows")
	want := port.Support{Level: port.NotYetAvailable, Reason: port.ReasonNotYet, Message: "Your DAW's FX chain is not available yet."}
	if got != want {
		t.Errorf("Support(daw) = %+v, want %+v", got, want)
	}
	windowsOnly := port.Entry[masteringport.Mastering]{Name: "w", Descriptor: port.Descriptor{Label: "Windows chain", Platforms: []string{"windows"}},
		New: func() masteringport.Mastering { return masteringporttest.NewFake("w", false) }}
	if got := masteringport.Support(windowsOnly, "linux"); got.Available || got.Reason != port.ReasonUnsupported || got.Message == "" {
		t.Errorf("Support off its platform = %+v, want unsupported with a sentence", got)
	}
}

func TestTheDAWRowIsADeclarationThatNeedsApproval(t *testing.T) {
	entry, _ := masteringport.Rows.Lookup(masteringport.DAW)
	row := entry.New()
	caps := row.Capabilities()
	if caps.Level != port.NotYetAvailable || !caps.NeedsApproval || len(caps.Needs) != 2 {
		t.Fatalf("daw Capabilities = %+v, want NotYetAvailable, approval, render_with_fx and master_chain_read", caps)
	}
	_, err := row.Master(context.Background(), masteringport.Request{Approved: true})
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("daw Master = %v, want a *port.NotSupportedError", err)
	}
}

func TestAnUnknownRowIsRefused(t *testing.T) {
	_, err := masteringport.Rows.Lookup("audacity")
	if !errors.Is(err, port.ErrNotSupported) || err.Error() != `There is no mastering chain called "audacity".` {
		t.Fatalf("Lookup(audacity) = %v", err)
	}
}

func TestTheBuiltinRowIsTheMasteringChainUnchanged(t *testing.T) {
	// The same source mastered through the port and through internal/mastering directly writes the same bytes and the same verdict.
	dir := t.TempDir()
	source := filepath.Join(dir, "source.wav")
	if err := os.WriteFile(source, masteringporttest.ToneWAV(), 0o600); err != nil {
		t.Fatal(err)
	}
	profile := deliveryprofile.ACX()
	direct, err := mastering.Master(context.Background(), mastering.Request{Source: source, Destination: filepath.Join(dir, "direct.wav"), Profile: profile}, mastering.Options{})
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := masteringport.Rows.Lookup(masteringport.Builtin)
	viaPort, err := entry.New().Master(context.Background(), masteringport.Request{Source: source, Destination: filepath.Join(dir, "port.wav"), Profile: profile})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(direct.Destination)
	b, _ := os.ReadFile(viaPort.Destination)
	if !bytes.Equal(a, b) {
		t.Error("the builtin row wrote different audio from internal/mastering")
	}
	direct.After.File = viaPort.After.File
	if !reflect.DeepEqual(direct.After, viaPort.After) || !reflect.DeepEqual(direct.Before, *viaPort.Before) {
		t.Error("the builtin row measured differently from internal/mastering")
	}
	if len(direct.Judgement.Results) != len(viaPort.Judgement.Results) {
		t.Error("the builtin row judged differently from internal/mastering")
	}
	if _, err := entry.New().Master(context.Background(), masteringport.Request{Source: source, Destination: viaPort.Destination, Profile: profile}); !errors.Is(err, masteringport.ErrDestinationExists) {
		t.Errorf("mastering onto an existing file = %v, want ErrDestinationExists", err)
	}
}

func TestANewRowIsOneRegistrationAndPassesTheSuiteWithNoOtherEdit(t *testing.T) {
	rows := masteringport.NewRegistry()
	rows.Register(masteringporttest.NewFake("mock", true).Entry())
	for _, entry := range rows.Entries() {
		t.Run(entry.Name, func(t *testing.T) { masteringporttest.Run(t, entry) })
	}
	if len(masteringport.Rows.Entries()) != 2 {
		t.Error("registering on a new registry changed the program's")
	}
}

func TestTheBuiltinRowDeclaresTheStepsItRuns(t *testing.T) {
	// Master & QC draws the chain before anything is mastered (stage navigation Phase 8), so the row declares its steps, and they are
	// the steps a master reports, in the same order. The DAW row declares none: the project's own FX chain decides what runs there.
	entry, _ := masteringport.Rows.Lookup(masteringport.Builtin)
	declared := entry.New().Capabilities().Chain
	want := []masteringport.Step{
		{Name: "EQ", Detail: "High-pass 80 Hz"},
		{Name: "Limiter", Detail: "0.5 dB under the peak limit"},
		{Name: "Gain", Detail: "To the RMS target"},
	}
	if !reflect.DeepEqual(declared, want) {
		t.Fatalf("declared chain = %+v, want %+v", declared, want)
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "source.wav")
	if err := os.WriteFile(source, masteringporttest.ToneWAV(), 0o600); err != nil {
		t.Fatal(err)
	}
	ran, err := entry.New().Master(context.Background(), masteringport.Request{Source: source, Destination: filepath.Join(dir, "out.wav"), Profile: deliveryprofile.ACX()})
	if err != nil {
		t.Fatal(err)
	}
	if len(ran.Chain) != len(declared) {
		t.Fatalf("a master ran %d steps, the row declares %d", len(ran.Chain), len(declared))
	}
	for i := range declared {
		if ran.Chain[i].Name != declared[i].Name {
			t.Errorf("step %d ran %q, the row declares %q", i, ran.Chain[i].Name, declared[i].Name)
		}
	}
	daw, _ := masteringport.Rows.Lookup(masteringport.DAW)
	if chain := daw.New().Capabilities().Chain; len(chain) != 0 {
		t.Errorf("the DAW row declares %+v, want no steps of its own", chain)
	}
}
