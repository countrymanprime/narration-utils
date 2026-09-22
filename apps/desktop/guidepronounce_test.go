package main

import (
	"slices"
	"testing"
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
