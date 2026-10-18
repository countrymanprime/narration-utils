package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/countrymanprime/narration-utils/shell/internal/pathfixtures"
	"github.com/countrymanprime/narration-utils/shell/internal/project"
	"github.com/countrymanprime/narration-utils/shell/internal/recents"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// The path guard (definition of done, rule 1): the host's own path resolvers run the shared fixture set in
// internal/pathfixtures. The root package needs the GTK toolchain to build on Linux; these tests are compile-checked there
// (GOOS=windows go vet ./... and go test -c) and run on the Windows CI.

func pgSameFile(a, b string) bool {
	infoA, errA := os.Stat(a)
	infoB, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(infoA, infoB)
}

// pgSettledTempDir is a temporary folder whose removal waits out the work attaching a project starts in the background (chapter sync
// writes into the project folder after the call returns), which on Windows makes t.TempDir's one-shot RemoveAll fail with "not empty".
func pgSettledTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "pathguard")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		deadline := time.Now().Add(5 * time.Second)
		for {
			err := os.RemoveAll(dir)
			if err == nil || time.Now().After(deadline) {
				return
			}
			time.Sleep(50 * time.Millisecond)
		}
	})
	return dir
}

// pgWritable reports whether the place's folder accepts a manifest. A folder the OS really refuses to write into is not a case for a test that
// needs a manifest in it; the read-only folder is covered where a refusal is asserted.
func pgWritable(t *testing.T, p pathfixtures.Place) bool {
	t.Helper()
	return !p.DirReadOnly
}

// pgLinkedManifest links rpp from dir in dir's manifest.
func pgLinkedManifest(t *testing.T, dir, rpp string) {
	t.Helper()
	link, err := project.BuildDawLink(dir, rpp)
	if err != nil {
		t.Fatal(err)
	}
	manifest := project.New("Guarded", time.Now())
	manifest.DawProjectFile = &link
	if err := manifest.Save(dir); err != nil {
		t.Fatal(err)
	}
}

func TestPathGuardResolveProjectFile(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		launch := config{projectFile: p.RPP, projectFolder: "guessed-folder", projectName: "Guess"}
		if !p.Usable {
			if got := resolveProjectFile(nil, p.Start, launch, p.Dir); got != launch {
				t.Fatalf("resolved %q to %+v; with nothing linked the launcher's guess must stay", p.RPP, got)
			}
			return
		}
		if !pgWritable(t, p) {
			return
		}
		pgLinkedManifest(t, p.Dir, p.RPP)
		got := resolveProjectFile(nil, p.Start, launch, p.Dir)
		if !pgSameFile(got.projectFolder, p.Dir) || got.projectName != "Guarded" {
			t.Fatalf("launched with %q, resolved to (%q, %q), want the project at %q", p.RPP, got.projectFolder, got.projectName, p.Dir)
		}
		if again := resolveProjectFile(nil, p.Start, launch); pgSameFile(again.projectFolder, p.Dir) && !strings.HasPrefix(p.Dir, p.Start) {
			t.Fatalf("the starting folder %q found the project at %q outside it", p.Start, p.Dir)
		}
		for _, alias := range p.Aliases {
			launch.projectFile = alias.RPP
			if got := resolveProjectFile(nil, p.Start, launch, p.Dir); !pgSameFile(got.projectFolder, p.Dir) {
				t.Errorf("alias %q: launched with %q, resolved to %q, want the project at %q", alias.Name, alias.RPP, got.projectFolder, p.Dir)
			}
		}
	})
}

func TestPathGuardResolveProjectFileTexts(t *testing.T) {
	for _, text := range pathfixtures.Texts() {
		t.Run(text.Name, func(t *testing.T) {
			launch := config{projectFile: text.Path, projectFolder: "guessed-folder", projectName: "Guess"}
			if got := resolveProjectFile(nil, t.TempDir(), launch, text.Path, "", t.TempDir()); got != launch {
				t.Fatalf("resolved %q to %+v, want the launcher's guess unchanged", text.Path, got)
			}
		})
	}
}

// The launch arguments carry the paths exactly as given: spaces, Unicode and a trailing space are one value each.
func TestPathGuardParseConfigArgsKeepsEveryPathVerbatim(t *testing.T) {
	for _, text := range pathfixtures.Texts() {
		t.Run(text.Name, func(t *testing.T) {
			got := parseConfigArgs(t.TempDir(), []string{"--project-folder", text.Path, "--project-file", text.Path, "--project-name", text.Path})
			if got.projectFolder != text.Path || got.projectFile != text.Path || got.projectName != text.Path {
				t.Fatalf("parsed %+v, want %q verbatim", got, text.Path)
			}
		})
	}
}

func TestPathGuardLinkDawFile(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		external := filepath.Join(p.Start, "External.rpp")
		if err := os.WriteFile(external, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}

		// p is the project folder: a folder that is not there, is a file or is empty is refused, never created or written into.
		result, err := linkDawFile(nil, p.Dir, external)
		switch {
		case !p.Usable && p.Class != pathfixtures.FolderForFile:
			if err == nil && result["linked"] == true {
				t.Fatalf("linked a REAPER project into the project folder %q, which is not a folder", p.Dir)
			}
			if p.Dir != "" && p.Class == pathfixtures.Missing {
				if _, statErr := os.Stat(p.Dir); statErr == nil {
					t.Fatalf("linking into the missing project folder %q created it", p.Dir)
				}
			}
			if _, statErr := os.Stat("narration-utils"); p.Dir == "" && statErr == nil {
				t.Fatal("linking wrote narration-utils/ into the working directory")
			}
		case p.DirReadOnly:
			if err == nil {
				t.Fatalf("linked into a read-only project folder: %v", result)
			}
		case p.Usable:
			if err != nil || result["linked"] != true || result["insideProject"] != false {
				t.Fatalf("linking an outside rpp into %q: %v %v", p.Dir, result, err)
			}
		}

		// p's rpp is the file being linked, into a project folder of its own.
		folder := t.TempDir()
		result, err = linkDawFile(nil, folder, p.RPP)
		if err != nil {
			t.Fatalf("linkDawFile(%q): an unusable rpp must be refused with a message, not an error: %v", p.RPP, err)
		}
		if !p.Usable {
			if result["linked"] != false || result["message"] == "" {
				t.Fatalf("linked %q, which is not a REAPER project file: %v", p.RPP, result)
			}
			if _, statErr := os.Stat(project.Path(folder)); statErr == nil {
				t.Fatal("a refused link wrote a manifest")
			}
			return
		}
		manifest, ok, err := project.Load(nil, folder)
		if err != nil || !ok || manifest.DawProjectFile == nil || !pgSameFile(manifest.DawProjectFile.Absolute, p.RPP) {
			t.Fatalf("link %q was not stored: %+v %v %v", p.RPP, manifest, ok, err)
		}
		// Linking a file in the project folder, through every spelling of the folder, stores it as inside.
		for _, alias := range p.Aliases {
			inside, err := linkDawFile(nil, alias.Dir, p.RPP)
			if p.DirReadOnly {
				if err == nil {
					t.Errorf("alias %q: linked into a read-only project folder", alias.Name)
				}
				continue
			}
			if err != nil || inside["linked"] != true || inside["insideProject"] != true {
				t.Errorf("alias %q: linking %q into %q: %v %v", alias.Name, p.RPP, alias.Dir, inside, err)
			}
		}
	})
}

func TestPathGuardLinkDawFileTexts(t *testing.T) {
	for _, text := range pathfixtures.Texts() {
		t.Run(text.Name, func(t *testing.T) {
			folder := t.TempDir()
			result, err := linkDawFile(nil, folder, text.Path)
			if err != nil || result["linked"] == true {
				t.Fatalf("linkDawFile(%q) = %v, %v; a file that is not there must be refused", text.Path, result, err)
			}
			if _, _, loadErr := project.Load(nil, folder); loadErr != nil {
				t.Fatal(loadErr)
			}
			if _, statErr := os.Stat(project.Path(folder)); statErr == nil {
				t.Fatal("a refused link wrote a manifest")
			}
		})
	}
}

func TestPathGuardScanRppFilesAndReadDawFolder(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		found := scanRppFiles(p.Dir)
		if found == nil {
			t.Fatal("scanRppFiles returned nil, want an empty list")
		}
		facts := readDawFolder(nil, p.Dir)
		if !p.Usable {
			// A folder named Show.rpp, a missing folder and a file in place of the folder hold no REAPER project file.
			if len(found) != 0 || facts.linkedPath != "" {
				t.Fatalf("%q holds no rpp but scan/read said %v / %+v", p.Dir, found, facts)
			}
			return
		}
		if len(found) != 1 || found[0] != filepath.Base(p.RPP) {
			t.Fatalf("scanRppFiles(%q) = %v, want [%s]", p.Dir, found, filepath.Base(p.RPP))
		}
		if facts.linkedPath != "" {
			t.Fatalf("nothing is linked yet, but readDawFolder said %q", facts.linkedPath)
		}
		if !pgWritable(t, p) {
			return
		}
		pgLinkedManifest(t, p.Dir, p.RPP)
		if facts := readDawFolder(nil, p.Dir); !pgSameFile(facts.linkedPath, p.RPP) {
			t.Fatalf("readDawFolder(%q).linkedPath = %q, want %q", p.Dir, facts.linkedPath, p.RPP)
		}
		for _, alias := range p.Aliases {
			if found := scanRppFiles(alias.Dir); len(found) != 1 {
				t.Errorf("alias %q: scanRppFiles(%q) = %v", alias.Name, alias.Dir, found)
			}
			if facts := readDawFolder(nil, alias.Dir); !pgSameFile(facts.linkedPath, p.RPP) {
				t.Errorf("alias %q: readDawFolder(%q).linkedPath = %q", alias.Name, alias.Dir, facts.linkedPath)
			}
		}
	})
}

func TestPathGuardDawLinkFacts(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		if linked, reachable, matches := dawLinkFacts(nil, p.Dir, "Standalone", nil); linked || reachable || matches {
			t.Fatalf("a project with nothing linked read as linked=%v reachable=%v matches=%v", linked, reachable, matches)
		}
		if !p.Usable {
			return
		}
		if !pgWritable(t, p) {
			return
		}
		pgLinkedManifest(t, p.Dir, p.RPP)
		for _, dir := range append([]string{p.Dir}, aliasDirs(p)...) {
			if linked, _, _ := dawLinkFacts(nil, dir, "Standalone", nil); !linked {
				t.Errorf("a linked rpp in %q read as not linked", dir)
			}
		}
		if err := os.Remove(p.RPP); err == nil {
			if linked, _, _ := dawLinkFacts(nil, p.Dir, "Standalone", nil); linked {
				t.Error("a linked rpp that was deleted still reads as linked")
			}
		}
	})
}

func aliasDirs(p pathfixtures.Place) []string {
	dirs := make([]string, 0, len(p.Aliases))
	for _, alias := range p.Aliases {
		dirs = append(dirs, alias.Dir)
	}
	return dirs
}

func TestPathGuardLaunchReaperPassesTheLinkedFile(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		t.Setenv("APPDATA", pgSettledTempDir(t)) // never touch the real machine's global-settings.json
		locate := func() (string, string, error) { return "C:/REAPER/reaper.exe", "uninstall_registry", nil }
		var args []string
		launch := func(program string, got []string) error { args = got; return nil }
		svc := hostServices{config: config{projectFolder: p.Dir}, settings: settings.New("", p.Dir)}
		if !p.Usable {
			if _, err := launchReaper(svc, nil, locate, launch, notRunning); err == nil {
				t.Fatalf("started REAPER for %q, which holds no linked project file (args %v)", p.Dir, args)
			}
			return
		}
		if !pgWritable(t, p) {
			return
		}
		pgLinkedManifest(t, p.Dir, p.RPP)
		if _, err := launchReaper(svc, nil, locate, launch, notRunning); err != nil {
			t.Fatalf("launchReaper(%q): %v", p.Dir, err)
		}
		if len(args) != 1 || !pgSameFile(args[0], p.RPP) {
			t.Fatalf("args = %v, want only %q", args, p.RPP)
		}
	})
}

// A project made outside the starting folder is found by the REAPER launch through the recent list (the owner's bug).
func TestPathGuardOnSecondInstanceFindsAProjectOutsideTheStartingFolder(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		if !p.Usable || p.DirReadOnly || p.FileReadOnly {
			return // only a project the host can open and write is attached by a second launch
		}
		home := t.TempDir()
		t.Setenv("USERPROFILE", home)
		t.Setenv("HOME", home)
		t.Setenv("APPDATA", pgSettledTempDir(t))
		pgLinkedManifest(t, p.Dir, p.RPP)
		host := NewHost()
		host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
		if err := host.recents.Touch(p.Dir, "Guarded"); err != nil {
			t.Fatal(err)
		}
		host.onSecondInstance(application.SecondInstanceData{Args: []string{
			"--project-folder", filepath.Dir(p.RPP), "--project-name", "Show", "--project-file", p.RPP, "--daw", "REAPER",
		}})
		if !pgSameFile(host.config.projectFolder, p.Dir) {
			t.Fatalf("the launch of %q attached %q, want the project %q", p.RPP, host.config.projectFolder, p.Dir)
		}
	})
}

func TestPathGuardProjectSwitch(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		t.Setenv("APPDATA", pgSettledTempDir(t))
		host := NewHost()
		host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
		before := host.config.projectFolder
		raw, err := host.ProjectSwitch(p.Dir, "Café 朗読 📚")
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			t.Fatal(err)
		}
		isFolder := false
		if info, statErr := os.Stat(p.Dir); statErr == nil && info.IsDir() {
			isFolder = true
		}
		if isFolder != (result["switched"] == true) {
			t.Fatalf("ProjectSwitch(%q) = %v; switched must be %v", p.Dir, result, isFolder)
		}
		if !isFolder && host.config.projectFolder != before {
			t.Fatalf("a refused switch changed the project to %q", host.config.projectFolder)
		}
		if isFolder {
			if entries, _ := host.recents.List(); len(entries) != 1 {
				t.Fatalf("recents = %#v, want the switched project", entries)
			}
		}
	})
}

func TestPathGuardProjectCreateInNames(t *testing.T) {
	for _, fixture := range pathfixtures.Names() {
		t.Run(fixture.Name, func(t *testing.T) {
			if fixture.Valid && len(fixture.Value) > 200 && runtime.GOOS == "windows" {
				return // a 255-character name makes a path over the 260-character limit of an ordinary Windows path; the long-path place fixtures cover long paths
			}
			t.Setenv("APPDATA", pgSettledTempDir(t))
			host := NewHost()
			host.recents = recents.New(filepath.Join(pgSettledTempDir(t), "recent-projects.json"))
			parent := pgSettledTempDir(t)
			raw, err := host.ProjectCreateIn(parent, fixture.Value)
			created, _ := os.ReadDir(parent)
			if !fixture.Valid {
				if err == nil {
					t.Fatalf("ProjectCreateIn created %q: %s", fixture.Value, raw)
				}
				if len(created) != 0 {
					t.Fatalf("a refused name %q left %v behind", fixture.Value, created)
				}
				return
			}
			if err != nil || !strings.Contains(raw, `"switched":true`) || len(created) != 1 {
				t.Fatalf("ProjectCreateIn(%q) = %s, %v, created %v", fixture.Value, raw, err, created)
			}
			if want := filepath.Join(parent, strings.TrimSpace(fixture.Value)); host.config.projectFolder != want {
				t.Fatalf("attached %q, want %q", host.config.projectFolder, want)
			}
		})
	}
}

func TestPathGuardProjectCreateInParents(t *testing.T) {
	pathfixtures.Run(t, func(t *testing.T, p pathfixtures.Place) {
		home := t.TempDir()
		t.Setenv("USERPROFILE", home)
		t.Setenv("HOME", home)
		t.Setenv("APPDATA", pgSettledTempDir(t))
		host := NewHost()
		host.recents = recents.New(filepath.Join(t.TempDir(), "recent-projects.json"))
		raw, err := host.ProjectCreateIn(p.Dir, "New Book")
		switch {
		case p.Dir == "":
			// An empty parent is the default projects directory, not the working directory.
			if err == nil {
				if want := filepath.Join(home, project.DefaultDirName); !strings.HasPrefix(host.config.projectFolder, want) {
					t.Fatalf("an empty parent created %q, want it under %q", host.config.projectFolder, want)
				}
			}
		case !filepath.IsAbs(p.Dir):
			if err == nil {
				t.Fatalf("created a project under the relative location %q: %s", p.Dir, raw)
			}
		case p.Class == pathfixtures.FileForFolder, p.DirReadOnly:
			if err == nil && strings.Contains(raw, `"switched":true`) {
				t.Fatalf("created a project under %q, which cannot hold one: %s", p.Dir, raw)
			}
		default:
			if err != nil || !strings.Contains(raw, `"switched":true`) {
				t.Fatalf("ProjectCreateIn(%q): %s %v", p.Dir, raw, err)
			}
			if _, statErr := os.Stat(project.Path(filepath.Join(p.Dir, "New Book"))); statErr != nil {
				t.Fatalf("no manifest in the new project: %v", statErr)
			}
		}
	})
}
