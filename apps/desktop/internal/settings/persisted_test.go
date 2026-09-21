package settings

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

type heard struct {
	logs, notices []string
}

func storeWithReporter(t *testing.T) (*Store, *heard, string) {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	spoken := &heard{}
	store := New(t.TempDir(), "")
	store.SetPersist(&persist.Reporter{
		Log:    func(kind, message string) { spoken.logs = append(spoken.logs, kind+" "+message) },
		Notify: func(text string) { spoken.notices = append(spoken.notices, text) },
	})
	return store, spoken, filepath.Join(appData, "narration-utils", "global-settings.json")
}

func writeSettings(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func keptCopies(t *testing.T, path string) []string {
	t.Helper()
	matches, err := filepath.Glob(path + ".corrupt-*")
	if err != nil {
		t.Fatal(err)
	}
	return matches
}

func TestACorruptGlobalSettingsFileIsKeptToldAndNeverOverwrittenSilently(t *testing.T) {
	store, spoken, path := storeWithReporter(t)
	writeSettings(t, path, `{"General": {"log_verbosity": "verbose"`)

	if got := store.Global("General"); len(got) != 0 {
		t.Fatalf("Global = %v, want empty for a file that cannot be read", got)
	}
	if kept := keptCopies(t, path); len(kept) != 1 {
		t.Fatalf("kept copies = %v, want the corrupt file kept beside the original", kept)
	}
	if len(spoken.notices) != 1 || !strings.Contains(spoken.notices[0], "settings") {
		t.Fatalf("notices = %v, want one that names the settings", spoken.notices)
	}

	value := "quiet"
	if err := store.Save("General", "global", map[string]*string{"log_verbosity": &value}); err != nil {
		t.Fatal(err)
	}
	if got := store.Global("General")["log_verbosity"]; got != "quiet" {
		t.Fatalf("after Save, log_verbosity = %q", got)
	}
	if kept := keptCopies(t, path); len(kept) != 1 {
		t.Fatalf("saving over a fresh file must not touch the kept copy: %v", kept)
	}
}

func TestACorruptSettingsFileIsKeptEvenWhenSaveIsTheFirstThingToReadIt(t *testing.T) {
	store, _, path := storeWithReporter(t)
	writeSettings(t, path, `not json`)
	value := "verbose"
	if err := store.Save("General", "global", map[string]*string{"log_verbosity": &value}); err != nil {
		t.Fatal(err)
	}
	if kept := keptCopies(t, path); len(kept) != 1 {
		t.Fatalf("Save read a corrupt file and replaced it without keeping it: %v", kept)
	}
}

func TestASettingStoredAsABooleanOrANumberIsReadAsItsText(t *testing.T) {
	store, spoken, path := storeWithReporter(t)
	writeSettings(t, path, `{"General": {"notify": true, "paused": false, "workers": 3, "ratio": 0.5, "log_verbosity": "verbose"}}`)

	got := store.Global("General")

	want := Values{"notify": "true", "paused": "false", "workers": "3", "ratio": "0.5", "log_verbosity": "verbose"}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("%s = %q, want %q (all: %v)", key, got[key], value, got)
		}
	}
	if len(spoken.logs) != 0 {
		t.Fatalf("a boolean or a number is a value, not a problem: %v", spoken.logs)
	}
}

func TestASettingThatIsAnObjectOrAListIsIgnoredAndLoggedByKeyOnly(t *testing.T) {
	store, spoken, path := storeWithReporter(t)
	writeSettings(t, path, `{"General": {"a": {"x": "SECRET"}, "b": [1], "c": null, "log_verbosity": "verbose"}}`)

	got := store.Global("General")

	if got["log_verbosity"] != "verbose" || len(got) != 1 {
		t.Fatalf("Global = %v, want only the text setting", got)
	}
	logged := strings.Join(spoken.logs, "\n")
	if !strings.Contains(logged, "settings_value_ignored") || !strings.Contains(logged, "a, b") || strings.Contains(logged, "SECRET") {
		t.Fatalf("logs = %q, want the keys of the ignored values and none of their content", logged)
	}
	// A null is the explicit global reset that Save writes, so it is not a problem worth a log line.
	if strings.Contains(logged, "a, b, c") {
		t.Fatalf("a null setting is a reset, not a problem: %q", logged)
	}
}

func TestAStoreWithoutAReporterStillKeepsACorruptFile(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	t.Setenv("USERPROFILE", appData)
	path := filepath.Join(appData, "narration-utils", "global-settings.json")
	writeSettings(t, path, `{`)
	_ = New(t.TempDir(), "").Global("General")
	if kept := keptCopies(t, path); len(kept) != 1 {
		t.Fatalf("kept copies = %v", kept)
	}
}

func TestSaveRefusesToReplaceASettingsFileItCannotRead(t *testing.T) {
	store, _, path := storeWithReporter(t)
	// A directory where the file should be: it exists, and reading it fails.
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	value := "quiet"
	err := store.Save("General", "global", map[string]*string{"log_verbosity": &value})
	if err == nil || !strings.Contains(err.Error(), "nothing was saved") {
		t.Fatalf("err = %v, want a refusal", err)
	}
}
