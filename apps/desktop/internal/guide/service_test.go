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
