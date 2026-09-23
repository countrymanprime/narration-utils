package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawadapter"
)

// The audacity-integration PRD's Phase 5: `--daw Audacity` reaches the host the way the REAPER launcher's `--daw REAPER` does,
// the layered settings store serves an Audacity project with no code of its own, and the review workflow refuses clearly until
// the Audacity pipe client exists (Phase 4).

// audacityProject is a project folder shaped like an Audacity one: an .aup3 and no .rpp, with a manuscript imported.
func audacityProject(t *testing.T) string {
	t.Helper()
	project := t.TempDir()
	writeNested(t, filepath.Join(project, "Book.aup3"), "not a real Audacity project")
	writeNested(t, filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), `{}`)
	return project
}

func writeNested(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestParseConfigArgsAcceptsDawAudacity(t *testing.T) {
	config := parseConfigArgs(`C:\repo`, []string{"--project-folder", `C:\books\novel`, "--project-name", "Novel", "--daw", "Audacity"})
	if config.daw != "Audacity" || config.projectFolder != `C:\books\novel` || config.projectName != "Novel" {
		t.Fatalf("config = %#v", config)
	}
}

// The smoke test the PRD's Decisions Log asks for: all three tiers resolve for an Audacity project, and a project override
// saves into the project's own sidecar, with nothing that assumes a REAPER project.
func TestAnAudacityLaunchResolvesEveryTierOfTheLayeredSettings(t *testing.T) {
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	project := audacityProject(t)
	writeNested(t, filepath.Join(appData, "narration-utils", "global-settings.json"), `{"TranscriptCompare": {"model_size": "medium"}}`)
	writeNested(t, filepath.Join(project, "narration-utils", "settings.json"), `{"TranscriptCompare": {"color_misread": "112233"}}`)

	host := NewHost()
	host.configureLocked(parseConfigArgs(host.config.repoRoot, []string{"--project-folder", project, "--project-name", "Book", "--daw", "Audacity"}))

	for key, want := range map[string][2]string{
		"color_misread": {"112233", "project"},
		"model_size":    {"medium", "global"},
		"chunk_seconds": {"60", "repo_default"},
	} {
		value, source := host.settings.Effective("TranscriptCompare", key, "")
		if value != want[0] || source != want[1] {
			t.Errorf("Effective(TranscriptCompare, %s) = (%q, %q), want (%q, %q)", key, value, source, want[0], want[1])
		}
	}
	colour := "445566"
	if err := host.settings.Save("TranscriptCompare", "project", map[string]*string{"color_skipped": &colour}); err != nil {
		t.Fatalf("saving a project override for an Audacity project: %v", err)
	}
	if value, source := host.settings.Effective("TranscriptCompare", "color_skipped", ""); value != colour || source != "project" {
		t.Fatalf("after save = (%q, %q), want (%q, project)", value, source, colour)
	}
	if boot := host.Bootstrap(); boot["daw"] != "Audacity" || boot["projectFolder"] != project {
		t.Fatalf("Bootstrap daw/projectFolder = %v/%v", boot["daw"], boot["projectFolder"])
	}
}

// A session directory on an Audacity launch is not REAPER's to open: nothing may write bridge commands for it, and the review
// workflow fails the run with the "not available yet" sentence instead of hanging on a DAW that will never answer.
func TestAnAudacityLaunchOpensNoReaperBridgeAndItsReviewFailsClearly(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	project, session := audacityProject(t), t.TempDir()
	host := NewHost()
	host.configureLocked(parseConfigArgs(host.config.repoRoot, []string{"--project-folder", project, "--session-dir", session, "--daw", "Audacity"}))

	if host.bridge != nil {
		t.Fatal("an Audacity launch must not open the REAPER bridge")
	}
	err := host.transcript.Start(map[string]string{})
	if !errors.Is(err, dawadapter.ErrAudacityNotAvailable) {
		t.Fatalf("Start() = %v, want ErrAudacityNotAvailable", err)
	}
	if state := host.transcript.Snapshot(); state["phase"] != "error" || !strings.HasPrefix(state["message"].(string), "Audacity support is not available yet.") {
		t.Fatalf("state = %v / %v", state["phase"], state["message"])
	}
	if entries, _ := os.ReadDir(filepath.Join(session, "commands")); len(entries) != 0 {
		t.Fatalf("an Audacity launch wrote %d REAPER bridge command(s)", len(entries))
	}
}

// Only a REAPER launch with no project folder gets the "this REAPER project..." reason; an Audacity one lands on the picker
// like a standalone launch rather than being told about a REAPER project it does not have.
func TestOnlyAReaperLaunchExplainsAMissingProjectFolder(t *testing.T) {
	if reason, ok := unresolvedLaunchReason(config{daw: "REAPER"}); !ok || !strings.Contains(reason, "REAPER project") {
		t.Fatalf("REAPER = (%q, %v)", reason, ok)
	}
	for _, daw := range []string{"Audacity", "", "Standalone"} {
		if reason, ok := unresolvedLaunchReason(config{daw: daw}); ok {
			t.Errorf("daw %q: reason %q, want none", daw, reason)
		}
	}
	if _, ok := unresolvedLaunchReason(config{daw: "REAPER", projectFolder: `C:\books\novel`}); ok {
		t.Fatal("a resolved REAPER launch has nothing to explain")
	}
}

// The installer's "Narration Utils for Audacity" shortcut starts the app with `--daw Audacity` and no project folder (audacity-integration
// PRD Phase 10), so the narrator picks the project in the app. The picker's switch keeps the launch an Audacity one; any other launch,
// a REAPER one included, becomes "Standalone" as before, because the project the narrator picked is not the one REAPER has open.
func TestAPickerSwitchKeepsAnAudacityLaunchAnAudacityOne(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	for _, tc := range []struct{ launch, want string }{
		{"Audacity", "Audacity"},
		{"audacity", "audacity"},
		{"REAPER", "Standalone"},
		{"", "Standalone"},
		{"Standalone", "Standalone"},
	} {
		host := NewHost()
		host.configureLocked(parseConfigArgs(host.config.repoRoot, []string{"--daw", tc.launch}))
		project := audacityProject(t)
		raw, err := host.ProjectSwitch(project, "Book")
		if err != nil || !strings.Contains(raw, `"switched":true`) {
			t.Fatalf("launch %q: ProjectSwitch = %s, %v", tc.launch, raw, err)
		}
		if boot := host.Bootstrap(); boot["daw"] != tc.want || boot["projectFolder"] != project {
			t.Errorf("launch %q: Bootstrap daw/projectFolder = %v/%v, want %q/%q", tc.launch, boot["daw"], boot["projectFolder"], tc.want, project)
		}
	}
}

// After the switch the review workflow still answers as the Audacity adapter, never through REAPER's bridge.
func TestAnAudacityLaunchPickedInTheAppStillRefusesReviewClearly(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	host := NewHost()
	host.configureLocked(parseConfigArgs(host.config.repoRoot, []string{"--daw", "Audacity"}))
	if _, err := host.ProjectSwitch(audacityProject(t), "Book"); err != nil {
		t.Fatal(err)
	}
	if host.bridge != nil {
		t.Fatal("an Audacity launch must not open the REAPER bridge after a picker switch")
	}
	if err := host.transcript.Start(map[string]string{}); !errors.Is(err, dawadapter.ErrAudacityNotAvailable) {
		t.Fatalf("Start() = %v, want ErrAudacityNotAvailable", err)
	}
}
