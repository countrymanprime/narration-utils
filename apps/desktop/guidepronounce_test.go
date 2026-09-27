package main

import (
	"errors"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestGuidePronounceSendsTheEntityAndSource(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	if _, err := host.GuidePronounce("entity-1", nil, "cmu"); err != nil {
		t.Fatal(err)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("calls = %d", len(got))
	}
	call := got[0]
	if call[0] != "pronounce" || !slices.Contains(call, "entity-1") || !slices.Contains(call, "cmu") {
		t.Fatalf("call = %v", call)
	}
	if slices.Contains(call, "--alias-index") {
		t.Fatalf("no alias index must be sent for the canonical name: %v", call)
	}
}

func TestGuidePronounceSendsTheAliasIndex(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	aliasIndex := 2
	if _, err := host.GuidePronounce("entity-1", &aliasIndex, "espeak"); err != nil {
		t.Fatal(err)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("calls = %d", len(got))
	}
	if !slices.Contains(got[0], "--alias-index") || !slices.Contains(got[0], "2") {
		t.Fatalf("call = %v", got[0])
	}
}

func TestGuidePronounceIsUnavailableWithoutTheStoryBible(t *testing.T) {
	host := &Host{}
	if _, err := host.GuidePronounce("entity-1", nil, "cmu"); err == nil {
		t.Fatal("expected an error when the Story Bible service is unavailable")
	}
}

func TestGuidePronounceRefusesAnUnregisteredSourceBeforeStartingTheSidecar(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	_, err := host.GuidePronounce("entity-1", nil, "forvo")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("GuidePronounce(forvo) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no pronunciation source called "forvo".`; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
	if got := calls(); len(got) != 0 {
		t.Fatalf("the sidecar must not start for a source the registry refuses: %v", got)
	}
}
