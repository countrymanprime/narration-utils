package guide

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

type heard struct{ logs, notices []string }

func guideFile(t *testing.T, content string) (*Service, *heard, string) {
	t.Helper()
	project := t.TempDir()
	path := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	spoken := &heard{}
	service := New(project, "", "", nil, nil)
	service.SetPersist(&persist.Reporter{
		Log:    func(kind, message string) { spoken.logs = append(spoken.logs, kind+" "+message) },
		Notify: func(text string) { spoken.notices = append(spoken.notices, text) },
	})
	return service, spoken, path
}

func TestAGuideFileFromANewerVersionIsRefusedAndLeftAlone(t *testing.T) {
	service, _, path := guideFile(t, `{"schema_version": 3, "entities": []}`)

	_, err := service.Entities()

	if err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Fatalf("err = %v, want a message that the data is from a newer version", err)
	}
	if matches, _ := filepath.Glob(path + ".corrupt-*"); len(matches) != 0 {
		t.Fatalf("a newer file is not corrupt and must not be moved: %v", matches)
	}
}

func TestAGuideFileFromAnOlderVersionOrWithNoVersionIsRead(t *testing.T) {
	for _, content := range []string{`{"schema_version": 1, "entities": []}`, `{"entities": []}`, `{"schema_version": 2, "entities": []}`} {
		service, _, _ := guideFile(t, content)
		if entities, err := service.Entities(); err != nil || len(entities) != 0 {
			t.Fatalf("%s: entities %v, err %v", content, entities, err)
		}
	}
}

func TestACorruptGuideFileIsKeptAsideToldAndTheStoryBibleStartsEmpty(t *testing.T) {
	service, spoken, path := guideFile(t, `{"entities": [ {"canonical_name": "SECRET NAME"`)

	entities, err := service.Entities()

	if err != nil || len(entities) != 0 {
		t.Fatalf("entities %v, err %v: a corrupt file starts an empty Story Bible", entities, err)
	}
	matches, _ := filepath.Glob(path + ".corrupt-*")
	if len(matches) != 1 {
		t.Fatalf("kept copies = %v", matches)
	}
	if len(spoken.notices) != 1 || !strings.Contains(spoken.notices[0], "Story Bible") || strings.Contains(strings.Join(spoken.logs, " "), "SECRET") {
		t.Fatalf("notices %v, logs %v", spoken.notices, spoken.logs)
	}
}

func TestAGuideFileThatCannotBeReadIsAnErrorNotAnEmptyStoryBible(t *testing.T) {
	service, _, path := guideFile(t, `{}`)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Entities(); err == nil || !strings.Contains(err.Error(), "could not be read") {
		t.Fatalf("err = %v", err)
	}
}
