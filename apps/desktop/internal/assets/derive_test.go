package assets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// deriveIndex is a Derive that builds one file from everything that was unpacked and removes the rest, the way the dictionary builds its
// lookup index from the dataset.
func deriveIndex(staging string, file File, unpacked []ExtractedFile) ([]ExtractedFile, error) {
	var joined strings.Builder
	for _, item := range unpacked {
		body, err := os.ReadFile(filepath.Join(staging, filepath.FromSlash(item.Path)))
		if err != nil {
			return nil, err
		}
		joined.Write(body)
	}
	root := filepath.Join(staging, file.Extract)
	if err := os.RemoveAll(root); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(root, "index.bin"), []byte(joined.String()), 0o600); err != nil {
		return nil, err
	}
	kept, err := RecordFile(staging, file.Extract+"/index.bin")
	if err != nil {
		return nil, err
	}
	return []ExtractedFile{kept}, nil
}

func TestADeriveStepReplacesWhatWasUnpackedWithWhatTheInstallKeeps(t *testing.T) {
	archive := buildZip(t, map[string]string{"a.json": "alpha", "b.json": "beta"})
	files := []File{archiveFile(serve(t, archive).URL, archive, 100)}
	root := t.TempDir()
	if err := InstallWith(context.Background(), root, "dict", "d", "1", files, Options{Derive: deriveIndex}); err != nil {
		t.Fatal(err)
	}
	dir := Dir(root, "dict", "d", "1")
	if body, err := os.ReadFile(filepath.Join(dir, "model", "index.bin")); err != nil || len(body) != len("alphabeta") {
		t.Fatalf("the derived file was not kept: %q, %v", body, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "model", "a.json")); !os.IsNotExist(err) {
		t.Fatal("the unpacked dataset must not be kept once the index is built")
	}
	manifest, err := ReadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := manifest.Files[0].Extracted; len(got) != 1 || got[0].Path != "model/index.bin" {
		t.Fatalf("the manifest must record the derived file only, got %+v", got)
	}
	if got := State(root, "dict", "d", "1", files); got != "installed" {
		t.Fatalf("State = %s", got)
	}
	// Verify reads the derived file against the hash taken when it was built: damage is found.
	if err := os.WriteFile(filepath.Join(dir, "model", "index.bin"), []byte("alphabetX"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Verify(root, "dict", "d", "1", files); got != "verification_failed" {
		t.Fatalf("Verify of a damaged index = %s", got)
	}
}

func TestADeriveStepThatFailsInstallsNothingAndKeepsNothingToResume(t *testing.T) {
	archive := buildZip(t, map[string]string{"a.json": "alpha"})
	files := []File{archiveFile(serve(t, archive).URL, archive, 100)}
	root := t.TempDir()
	broken := func(string, File, []ExtractedFile) ([]ExtractedFile, error) {
		return nil, errors.New("not the dataset we expected")
	}
	err := InstallWith(context.Background(), root, "dict", "d", "1", files, Options{Derive: broken})
	if !errors.Is(err, ErrBadContent) {
		t.Fatalf("err = %v, want ErrBadContent", err)
	}
	if _, statErr := os.Stat(Dir(root, "dict", "d", "1") + stagingSuffix); !os.IsNotExist(statErr) {
		t.Fatal("a failed derive must not leave a staging folder behind")
	}
	if got := State(root, "dict", "d", "1", files); got != "not_installed" {
		t.Fatalf("State = %s", got)
	}
}

func TestADeriveStepMayNotKeepAFileOutsideItsArchiveFolder(t *testing.T) {
	archive := buildZip(t, map[string]string{"a.json": "alpha"})
	files := []File{archiveFile(serve(t, archive).URL, archive, 100)}
	for name, kept := range map[string][]ExtractedFile{
		"nothing":        nil,
		"another folder": {{Path: "elsewhere/index.bin"}},
		"a parent path":  {{Path: "model/../index.bin"}},
	} {
		t.Run(name, func(t *testing.T) {
			derive := func(string, File, []ExtractedFile) ([]ExtractedFile, error) { return kept, nil }
			if err := InstallWith(context.Background(), t.TempDir(), "dict", "d", "1", files, Options{Derive: derive}); !errors.Is(err, ErrBadContent) {
				t.Fatalf("err = %v, want ErrBadContent", err)
			}
		})
	}
}
