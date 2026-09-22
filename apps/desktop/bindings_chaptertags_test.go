package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/renderconfig"
)

func copyTestFile(t *testing.T, src, dst string) {
	t.Helper()
	in, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = in.Close() }()
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = out.Close() }()
	if _, err := io.Copy(out, in); err != nil {
		t.Fatal(err)
	}
}

// newTestHostWithRenderConfig sets up a Host whose renderConfig service already reports the two per-chapter
// fixture files under internal/chaptertags/testdata (copied into a fresh temp dir under the given names) as its
// last successful configure - the input ChapterTagsPreview/Embed read.
func newTestHostWithRenderConfig(t *testing.T) (*Host, string) {
	t.Helper()
	dir := t.TempDir()
	chapter1 := filepath.Join(dir, "Chapter 1.mp3")
	chapter2 := filepath.Join(dir, "Chapter 2.mp3")
	copyTestFile(t, filepath.Join("internal", "chaptertags", "testdata", "chapter1.mp3"), chapter1)
	copyTestFile(t, filepath.Join("internal", "chaptertags", "testdata", "chapter2.mp3"), chapter2)

	session := t.TempDir()
	client, err := bridge.New(session)
	if err != nil {
		t.Fatal(err)
	}
	service := renderconfig.New(renderconfig.Config{SessionDir: session}, client, nil)
	if err := service.Configure(dir); err != nil {
		t.Fatal(err)
	}
	runID := service.Snapshot()["runId"].(string)
	line := "RENDER_CONFIGURED|" + runID + "|" + dir + "|2|" + chapter1 + ";" + chapter2
	if err := os.WriteFile(filepath.Join(session, "events.log"), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Drain(); err != nil {
		t.Fatal(err)
	}

	host := &Host{renderConfig: service}
	return host, dir
}

func TestChapterTagsPreviewWithNoRenderConfigService(t *testing.T) {
	host := &Host{}
	raw, err := host.ChapterTagsPreview()
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["ready"] != false {
		t.Fatalf("ready = %v, want false", result["ready"])
	}
	if chapters, ok := result["chapters"].([]any); !ok || len(chapters) != 0 {
		t.Fatalf("chapters = %v, want an empty list", result["chapters"])
	}
}

func TestChapterTagsPreviewListsKnownChaptersAsRendered(t *testing.T) {
	host, _ := newTestHostWithRenderConfig(t)
	raw, err := host.ChapterTagsPreview()
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["ready"] != true {
		t.Fatalf("ready = %v, want true (both files exist)", result["ready"])
	}
	chapters, ok := result["chapters"].([]any)
	if !ok || len(chapters) != 2 {
		t.Fatalf("chapters = %v, want 2 entries", result["chapters"])
	}
	first := chapters[0].(map[string]any)
	if first["title"] != "Chapter 1" {
		t.Errorf("chapters[0].title = %v, want %q", first["title"], "Chapter 1")
	}
	if first["rendered"] != true {
		t.Errorf("chapters[0].rendered = %v, want true", first["rendered"])
	}
}

func TestChapterTagsPreviewReportsAMissingRenderAsNotReady(t *testing.T) {
	host, dir := newTestHostWithRenderConfig(t)
	if err := os.Remove(filepath.Join(dir, "Chapter 2.mp3")); err != nil {
		t.Fatal(err)
	}
	raw, err := host.ChapterTagsPreview()
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	if result["ready"] != false {
		t.Fatalf("ready = %v, want false (chapter 2 was deleted)", result["ready"])
	}
}

func TestChapterTagsEmbedRequiresARenderConfigService(t *testing.T) {
	host := &Host{}
	if _, err := host.ChapterTagsEmbed(filepath.Join(t.TempDir(), "book.mp3")); err == nil {
		t.Fatal("ChapterTagsEmbed with no render config: want error, got nil")
	}
}

func TestChapterTagsEmbedRequiresADestPath(t *testing.T) {
	host, _ := newTestHostWithRenderConfig(t)
	if _, err := host.ChapterTagsEmbed("   "); err == nil {
		t.Fatal("ChapterTagsEmbed with a blank destPath: want error, got nil")
	}
}

func TestChapterTagsEmbedWritesATaggedCopyBesideTheChosenFile(t *testing.T) {
	host, dir := newTestHostWithRenderConfig(t)
	dest := filepath.Join(dir, "Alice in Wonderland.mp3")
	copyTestFile(t, filepath.Join("internal", "chaptertags", "testdata", "book.mp3"), dest)

	raw, err := host.ChapterTagsEmbed(dest)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	outputPath, _ := result["outputPath"].(string)
	if outputPath == "" || outputPath == dest {
		t.Fatalf("outputPath = %q, want a new path beside %q", outputPath, dest)
	}
	if _, err := os.Stat(outputPath); err != nil {
		t.Fatalf("the tagged copy was not written: %v", err)
	}
	originalStillThere, err := os.ReadFile(filepath.Join("internal", "chaptertags", "testdata", "book.mp3"))
	if err != nil {
		t.Fatal(err)
	}
	destBytes, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(originalStillThere) != string(destBytes) {
		t.Fatal("ChapterTagsEmbed modified the file the narrator chose; it must only write a new copy")
	}
}

func TestContractChapterTagsPreviewIdle(t *testing.T) {
	host := &Host{}
	raw, err := host.ChapterTagsPreview()
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	contractfile.Check(t, "chapter-tags-preview-idle", result)
}

func TestContractChapterTagsPreviewReady(t *testing.T) {
	host, _ := newTestHostWithRenderConfig(t)
	raw, err := host.ChapterTagsPreview()
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	// Paths are temp-dir-specific; the schema only needs stable shape, so normalize them for the committed fixture.
	if chapters, ok := result["chapters"].([]any); ok {
		for i, c := range chapters {
			entry := c.(map[string]any)
			entry["path"] = "C:\\Books\\Alice\\renders\\" + entry["title"].(string) + ".mp3"
			chapters[i] = entry
		}
	}
	contractfile.Check(t, "chapter-tags-preview-ready", result)
}

func TestContractChapterTagsEmbedSuccess(t *testing.T) {
	host, dir := newTestHostWithRenderConfig(t)
	dest := filepath.Join(dir, "Alice in Wonderland.mp3")
	copyTestFile(t, filepath.Join("internal", "chaptertags", "testdata", "book.mp3"), dest)

	raw, err := host.ChapterTagsEmbed(dest)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		t.Fatal(err)
	}
	// outputPath is temp-dir-specific; normalize it for the committed fixture, the way runId is stabilized in
	// internal/renderconfig/contract_test.go.
	result["outputPath"] = "C:\\Books\\Alice\\renders\\Alice in Wonderland.chapters.mp3"
	contractfile.Check(t, "chapter-tags-embed-success", result)
}
