package masteringport_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport/masteringporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func dawRow(t *testing.T) masteringport.Mastering {
	t.Helper()
	entry, err := masteringport.Rows.Lookup(masteringport.DAW)
	if err != nil {
		t.Fatal(err)
	}
	return entry.New()
}

func useSession(t *testing.T, session func() (masteringport.Session, error)) {
	t.Helper()
	t.Cleanup(masteringport.UseSession(session))
}

func TestTheDAWRowRendersTheRegionThroughTheProjectsFXAndReportsTheChain(t *testing.T) {
	project := t.TempDir()
	daw := masteringporttest.NewFakeDAW(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	dest := filepath.Join(project, "Chapter 1 mastered.wav")
	result, err := dawRow(t).Master(context.Background(), masteringport.Request{
		Region: "Chapter 1", Destination: dest, Profile: deliveryprofile.ACX(), Approved: true})
	if err != nil {
		t.Fatal(err)
	}
	wantChain := []masteringport.Step{
		{Name: "Voice", Detail: "VST: ReaEQ (Cockos)"},
		{Name: "Master", Detail: "VST: ReaLimit (Cockos)"},
		{Name: "Render", Detail: `"Chapter 1" through the project's FX`},
	}
	if !reflect.DeepEqual(result.Chain, wantChain) || result.Before != nil || result.Provider != masteringport.DAW {
		t.Fatalf("result = %+v", result)
	}
	renders := daw.Renders()
	if len(renders) != 1 || !reflect.DeepEqual(renders[0].Regions, []string{"Chapter 1"}) {
		t.Fatalf("renders = %+v", renders)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(renders[0].Approval) {
		t.Errorf("approval %q is not a 128-bit hex token", renders[0].Approval)
	}
	if rel, _ := filepath.Rel(filepath.Join(project, "narration-utils", "mastering"), renders[0].OutputFolder); !regexp.MustCompile(`^master-[0-9a-f]{16}$`).MatchString(rel) {
		t.Errorf("run folder %q is not a new folder in the project's mastering folder", renders[0].OutputFolder)
	}
	if _, err := os.Stat(renders[0].OutputFolder); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the run folder is still there: %v", err)
	}
}

func TestEachDAWMasterCarriesItsOwnApproval(t *testing.T) {
	project := t.TempDir()
	daw := masteringporttest.NewFakeDAW(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	for _, name := range []string{"one.wav", "two.wav"} {
		if _, err := dawRow(t).Master(context.Background(), masteringport.Request{Region: "Chapter 1", Destination: filepath.Join(project, name),
			Profile: deliveryprofile.ACX(), Approved: true}); err != nil {
			t.Fatal(err)
		}
	}
	renders := daw.Renders()
	if len(renders) != 2 || renders[0].Approval == renders[1].Approval || renders[0].OutputFolder == renders[1].OutputFolder {
		t.Fatalf("two masters shared an approval or a folder: %+v", renders)
	}
}

func TestTheDAWRowNeedsADAWARegionAndItsCapabilities(t *testing.T) {
	project := t.TempDir()
	request := masteringport.Request{Region: "Chapter 1", Destination: filepath.Join(project, "out.wav"), Profile: deliveryprofile.ACX(), Approved: true}

	useSession(t, nil)
	if _, err := dawRow(t).Master(context.Background(), request); !errors.Is(err, masteringport.ErrNoDAW) {
		t.Errorf("with no DAW session: %v, want ErrNoDAW", err)
	}

	daw := masteringporttest.NewFakeDAW(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	noRegion := request
	noRegion.Region = ""
	if _, err := dawRow(t).Master(context.Background(), noRegion); !errors.Is(err, masteringport.ErrNoRegion) {
		t.Errorf("with no region: %v, want ErrNoRegion", err)
	}

	// Experimental capabilities the narrator has not switched on are the DAW port's refusal, with its sentence; nothing renders.
	off := dawport.NewResolver(dawport.ResolverConfig{Adapter: daw,
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} }})
	useSession(t, func() (masteringport.Session, error) {
		return masteringport.Session{Resolver: off, ProjectFolder: project}, nil
	})
	_, err := dawRow(t).Master(context.Background(), request)
	var refusal *port.NotSupportedError
	if !errors.As(err, &refusal) || refusal.Support.Reason != port.ReasonExperimentalOff {
		t.Errorf("with the capabilities off: %v, want an experimental_off refusal", err)
	}
	if len(daw.Renders()) != 0 {
		t.Errorf("a refused master rendered: %+v", daw.Renders())
	}
	if _, err := os.Stat(request.Destination); !errors.Is(err, os.ErrNotExist) {
		t.Error("a refused master wrote its destination")
	}
}
