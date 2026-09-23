package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

func linkedProject(t *testing.T) (folder, rpp string) {
	t.Helper()
	folder = t.TempDir()
	rpp = filepath.Join(folder, "Book.rpp")
	writeFile(t, rpp, "x")
	link, err := project.BuildDawLink(folder, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Book", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(folder); err != nil {
		t.Fatal(err)
	}
	return folder, rpp
}

func TestLaunchReaperRefusesWithNoProjectOpen(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	svc := hostServices{settings: settings.New("", "")}
	if _, err := launchReaper(svc, nil, nil, nil); err == nil {
		t.Fatal("want an error with no project folder")
	}
}

func TestLaunchReaperRefusesWithNoLinkedFile(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder := t.TempDir()
	svc := hostServices{config: config{projectFolder: folder}, settings: settings.New("", folder)}
	if _, err := launchReaper(svc, nil, nil, nil); err == nil {
		t.Fatal("want an error with no linked DAW project file")
	}
}

func TestLaunchReaperRefusesWhenTheLinkedFileNoLongerExists(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, rpp := linkedProject(t)
	if err := os.Remove(rpp); err != nil {
		t.Fatal(err)
	}
	svc := hostServices{config: config{projectFolder: folder}, settings: settings.New("", folder)}
	if _, err := launchReaper(svc, nil, nil, nil); err == nil {
		t.Fatal("want an error when the linked file no longer resolves")
	}
}

func TestLaunchReaperRefusesWhenReaperCannotBeLocated(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, _ := linkedProject(t)
	svc := hostServices{config: config{projectFolder: folder}, settings: settings.New("", folder)}
	locate := func() (string, string, error) { return "", "", fmt.Errorf("not found") }
	if _, err := launchReaper(svc, nil, locate, nil); err == nil {
		t.Fatal("want an error when reaper.exe cannot be located")
	}
}

// TestLaunchReaperPassesTheLinkedFileAndNotTheLauncherByDefault is D10: auto-starting the launcher script defaults
// off, so only the linked .rpp is passed unless the narrator turned the setting on.
func TestLaunchReaperPassesTheLinkedFileAndNotTheLauncherByDefault(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, rpp := linkedProject(t)
	svc := hostServices{config: config{projectFolder: folder, reaperLauncher: "C:/app/NarrationUtils_Launcher.lua"}, settings: settings.New("", folder)}
	locate := func() (string, string, error) { return "C:/REAPER/reaper.exe", "uninstall_registry", nil }
	var gotProgram string
	var gotArgs []string
	launch := func(program string, args []string) error {
		gotProgram, gotArgs = program, args
		return nil
	}
	result, err := launchReaper(svc, nil, locate, launch)
	if err != nil {
		t.Fatal(err)
	}
	if result["launched"] != true || result["path"] != "C:/REAPER/reaper.exe" || result["source"] != "uninstall_registry" {
		t.Fatalf("result = %#v", result)
	}
	if gotProgram != "C:/REAPER/reaper.exe" {
		t.Fatalf("program = %q", gotProgram)
	}
	if len(gotArgs) != 1 || gotArgs[0] != rpp {
		t.Fatalf("args = %v, want only the linked .rpp (auto_start_launcher defaults off)", gotArgs)
	}
}

// TestLaunchReaperPassesTheLauncherScriptWhenAutoStartIsOn is D10, on: ADR 0092 W12's confirmed
// `reaper.exe "<project.rpp>" "<script.lua>"` form.
func TestLaunchReaperPassesTheLauncherScriptWhenAutoStartIsOn(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, rpp := linkedProject(t)
	store := settings.New("", folder)
	store.SetPersist(nil)
	if err := store.Save("DAW", "global", map[string]*string{"auto_start_launcher": ptr("true")}); err != nil {
		t.Fatal(err)
	}
	svc := hostServices{config: config{projectFolder: folder, reaperLauncher: "C:/app/NarrationUtils_Launcher.lua"}, settings: store}
	locate := func() (string, string, error) { return "C:/REAPER/reaper.exe", "uninstall_registry", nil }
	var gotArgs []string
	launch := func(program string, args []string) error {
		gotArgs = args
		return nil
	}
	if _, err := launchReaper(svc, nil, locate, launch); err != nil {
		t.Fatal(err)
	}
	if len(gotArgs) != 2 || gotArgs[0] != rpp || gotArgs[1] != "C:/app/NarrationUtils_Launcher.lua" {
		t.Fatalf("args = %v, want the linked .rpp then the launcher script", gotArgs)
	}
}

// TestLaunchReaperASettingsOverrideWinsOverAutoDetect is W11's own recommendation, re-asserted at the launch site.
func TestLaunchReaperASettingsOverrideWinsOverAutoDetect(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, _ := linkedProject(t)
	override := filepath.Join(t.TempDir(), "reaper.exe")
	writeFile(t, override, "x")
	store := settings.New("", folder)
	store.SetPersist(nil)
	if err := store.Save("DAW", "global", map[string]*string{"reaper_path": &override}); err != nil {
		t.Fatal(err)
	}
	svc := hostServices{config: config{projectFolder: folder}, settings: store}
	locate := func() (string, string, error) {
		t.Fatal("auto-detect must not run when a valid override is set")
		return "", "", nil
	}
	var gotProgram string
	launch := func(program string, args []string) error {
		gotProgram = program
		return nil
	}
	result, err := launchReaper(svc, nil, locate, launch)
	if err != nil {
		t.Fatal(err)
	}
	if gotProgram != override || result["source"] != "settings_override" {
		t.Fatalf("result = %#v, program = %q, want the override", result, gotProgram)
	}
}

func TestLaunchReaperReportsAFailedLaunch(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir()) // never touch the real machine's global-settings.json
	folder, _ := linkedProject(t)
	svc := hostServices{config: config{projectFolder: folder}, settings: settings.New("", folder)}
	locate := func() (string, string, error) { return "C:/REAPER/reaper.exe", "uninstall_registry", nil }
	launch := func(program string, args []string) error { return fmt.Errorf("access denied") }
	if _, err := launchReaper(svc, nil, locate, launch); err == nil {
		t.Fatal("want an error when the launch itself fails")
	}
}
