package masteringport_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport/masteringporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func audacityRow(t *testing.T) masteringport.Mastering {
	t.Helper()
	entry, err := masteringport.Rows.Lookup(masteringport.Audacity)
	if err != nil {
		t.Fatal(err)
	}
	return entry.New()
}

func TestTheAudacityRowImportsAppliesTheMacroAndExports(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "source.wav")
	if err := os.WriteFile(source, masteringporttest.ToneWAV(), 0o600); err != nil {
		t.Fatal(err)
	}
	daw := masteringporttest.NewFakeAudacity(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	dest := filepath.Join(project, "Chapter 1 mastered.wav")
	result, err := audacityRow(t).Master(context.Background(), masteringport.Request{
		Source: source, Macro: "Mastering for ACX", Destination: dest, Profile: deliveryprofile.ACX(), Approved: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.Provider != masteringport.Audacity || result.Before != nil || len(result.Chain) == 0 {
		t.Fatalf("result = %+v", result)
	}
	renders := daw.Renders()
	if len(renders) != 1 || renders[0].Source != source || renders[0].Macro != "Mastering for ACX" {
		t.Fatalf("renders = %+v", renders)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(renders[0].Approval) {
		t.Errorf("approval %q is not a 128-bit hex token", renders[0].Approval)
	}
	runFolder := filepath.Dir(renders[0].OutputPath)
	if rel, _ := filepath.Rel(filepath.Join(project, "narration-utils", "mastering"), runFolder); !regexp.MustCompile(`^master-[0-9a-f]{16}$`).MatchString(rel) {
		t.Errorf("run folder %q is not a new folder in the project's mastering folder", runFolder)
	}
	if _, err := os.Stat(runFolder); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the run folder is still there: %v", err)
	}
}

func TestEachAudacityMasterCarriesItsOwnApproval(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "source.wav")
	if err := os.WriteFile(source, masteringporttest.ToneWAV(), 0o600); err != nil {
		t.Fatal(err)
	}
	daw := masteringporttest.NewFakeAudacity(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	for _, name := range []string{"one.wav", "two.wav"} {
		if _, err := audacityRow(t).Master(context.Background(), masteringport.Request{Source: source, Macro: "M", Destination: filepath.Join(project, name),
			Profile: deliveryprofile.ACX(), Approved: true}); err != nil {
			t.Fatal(err)
		}
	}
	renders := daw.Renders()
	if len(renders) != 2 || renders[0].Approval == renders[1].Approval || filepath.Dir(renders[0].OutputPath) == filepath.Dir(renders[1].OutputPath) {
		t.Fatalf("two masters shared an approval or a folder: %+v", renders)
	}
}

func TestTheAudacityRowNeedsADAWASourceAMacroAndItsCapabilities(t *testing.T) {
	project := t.TempDir()
	source := filepath.Join(project, "source.wav")
	if err := os.WriteFile(source, masteringporttest.ToneWAV(), 0o600); err != nil {
		t.Fatal(err)
	}
	request := masteringport.Request{Source: source, Macro: "M", Destination: filepath.Join(project, "out.wav"), Profile: deliveryprofile.ACX(), Approved: true}

	useSession(t, nil)
	if _, err := audacityRow(t).Master(context.Background(), request); !errors.Is(err, masteringport.ErrNoDAW) {
		t.Errorf("with no DAW session: %v, want ErrNoDAW", err)
	}

	daw := masteringporttest.NewFakeAudacity(project)
	useSession(t, func() (masteringport.Session, error) { return daw.Session(), nil })
	noMacro := request
	noMacro.Macro = ""
	if _, err := audacityRow(t).Master(context.Background(), noMacro); !errors.Is(err, masteringport.ErrNoMacro) {
		t.Errorf("with no macro: %v, want ErrNoMacro", err)
	}

	// Experimental capabilities the narrator has not switched on are the DAW port's refusal, with its sentence; nothing renders.
	off := dawport.NewResolver(dawport.ResolverConfig{Adapter: daw,
		Runtime: func() dawport.Runtime { return dawport.Runtime{Bridge: true, Reachable: true} }})
	useSession(t, func() (masteringport.Session, error) {
		return masteringport.Session{Resolver: off, ProjectFolder: project}, nil
	})
	_, err := audacityRow(t).Master(context.Background(), request)
	var refusal *port.NotSupportedError
	if !errors.As(err, &refusal) || refusal.Support.Reason != port.ReasonExperimentalOff {
		t.Errorf("with the capability off: %v, want an experimental_off refusal", err)
	}
	if len(daw.Renders()) != 0 {
		t.Errorf("a refused master rendered: %+v", daw.Renders())
	}
	if _, err := os.Stat(request.Destination); !errors.Is(err, os.ErrNotExist) {
		t.Error("a refused master wrote its destination")
	}
}
