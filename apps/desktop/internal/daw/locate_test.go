package daw

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLooksLikeReaperMatchesTheRealDisplayNameAndItsWord(t *testing.T) {
	cases := map[string]bool{
		"REAPER (x64)": true,
		"REAPER":       true,
		"reaper (x64)": true, // case-insensitive: the registry does not guarantee casing
		"REAPER FX Suite (some unrelated plugin bundle)": false,
		"Reaperoni Media Tools":                          false, // must not match on a bare prefix without a word boundary
		"":                                               false,
	}
	for name, want := range cases {
		if got := looksLikeReaper(name); got != want {
			t.Errorf("looksLikeReaper(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestPickFromUninstallEntriesReturnsTheFirstReaperEntryWhoseExecutableExists(t *testing.T) {
	entries := []installEntry{
		{DisplayName: "Some Other App", InstallLocation: `C:\Program Files\Other`},
		{DisplayName: "REAPER (x64)", InstallLocation: `C:\Program Files\REAPER (x64)`},
	}
	// filepath.Join is the platform's own: the path this picks is only ever
	// used on Windows, but the pure selection logic is tested everywhere.
	want := filepath.Join(`C:\Program Files\REAPER (x64)`, "reaper.exe")
	exists := func(path string) bool { return path == want }

	got, ok := pickFromUninstallEntries(entries, exists)

	if !ok {
		t.Fatal("want ok = true")
	}
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestPickFromUninstallEntriesSkipsAnEntryWhoseExecutableIsMissing(t *testing.T) {
	entries := []installEntry{{DisplayName: "REAPER (x64)", InstallLocation: `C:\stale\uninstall\entry`}}
	exists := func(string) bool { return false } // the registry can lag an uninstall that did not clean up

	_, ok := pickFromUninstallEntries(entries, exists)

	if ok {
		t.Fatal("want ok = false when the recorded install location no longer has reaper.exe")
	}
}

func TestPickFromUninstallEntriesReportsNotFoundWhenNoEntryMatches(t *testing.T) {
	entries := []installEntry{{DisplayName: "Unrelated App", InstallLocation: `C:\Program Files\Unrelated`}}

	_, ok := pickFromUninstallEntries(entries, func(string) bool { return true })

	if ok {
		t.Fatal("want ok = false: no entry looked like a REAPER install")
	}
}

func TestParseAssociationCommandExtractsTheQuotedExecutable(t *testing.T) {
	// The real value read from HKCR\Reaper.Project\shell\open64\command in the Phase 6 spike, 2026-09-22.
	command := `"C:\Program Files\REAPER (x64)\reaper.exe" -project "%1"`

	got, ok := parseAssociationCommand(command)

	if !ok {
		t.Fatal("want ok = true")
	}
	if want := `C:\Program Files\REAPER (x64)\reaper.exe`; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestParseAssociationCommandRejectsAnUnquotedOrEmptyCommand(t *testing.T) {
	for _, command := range []string{"", "reaper.exe -project %1", `"unterminated`} {
		if _, ok := parseAssociationCommand(command); ok {
			t.Errorf("parseAssociationCommand(%q): want ok = false", command)
		}
	}
}

func TestResolvePrefersASettingsOverrideThatExists(t *testing.T) {
	real := t.TempDir() + `\reaper.exe`
	writeEmptyFile(t, real)
	autoDetectCalled := false
	autoDetect := func() (string, string, error) {
		autoDetectCalled = true
		return "should not be used", SourceUninstallEntry, nil
	}

	path, source, err := Resolve(real, autoDetect)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if path != real || source != SourceSettingsOverride {
		t.Errorf("got (%q, %q), want (%q, %q)", path, source, real, SourceSettingsOverride)
	}
	if autoDetectCalled {
		t.Error("auto-detect must not run when the override already points at a real file")
	}
}

func TestResolveFallsBackToAutoDetectWhenTheOverrideIsEmptyOrMissing(t *testing.T) {
	missing := t.TempDir() + `\does-not-exist.exe`
	want := t.TempDir() + `\reaper.exe`
	autoDetect := func() (string, string, error) { return want, SourceUninstallEntry, nil }

	for _, override := range []string{"", missing} {
		path, source, err := Resolve(override, autoDetect)
		if err != nil {
			t.Fatalf("override %q: unexpected error: %v", override, err)
		}
		if path != want || source != SourceUninstallEntry {
			t.Errorf("override %q: got (%q, %q), want (%q, %q)", override, path, source, want, SourceUninstallEntry)
		}
	}
}

func TestResolveReturnsNotFoundWhenNeitherOverrideNorAutoDetectSucceed(t *testing.T) {
	autoDetect := func() (string, string, error) { return "", "", ErrNotFound }

	_, _, err := Resolve("", autoDetect)

	if !errors.Is(err, ErrNotFound) {
		t.Errorf("got %v, want ErrNotFound", err)
	}
}

func writeEmptyFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
}
