package ttsport_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport/ttsporttest"
)

func TestEveryRegisteredEnginePassesTheSuite(t *testing.T) {
	entries := ttsport.Engines.Entries()
	if len(entries) == 0 {
		t.Fatal("no voice engine is registered")
	}
	for _, entry := range entries {
		t.Run(entry.Name, func(t *testing.T) { ttsporttest.Run(t, entry) })
	}
}

func TestNamesAreTodaysTtsProviderChoices(t *testing.T) {
	// The Piper.tts_provider setting's choices (app.go's settingsSchemas) read this list; it must not change.
	for _, platform := range port.Platforms {
		if got, want := ttsport.Names(platform), []string{"piper"}; !reflect.DeepEqual(got, want) {
			t.Errorf("Names(%q) = %v, want %v", platform, got, want)
		}
	}
}

func TestTheDefaultIsPiper(t *testing.T) {
	// ttsCatalogPayload falls back to it when no scope sets Piper.tts_provider, as config/defaults.json does.
	if got := ttsport.Default(); got != ttsport.Piper {
		t.Fatalf("Default() = %q, want %q", got, ttsport.Piper)
	}
}

func TestPiperVoicesInstallAsTheTtsAssetKind(t *testing.T) {
	// "tts" is assetRegistry's install kind for voices (installjobs.go's installKindTts).
	entry, err := ttsport.Engines.Lookup(ttsport.Piper)
	if err != nil {
		t.Fatal(err)
	}
	if got := entry.New().AssetKind(); got != "tts" {
		t.Fatalf("piper's asset kind = %q, want tts", got)
	}
}

func TestAnUnknownEngineIsRefusedWithANotSupportedError(t *testing.T) {
	_, err := ttsport.Engines.Lookup("coqui")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("Lookup(coqui) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no voice engine called "coqui".`; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
}

func TestANewEngineIsOneRowAndPassesTheSuiteWithNoOtherEdit(t *testing.T) {
	engines := ttsport.NewRegistry()
	engines.Register(port.Entry[ttsport.Engine]{
		Name:       "kokoro",
		Descriptor: port.Descriptor{Label: "Kokoro", Platforms: []string{"linux"}},
		New:        func() ttsport.Engine { return ttsporttest.NewFake("kokoro", "kokoro") },
	})
	for _, entry := range engines.Entries() {
		t.Run(entry.Name, func(t *testing.T) { ttsporttest.Run(t, entry) })
	}
	if got := engines.Names("linux"); !reflect.DeepEqual(got, []string{"piper", "kokoro"}) {
		t.Errorf("names on linux = %v, want piper then kokoro", got)
	}
	if got := engines.Names("windows"); !reflect.DeepEqual(got, []string{"piper"}) {
		t.Errorf("a linux-only row must not be a choice on windows: %v", got)
	}
	if got := ttsport.Engines.Names("linux"); !reflect.DeepEqual(got, []string{"piper"}) {
		t.Errorf("registering on a new registry changed the program's: %v", got)
	}
}
