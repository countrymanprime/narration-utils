package assets

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The bundled catalogs (config/whisper-assets.json, config/tts-assets.json) are what the app downloads and installs.
// Integrity is already checked at install time (size and SHA-256, into a staging directory), so what these tests pin
// is the other half: each file is fetched from an immutable revision over https, not from a tag or a branch that can
// be moved to different bytes, and its checksum and size are well formed.

var (
	// A Hugging Face file URL: /<owner>/<repo>/resolve/<40-hex commit>/<path>. A tag or branch name in the revision
	// position is mutable, so it does not match.
	pinnedResolveURL = regexp.MustCompile(`^/[^/]+/[^/]+/resolve/[0-9a-f]{40}/.+`)
	sha256Hex        = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// pinProblems describes every way a catalog file is not pinned; an empty result means it is.
func pinProblems(f File) []string {
	var problems []string
	u, err := url.Parse(f.URL)
	switch {
	case err != nil || u.Host == "":
		problems = append(problems, "the URL does not parse")
	case u.Scheme != "https":
		problems = append(problems, "the URL is not https")
	case !pinnedResolveURL.MatchString(u.Path):
		problems = append(problems, "the URL does not name a 40-hex commit (a tag or branch can move)")
	case path.Base(u.Path) != f.Name:
		problems = append(problems, "the file name is not the last part of the URL")
	}
	if !sha256Hex.MatchString(f.SHA256) {
		problems = append(problems, "the SHA-256 is not 64 lowercase hex characters")
	}
	if f.Size <= 0 {
		problems = append(problems, "the size is not positive")
	}
	return problems
}

func TestPinProblemsAcceptsACommitPinnedFile(t *testing.T) {
	f := File{
		Name:   "model.bin",
		URL:    "https://huggingface.co/owner/repo/resolve/375a0fe641dea077c2a47b4e9a056d6da521eed3/sub/dir/model.bin",
		SHA256: strings.Repeat("ab", 32),
		Size:   10,
	}
	if got := pinProblems(f); len(got) != 0 {
		t.Fatalf("a pinned file was rejected: %v", got)
	}
}

func TestPinProblemsRejectsEachWayAFileCanMove(t *testing.T) {
	const commit = "375a0fe641dea077c2a47b4e9a056d6da521eed3"
	good := File{Name: "m.bin", URL: "https://huggingface.co/o/r/resolve/" + commit + "/m.bin", SHA256: strings.Repeat("ab", 32), Size: 1}
	cases := []struct {
		name string
		edit func(*File)
		want string
	}{
		{"a tag", func(f *File) { f.URL = "https://huggingface.co/o/r/resolve/v1.0.0/m.bin" }, "40-hex commit"},
		{"a branch", func(f *File) { f.URL = "https://huggingface.co/o/r/resolve/main/m.bin" }, "40-hex commit"},
		{"a short commit", func(f *File) { f.URL = "https://huggingface.co/o/r/resolve/375a0fe/m.bin" }, "40-hex commit"},
		{"an upper-case commit", func(f *File) { f.URL = "https://huggingface.co/o/r/resolve/" + strings.ToUpper(commit) + "/m.bin" }, "40-hex commit"},
		{"plain http", func(f *File) { f.URL = "http://huggingface.co/o/r/resolve/" + commit + "/m.bin" }, "not https"},
		{"no host", func(f *File) { f.URL = "/o/r/resolve/" + commit + "/m.bin" }, "does not parse"},
		{"another file name", func(f *File) { f.Name = "other.bin" }, "file name"},
		{"a short checksum", func(f *File) { f.SHA256 = "abcd" }, "SHA-256"},
		{"an upper-case checksum", func(f *File) { f.SHA256 = strings.Repeat("AB", 32) }, "SHA-256"},
		{"no size", func(f *File) { f.Size = 0 }, "size"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := good
			tc.edit(&f)
			got := strings.Join(pinProblems(f), "; ")
			if !strings.Contains(got, tc.want) {
				t.Fatalf("problems = %q, want one mentioning %q", got, tc.want)
			}
		})
	}
}

// catalogFiles reads a bundled catalog and returns every file of every voice or model, labelled for a failure message.
func catalogFiles(t *testing.T, name string) map[string]File {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "config", name))
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Voices []struct {
			ID    string `json:"id"`
			Files []File `json:"files"`
		} `json:"voices"`
		Models []struct {
			ID    string `json:"id"`
			Files []File `json:"files"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	files := map[string]File{}
	for _, v := range catalog.Voices {
		for _, f := range v.Files {
			files[fmt.Sprintf("%s: %s/%s", name, v.ID, f.Name)] = f
		}
	}
	for _, m := range catalog.Models {
		for _, f := range m.Files {
			files[fmt.Sprintf("%s: %s/%s", name, m.ID, f.Name)] = f
		}
	}
	if len(files) == 0 {
		t.Fatalf("%s lists no files", name)
	}
	return files
}

func TestBundledCatalogsPinEveryFileToACommit(t *testing.T) {
	for _, name := range []string{"whisper-assets.json", "tts-assets.json"} {
		for label, f := range catalogFiles(t, name) {
			if problems := pinProblems(f); len(problems) != 0 {
				t.Errorf("%s is not pinned: %s", label, strings.Join(problems, "; "))
			}
		}
	}
}
