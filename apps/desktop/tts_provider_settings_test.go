package main

import (
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
)

// The Piper.tts_provider choices are the TTS registry's engines for the host's platform (provider-ports P9), which today is the
// one choice the setting has always offered.
func TestTtsProviderChoicesComeFromTheTtsRegistry(t *testing.T) {
	for _, platform := range port.Platforms {
		host := &Host{platform: platform}
		var got []string
		found := false
		for _, field := range host.settingsSchemas()["Piper"] {
			if field.key == "tts_provider" {
				got, found = field.choices, true
			}
		}
		if !found {
			t.Fatalf("%s: no Piper.tts_provider field", platform)
		}
		if want := ttsport.Names(platform); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: tts_provider choices = %v, want the registry's %v", platform, got, want)
		}
		if !reflect.DeepEqual(got, []string{"piper"}) {
			t.Errorf("%s: tts_provider choices = %v, want today's [piper]", platform, got)
		}
	}
}
