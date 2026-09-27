package main

import (
	"slices"
	"strings"
	"testing"
)

// Prep-depth phase 1: the narrator's own pronunciation, switching to the kept alternate, and a pronunciation's status and note. Each
// is one sidecar call; free text goes as --ipa=VALUE / --note=VALUE so a value starting with "-" stays a value.

func TestGuidePronounceUserSendsTheTextAsOneArgument(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	aliasIndex := 1
	if _, err := host.GuidePronounceUser("entity-1", &aliasIndex, "-wɹɛn"); err != nil {
		t.Fatal(err)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("calls = %d", len(got))
	}
	call := got[0]
	if call[0] != "pronounce-user" || !slices.Contains(call, "entity-1") || !slices.Contains(call, "--ipa=-wɹɛn") || !slices.Contains(call, "1") {
		t.Fatalf("call = %v", call)
	}
}

func TestGuidePronounceUserRefusesBlankMultiLineAndOverlongTextBeforeStartingTheSidecar(t *testing.T) {
	for _, bad := range []string{"  ", "one\ntwo", strings.Repeat("x", 201)} {
		service, calls := countingGuide(t)
		host := &Host{guide: service}
		if _, err := host.GuidePronounceUser("entity-1", nil, bad); err == nil {
			t.Fatalf("GuidePronounceUser(%q) accepted", bad[:2])
		}
		if len(calls()) != 0 {
			t.Fatal("the sidecar started")
		}
	}
}

func TestGuidePronunciationUseAlternateSendsTheEntity(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	if _, err := host.GuidePronunciationUseAlternate("entity-1", nil); err != nil {
		t.Fatal(err)
	}
	call := calls()[0]
	if call[0] != "pronunciation-use-alternate" || !slices.Contains(call, "entity-1") || slices.Contains(call, "--alias-index") {
		t.Fatalf("call = %v", call)
	}
}

func TestGuidePronunciationSetStatusSendsTheStatusAndNote(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	note := "-asked by email"
	if _, err := host.GuidePronunciationSetStatus("entity-1", nil, "query_sent", &note); err != nil {
		t.Fatal(err)
	}
	call := calls()[0]
	if call[0] != "pronunciation-status" || !slices.Contains(call, "query_sent") || !slices.Contains(call, "--note=-asked by email") {
		t.Fatalf("call = %v", call)
	}
}

func TestGuidePronunciationSetStatusWithoutANoteLeavesItAlone(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	if _, err := host.GuidePronunciationSetStatus("entity-1", nil, "author_confirmed", nil); err != nil {
		t.Fatal(err)
	}
	for _, arg := range calls()[0] {
		if strings.HasPrefix(arg, "--note") {
			t.Fatalf("a note was sent: %v", arg)
		}
	}
}

func TestGuidePronunciationSetStatusRefusesAnUnknownStatusOrOverlongNote(t *testing.T) {
	long := strings.Repeat("x", 1001)
	for _, c := range []struct {
		status string
		note   *string
	}{{"guessed", nil}, {"researched", &long}} {
		service, calls := countingGuide(t)
		host := &Host{guide: service}
		if _, err := host.GuidePronunciationSetStatus("entity-1", nil, c.status, c.note); err == nil {
			t.Fatalf("status %q accepted", c.status)
		}
		if len(calls()) != 0 {
			t.Fatal("the sidecar started")
		}
	}
}

func TestPronunciationDepthBindingsAreUnavailableWithoutTheStoryBible(t *testing.T) {
	host := &Host{}
	if _, err := host.GuidePronounceUser("entity-1", nil, "x"); err == nil {
		t.Fatal("GuidePronounceUser: expected an error")
	}
	if _, err := host.GuidePronunciationUseAlternate("entity-1", nil); err == nil {
		t.Fatal("GuidePronunciationUseAlternate: expected an error")
	}
	if _, err := host.GuidePronunciationSetStatus("entity-1", nil, "researched", nil); err == nil {
		t.Fatal("GuidePronunciationSetStatus: expected an error")
	}
}
