package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// A project's own settings file must not decide how the app updates: a project the narrator opens, or is sent, could otherwise
// switch their update check off or change their channel.
func TestAProjectSettingsFileCannotChangeHowTheAppUpdates(t *testing.T) {
	host := updateHost(t, newFakeReleaseServer(t), "0.2.6")
	project := t.TempDir()
	if err := os.MkdirAll(filepath.Join(project, "narration-utils"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "narration-utils", "settings.json"), []byte(`{"Updates":{"check_on_startup":"false","channel":"stable"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	host.mu.Lock()
	host.configureLocked(config{repoRoot: host.config.repoRoot, projectFolder: project})
	host.mu.Unlock()
	if enabled, channel := host.updateSettings(); !enabled || channel != update.ChannelCandidates {
		t.Fatalf("a project file changed the update settings: %v, %q", enabled, channel)
	}
}

func TestAnExplicitCheckOnAPlatformWithNoReleaseIsAStatusAndNotALoggedFailure(t *testing.T) {
	host := updateHost(t, newFakeReleaseServer(t), "0.2.6")
	host.updates.Platform = update.Platform{}
	if enabled, _ := host.updateSettings(); !enabled || host.updates.Due(true, host.updates.Clock()) {
		t.Fatal("the automatic check never runs where there is no release")
	}
	if _, err := host.UpdateCheck(); err != nil {
		t.Fatal(err)
	}
}
