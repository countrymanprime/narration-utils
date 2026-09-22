package main

import (
	"strings"
	"testing"
)

// The spaCy model choice comes from the approved catalog, not from a list in the host: every approved model can be selected before it is
// installed (selecting never downloads), and nothing else can be selected.
func TestTheLanguageModelChoiceIsTheApprovedCatalogWhetherOrNotAModelIsInstalled(t *testing.T) {
	f := newSpacyFixture(t)
	schemas, err := f.host.settingsForScope("global")
	if err != nil {
		t.Fatal(err)
	}
	fields, _ := schemas["ManuscriptGuide"].([]map[string]any)
	if len(fields) != 1 {
		t.Fatalf("ManuscriptGuide fields = %v", schemas["ManuscriptGuide"])
	}
	choices, _ := fields[0]["choices"].([]string)
	if len(choices) != 1 || choices[0] != "en_core_web_sm" {
		t.Fatalf("choices = %v, want the catalog model even though it is not installed", choices)
	}
	value := "en_core_web_sm"
	if err := f.host.saveSettings("ManuscriptGuide", "global", map[string]*string{"spacy_model": &value}); err != nil {
		t.Fatalf("selecting an approved model that is not installed must work: %v", err)
	}
	if f.manager.State(mustModel(t, f.manager)) != "not_installed" {
		t.Fatal("selecting a model must never download it")
	}
	other := "en_core_web_lg"
	if err := f.host.saveSettings("ManuscriptGuide", "global", map[string]*string{"spacy_model": &other}); err == nil || !strings.Contains(err.Error(), "unsupported value") {
		t.Fatalf("a model that is not in the catalog must be refused: %v", err)
	}
}
