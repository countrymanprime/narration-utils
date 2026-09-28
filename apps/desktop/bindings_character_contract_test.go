package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/character"
	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// What CharacterListRegions, CharacterApprove/CharacterReferences and GuideDialogueCues send to the UI
// (character-continuity-review.prd.md Phase 6, non-acoustic part only; D87 on #509 benches every acoustic-drift
// binding, so there is no findings or audition contract here).

const contractTwoRegions = `<REAPER_PROJECT 0.1 "7.0" 0
  MARKER 1 1.5 "Alice ref A" 1 0 1 R {AAAAAAAA-0000-0000-0000-000000000001} 0 1
  MARKER 1 3.5 "" 1
  MARKER 2 10 "Narration ref" 1 0 1 R {BBBBBBBB-0000-0000-0000-000000000002} 0 1
  MARKER 2 14 "" 1
>
`

func contractCharacterService(t *testing.T) *character.Service {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(contractTwoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	return character.New(character.Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
}

func TestContractCharacterListRegions(t *testing.T) {
	host := &Host{character: contractCharacterService(t)}
	listed, err := host.CharacterListRegions()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "character-regions", listed)
}

func TestContractCharacterApproveAndReferences(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "project.rpp")
	if err := os.WriteFile(path, []byte(contractTwoRegions), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := character.New(character.Config{Project: dir, ProjectFile: func() (string, error) { return path, nil }})
	host := &Host{character: svc}
	approved, err := host.CharacterApprove("alice", "{AAAAAAAA-0000-0000-0000-000000000001}", "Anchor take, chapter 1.")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "character-approve", approved)
	if _, err := host.CharacterApprove(character.NarrationCharacterID, "{BBBBBBBB-0000-0000-0000-000000000002}", ""); err != nil {
		t.Fatal(err)
	}
	// The saved project is re-saved with the Narration region's name changed, as a narrator renaming a region in
	// REAPER would produce, so the second reference reads "changed since approval" (Q2) in the golden.
	renamed := `<REAPER_PROJECT 0.1 "7.0" 0
  MARKER 1 1.5 "Alice ref A" 1 0 1 R {AAAAAAAA-0000-0000-0000-000000000001} 0 1
  MARKER 1 3.5 "" 1
  MARKER 2 10 "Narration ref (renamed)" 1 0 1 R {BBBBBBBB-0000-0000-0000-000000000002} 0 1
  MARKER 2 14 "" 1
>
`
	if err := os.WriteFile(path, []byte(renamed), 0o600); err != nil {
		t.Fatal(err)
	}
	referenced, err := host.CharacterReferences()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "character-references", referenced)
}

func contractGuideServiceWithDialogueCues(t *testing.T) *guide.Service {
	t.Helper()
	project := t.TempDir()
	svc := guide.New(project, "", "", settings.New(project, project), nil)
	path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	document := map[string]any{
		"schema_version": 2,
		"entities":       []any{},
		"dialogue_cues": []any{
			map[string]any{
				"id": "cue-1", "chapterId": "chapter-1", "paragraphId": "p-3", "quote_start": 0, "quote_end": 8,
				"quote_text": "Oh dear!", "speaker_entity_id": "alice", "speaker_source": "tag",
				"evidence":  map[string]any{"chapterId": "chapter-1", "paragraphId": "p-3", "excerpt": "Oh dear!", "tag": "said Alice"},
				"corrected": false,
			},
			map[string]any{
				"id": "cue-2", "chapterId": "chapter-6", "paragraphId": "p-24", "quote_start": 0, "quote_end": 15,
				"quote_text": "Have some wine.", "speaker_entity_id": nil, "speaker_source": "unknown",
				"evidence":  map[string]any{"chapterId": "chapter-6", "paragraphId": "p-24", "excerpt": "Have some wine.", "tag": ""},
				"corrected": false,
			},
		},
	}
	bytes, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return svc
}

func TestContractGuideDialogueCues(t *testing.T) {
	host := &Host{guide: contractGuideServiceWithDialogueCues(t)}
	cues, err := host.GuideDialogueCues()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "guide-dialogue-cues", cues)
}
