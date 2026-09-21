package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

// materializeResources is what the app runs at every launch to turn the embedded resources into files Python and ONNX can use, and what
// the smoke test runs on the real executable. It was lifted out of packagedResources, so these tests hold what launching depends on.

func resourceTree(files map[string]string) fstest.MapFS {
	tree := fstest.MapFS{}
	for name, body := range files {
		tree[resourcesRoot+"/"+name] = &fstest.MapFile{Data: []byte(body)}
	}
	return tree
}

func TestMaterializeResourcesUnpacksEveryFileIntoAContentAddressedFolder(t *testing.T) {
	cache := t.TempDir()
	tree := resourceTree(map[string]string{"runtime/guide/guide.exe": "frozen", "config/tts-assets.json": "{}", "reaper/launcher.lua": "-- l"})
	root, err := materializeResources(tree, cache, filepath.Join(cache, "app.exe"))
	if err != nil {
		t.Fatal(err)
	}
	key, _ := resourceKeyFor(tree)
	if root != filepath.Join(cache, "narration-utils", "runtime", key) {
		t.Fatalf("root = %q, want the folder named by the content key %q", root, key)
	}
	for name, want := range map[string]string{"runtime/guide/guide.exe": "frozen", "config/tts-assets.json": "{}", "reaper/launcher.lua": "-- l"} {
		if got, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name))); err != nil || string(got) != want {
			t.Errorf("%s = %q (%v), want %q", name, got, err, want)
		}
	}
	if _, err := os.Stat(filepath.Join(root, ".complete")); err != nil {
		t.Errorf("the folder is not marked complete: %v", err)
	}
	if _, err := os.Stat(root + ".staging"); err == nil {
		t.Error("the staging folder was left behind")
	}
}

func TestMaterializeResourcesChangesFolderWhenAnyResourceChanges(t *testing.T) {
	cache := t.TempDir()
	first, err := materializeResources(resourceTree(map[string]string{"runtime/guide/guide.exe": "v1"}), cache, "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := materializeResources(resourceTree(map[string]string{"runtime/guide/guide.exe": "v2"}), cache, "")
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("an updated sidecar was unpacked over the old one: a stale sidecar could start")
	}
}

func TestMaterializeResourcesRefreshesTheLauncherPointerWhenTheAppMoves(t *testing.T) {
	cache := t.TempDir()
	tree := resourceTree(map[string]string{"reaper/launcher.lua": "-- l"})
	root, err := materializeResources(tree, cache, filepath.Join(cache, "old", "narration-utils.exe"))
	if err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(cache, "new", "narration-utils.exe")
	// The unchanged payload is not written again, but the pointer to the executable is: a portable install may have been relocated.
	again, err := materializeResources(tree, cache, moved)
	if err != nil || again != root {
		t.Fatalf("second call: %q, %v; want the same folder %q", again, err, root)
	}
	pointer, err := os.ReadFile(filepath.Join(root, "reaper", "narration-utils-app-path.txt"))
	if err != nil || strings.TrimSpace(string(pointer)) != moved {
		t.Fatalf("the launcher pointer is %q (%v), want %q", pointer, err, moved)
	}
}

func TestMaterializeResourcesRebuildsAFolderThatWasNeverCompleted(t *testing.T) {
	cache := t.TempDir()
	tree := resourceTree(map[string]string{"runtime/guide/guide.exe": "frozen"})
	key, _ := resourceKeyFor(tree)
	target := filepath.Join(cache, "narration-utils", "runtime", key)
	// A start that died half way: a target with no .complete, and a staging folder with a stray file.
	for _, dir := range []string{target, target + ".staging"} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(target+".staging", "stray"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := materializeResources(tree, cache, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "runtime", "guide", "guide.exe")); err != nil {
		t.Fatalf("the sidecar was not unpacked: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "stray")); err == nil {
		t.Fatal("a file from the abandoned staging folder ended up in the resources")
	}
}

func TestMaterializeResourcesReportsWhyItCouldNotUnpack(t *testing.T) {
	if _, err := materializeResources(fstest.MapFS{}, t.TempDir(), ""); err == nil {
		t.Fatal("an empty embedded file system was accepted")
	}
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := materializeResources(resourceTree(map[string]string{"a": "b"}), blocker, ""); err == nil {
		t.Fatal("a cache folder that is a file was accepted")
	}
}
