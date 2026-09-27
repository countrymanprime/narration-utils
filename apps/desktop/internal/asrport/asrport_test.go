package asrport_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	"github.com/countrymanprime/narration-utils/shell/internal/asrport/asrporttest"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestEveryRegisteredEnginePassesTheSuite(t *testing.T) {
	entries := asrport.Engines.Entries()
	if len(entries) == 0 {
		t.Fatal("no speech engine is registered")
	}
	for _, entry := range entries {
		t.Run(entry.Name, func(t *testing.T) { asrporttest.Run(t, entry) })
	}
}

func TestLiveNamesAreTodaysTeleprompterEngines(t *testing.T) {
	// The Teleprompter.engine setting's choices (app.go) and the start check (bindings.go) read these lists; they must not change.
	for platform, want := range map[string][]string{
		"windows": {"whisper", "moonshine"},
		"darwin":  {"whisper"},
		"linux":   {"whisper"},
	} {
		if got := asrport.Names(platform, asrport.ModeLive); !reflect.DeepEqual(got, want) {
			t.Errorf("Names(%q, live) = %v, want %v", platform, got, want)
		}
		if got := asrport.Engines.Names(platform); !reflect.DeepEqual(got, want) {
			t.Errorf("Engines.Names(%q) = %v, want %v", platform, got, want)
		}
	}
}

func TestBatchNamesAreWhisperEverywhere(t *testing.T) {
	for _, platform := range port.Platforms {
		if got, want := asrport.Names(platform, asrport.ModeBatch), []string{"whisper"}; !reflect.DeepEqual(got, want) {
			t.Errorf("Names(%q, batch) = %v, want %v", platform, got, want)
		}
	}
}

func TestRowsCarryTheirAssetKinds(t *testing.T) {
	// The asset kinds are assetRegistry's install kinds (installjobs.go), which the models come from.
	for name, want := range map[string]string{asrport.Whisper: "whisper", asrport.Moonshine: "moonshine"} {
		entry, err := asrport.Engines.Lookup(name)
		if err != nil {
			t.Fatalf("Lookup(%q): %v", name, err)
		}
		if got := entry.New().AssetKind(); got != want {
			t.Errorf("%s's asset kind = %q, want %q", name, got, want)
		}
	}
}

func TestAnUnknownEngineIsRefusedWithANotSupportedError(t *testing.T) {
	_, err := asrport.Engines.Lookup("vosk")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("Lookup(vosk) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no speech engine called "vosk".`; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
}

func TestANewEngineIsOneRowAndPassesTheSuiteWithNoOtherEdit(t *testing.T) {
	engines := asrport.NewRegistry()
	engines.Register(port.Entry[asrport.Engine]{
		Name:       "parakeet",
		Descriptor: port.Descriptor{Label: "Parakeet", Platforms: []string{"linux"}, Modes: []string{asrport.ModeBatch}},
		New:        func() asrport.Engine { return asrporttest.NewFake("parakeet", "parakeet") },
	})
	for _, entry := range engines.Entries() {
		t.Run(entry.Name, func(t *testing.T) { asrporttest.Run(t, entry) })
	}
	if got := asrport.NamesIn(engines, "linux", asrport.ModeLive); !reflect.DeepEqual(got, []string{"whisper"}) {
		t.Errorf("a batch-only row must not become a live choice: live names on linux = %v", got)
	}
	if got := asrport.NamesIn(engines, "linux", asrport.ModeBatch); !reflect.DeepEqual(got, []string{"whisper", "parakeet"}) {
		t.Errorf("batch names on linux = %v, want whisper then parakeet", got)
	}
	if got := asrport.Engines.Names("linux"); !reflect.DeepEqual(got, []string{"whisper"}) {
		t.Errorf("registering on a new registry changed the program's: %v", got)
	}
}
