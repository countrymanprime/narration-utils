package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A checkout's launcher reads the program to run from the file beside it; without it the launcher falls back to whatever stale
// build sits in build/bin, so a REAPER action in a dev checkout opened an old copy of the app instead of the running one.
func TestWriteCheckoutLauncherPointerNamesTheRunningProgramBesideTheLauncher(t *testing.T) {
	dir := t.TempDir()
	launcher := filepath.Join(dir, "NarrationUtils_Launcher.lua")
	if err := writeCheckoutLauncherPointer(launcher, `C:\dev\nu-dev.exe`); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dir, "narration-utils-app-path.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != `C:\dev\nu-dev.exe` {
		t.Fatalf("pointer = %q", got)
	}
}

func TestWriteCheckoutLauncherPointerWritesNothingWithoutAProgramOrALauncher(t *testing.T) {
	dir := t.TempDir()
	if err := writeCheckoutLauncherPointer(filepath.Join(dir, "NarrationUtils_Launcher.lua"), ""); err != nil {
		t.Fatal(err)
	}
	if err := writeCheckoutLauncherPointer("", `C:\dev\nu-dev.exe`); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("wrote %d files", len(entries))
	}
}
