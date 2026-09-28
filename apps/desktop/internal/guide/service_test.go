package guide

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func TestEntitiesToleratesMissingGuide(t *testing.T) {
	s := New(t.TempDir(), "", "", settings.New(t.TempDir(), ""), process.NewSupervisor())
	entities, err := s.Entities()
	if err != nil || len(entities) != 0 {
		t.Fatal("missing guide must be empty")
	}
	if got := s.guidePath(); filepath.Base(got) != "manuscript_guide.json" {
		t.Fatal(got)
	}
}

func TestVocabularyCandidatesFallBackToReviewedEntitiesForOlderGuides(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	older := `{"entities":[{"canonical_name":"Dawnspire","category":"Place","aliases":[{"text":"the Spire"}]},{"canonical_name":"Abandoned","category":"Needs Review"}]}`
	if err := os.WriteFile(s.guidePath(), []byte(older), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := s.VocabularyCandidates()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"Dawnspire", "the Spire"}; !slices.Equal(got, want) {
		t.Fatalf("candidates = %#v, want %#v", got, want)
	}
}

func TestEntitiesFillsMissingPronunciationAndDescription(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := `{"entities":[{"id":"one","aliases":[{"text":"Al"}]}]}`
	if err := os.WriteFile(s.guidePath(), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	entities, err := s.Entities()
	if err != nil || len(entities) != 1 {
		t.Fatalf("entities = %#v, %v", entities, err)
	}
	entity := entities[0]
	if _, ok := entity["pronunciation"].(map[string]any); !ok {
		t.Fatalf("pronunciation missing: %#v", entity)
	}
	description, ok := entity["description"].(map[string]any)
	if !ok || description["text"] != "" {
		t.Fatalf("description missing: %#v", entity["description"])
	}
	alias := entity["aliases"].([]any)[0].(map[string]any)
	if _, ok := alias["pronunciation"].(map[string]any); !ok {
		t.Fatalf("alias pronunciation missing: %#v", alias)
	}
}

func TestEntitiesNormalizesNullCollectionsAndRejectsMalformedGuide(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	valid := `{"entities":[{"id":"one","aliases":null,"occurrences":null,"personality_notes":null,"relationships":null}]}`
	if err := os.WriteFile(s.guidePath(), []byte(valid), 0o600); err != nil {
		t.Fatal(err)
	}
	entities, err := s.Entities()
	if err != nil || len(entities) != 1 {
		t.Fatalf("entities = %#v, %v", entities, err)
	}
	if aliases, ok := entities[0]["aliases"].([]any); !ok || len(aliases) != 0 {
		t.Fatalf("aliases were not normalized: %#v", entities[0])
	}
	if err := os.WriteFile(s.guidePath(), []byte(`{"entities":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Entities(); err == nil {
		t.Fatal("malformed guide entities must return an error")
	}
}

func TestDialogueCuesToleratesMissingGuideAndMissingKey(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if cues, err := s.DialogueCues(); err != nil || len(cues) != 0 {
		t.Fatalf("missing guide must be empty: %#v, %v", cues, err)
	}
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	// A guide written before Phase 2 has entities but no dialogue_cues key at all.
	if err := os.WriteFile(s.guidePath(), []byte(`{"entities":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if cues, err := s.DialogueCues(); err != nil || len(cues) != 0 {
		t.Fatalf("a guide with no dialogue_cues key must be empty: %#v, %v", cues, err)
	}
}

func TestDialogueCuesReadsTheDocumentLevelList(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	document := `{"entities":[],"dialogue_cues":[{"id":"cue-1","chapterId":"ch1","paragraphId":"p1","quote_start":0,"quote_end":5,` +
		`"quote_text":"Hallo","speaker_entity_id":"alice","speaker_source":"tag",` +
		`"evidence":{"chapterId":"ch1","paragraphId":"p1","excerpt":"Hallo","tag":"said Alice"},"corrected":false}]}`
	if err := os.WriteFile(s.guidePath(), []byte(document), 0o600); err != nil {
		t.Fatal(err)
	}
	cues, err := s.DialogueCues()
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 1 || cues[0].ID != "cue-1" || cues[0].SpeakerEntityID == nil || *cues[0].SpeakerEntityID != "alice" {
		t.Fatalf("cues = %#v", cues)
	}
}

func TestDialogueCuesRejectsMalformedShape(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := os.MkdirAll(filepath.Dir(s.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.guidePath(), []byte(`{"dialogue_cues":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DialogueCues(); err == nil {
		t.Fatal("malformed dialogue_cues must return an error")
	}
}

func TestCorrectCueFailsCleanlyWithNoConfiguredSidecar(t *testing.T) {
	root := t.TempDir()
	s := New(root, "", "", settings.New(root, root), process.NewSupervisor())
	if err := s.CorrectCue("cue-1", "alice"); err == nil {
		t.Fatal("want an error with no configured sidecar")
	}
}

func TestCommandUsesFrozenSidecarDirectlyWithoutBackendScript(t *testing.T) {
	root := t.TempDir()
	program := filepath.Join(root, "manuscript-guide")
	if runtime.GOOS == "windows" {
		program += ".exe"
	}
	if err := os.WriteFile(program, nil, 0o700); err != nil {
		t.Fatal(err)
	}
	s := New(root, program, "", settings.New(root, root), process.NewSupervisor())
	actualProgram, args, err := s.command([]string{"build", "--out", "guide.json"})
	if err != nil {
		t.Fatal(err)
	}
	if actualProgram != program {
		t.Fatalf("program = %q, want %q", actualProgram, program)
	}
	if got, want := args, []string{"build", "--out", "guide.json"}; !slices.Equal(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestAliasAndCreateOperationsUseCanonicalManuscriptWithoutLegacyESpeakPath(t *testing.T) {
	root := t.TempDir()
	store := settings.New(root, root)
	s := New(root, "unused", "", store, process.NewSupervisor())
	alias := s.editArgs("entity-1", map[string]string{"aliases": "A. Name"})
	if !slices.Contains(alias, "--manuscript") || !slices.Contains(alias, filepath.Join(root, "narration-utils", "manuscript", "manuscript.json")) || slices.Contains(alias, "--espeak-library") {
		t.Fatalf("alias arguments must use canonical context only: %#v", alias)
	}
	create := s.createArgs("Name", "Character", []string{"A. Name"}, "", nil)
	if slices.Contains(create, "--espeak-library") {
		t.Fatalf("create arguments must not include an eSpeak path: %#v", create)
	}
}

// story-bible-and-import-ux-briefs PRD phase 11 (the settings default): --default-source is left off build, an alias
// edit and create entirely while the narrator has not set a preference, so every project's command line is unchanged
// from before this setting existed; once set, it reaches all three, but never a field edit that does not touch aliases.
func TestDefaultPronunciationSourceIsOmittedWhenUnset(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", filepath.Join(root, "appdata")) // sandbox global scope away from the real machine (store_test.go's own pattern)
	s := New(root, "unused", "", settings.New(root, root), process.NewSupervisor())
	if got := s.buildArgs("progress.txt", "log.txt", "en_core_web_sm"); slices.Contains(got, "--default-source") {
		t.Fatalf("build arguments must not include --default-source when unset: %#v", got)
	}
	if got := s.editArgs("entity-1", map[string]string{"aliases": "A. Name"}); slices.Contains(got, "--default-source") {
		t.Fatalf("alias edit arguments must not include --default-source when unset: %#v", got)
	}
	if got := s.createArgs("Name", "Character", []string{"A. Name"}, "", nil); slices.Contains(got, "--default-source") {
		t.Fatalf("create arguments must not include --default-source when unset: %#v", got)
	}
}

func TestDefaultPronunciationSourceReachesBuildAliasEditAndCreate(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", filepath.Join(root, "appdata")) // sandbox global scope away from the real machine (store_test.go's own pattern)
	store := settings.New(root, root)
	value := "espeak"
	if err := store.Save("ManuscriptGuide", "global", map[string]*string{"default_pronunciation_source": &value}); err != nil {
		t.Fatal(err)
	}
	s := New(root, "unused", "", store, process.NewSupervisor())
	if got := s.buildArgs("progress.txt", "log.txt", "en_core_web_sm"); !slices.Contains(got, "--default-source") || !slices.Contains(got, "espeak") {
		t.Fatalf("build arguments must carry the narrator's default source: %#v", got)
	}
	if got := s.editArgs("entity-1", map[string]string{"aliases": "A. Name"}); !slices.Contains(got, "--default-source") || !slices.Contains(got, "espeak") {
		t.Fatalf("alias edit arguments must carry the narrator's default source: %#v", got)
	}
	if got := s.createArgs("Name", "Character", []string{"A. Name"}, "", nil); !slices.Contains(got, "--default-source") || !slices.Contains(got, "espeak") {
		t.Fatalf("create arguments must carry the narrator's default source: %#v", got)
	}
	if got := s.editArgs("entity-1", map[string]string{"description": "New."}); slices.Contains(got, "--default-source") {
		t.Fatalf("a field edit that is not aliases must not include --default-source: %#v", got)
	}
}
