package manuscript

import (
	"os"
	"path/filepath"
	"testing"
)

func touch(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectSourceFindsManuscriptFileCaseInsensitively(t *testing.T) {
	project := t.TempDir()
	touch(t, filepath.Join(project, "Manuscript.DOCX"))
	touch(t, filepath.Join(project, "notes.docx"))
	if got := DetectSource(project); filepath.Base(got) != "Manuscript.DOCX" {
		t.Fatalf("detected %q", got)
	}
}

func TestDetectSourcePrefersDocxOverMarkdown(t *testing.T) {
	project := t.TempDir()
	touch(t, filepath.Join(project, "manuscript.md"))
	touch(t, filepath.Join(project, "manuscript.docx"))
	if got := DetectSource(project); filepath.Base(got) != "manuscript.docx" {
		t.Fatalf("detected %q", got)
	}
}

// TestDetectSourceFindsEpubAndTxt pins F2 (txt-and-epub-import PRD, Phase 4):
// a manuscript.epub or manuscript.txt sitting in the project folder is now
// offered, the same as manuscript.docx/.md always were.
func TestDetectSourceFindsEpubAndTxt(t *testing.T) {
	for _, extension := range []string{".epub", ".txt"} {
		project := t.TempDir()
		touch(t, filepath.Join(project, "manuscript"+extension))
		if got := DetectSource(project); filepath.Base(got) != "manuscript"+extension {
			t.Fatalf("extension %s: detected %q", extension, got)
		}
	}
}

// TestDetectSourcePreferenceOrder pins the full preference order from the PRD's
// own recommendation (F2): .docx, .epub, .md, .markdown, .txt.
func TestDetectSourcePreferenceOrder(t *testing.T) {
	order := []string{".docx", ".epub", ".md", ".markdown", ".txt"}
	for start := 0; start < len(order); start++ {
		project := t.TempDir()
		for _, extension := range order[start:] {
			touch(t, filepath.Join(project, "manuscript"+extension))
		}
		want := "manuscript" + order[start]
		if got := DetectSource(project); filepath.Base(got) != want {
			t.Fatalf("with %v present, detected %q, want %q", order[start:], got, want)
		}
	}
}

func TestDetectSourceIgnoresUnsupportedFormatsWordLockFilesAndDirectories(t *testing.T) {
	project := t.TempDir()
	touch(t, filepath.Join(project, "manuscript.pdf"))
	touch(t, filepath.Join(project, "~$manuscript.docx"))
	if err := os.Mkdir(filepath.Join(project, "manuscript.md"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := DetectSource(project); got != "" {
		t.Fatalf("detected %q", got)
	}
}

func TestDetectSourceStaysQuietOnceAManuscriptIsImported(t *testing.T) {
	project := t.TempDir()
	touch(t, filepath.Join(project, "manuscript.docx"))
	target := filepath.Join(project, "narration-utils", "manuscript")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}
	touch(t, filepath.Join(target, "manuscript.json"))
	if got := DetectSource(project); got != "" {
		t.Fatalf("detected %q after import", got)
	}
}

func TestBeginDetectedOnlyAcceptsTheDetectedFile(t *testing.T) {
	project := t.TempDir()
	detected := filepath.Join(project, "manuscript.md")
	touch(t, detected)
	other := filepath.Join(t.TempDir(), "manuscript.md")
	touch(t, other)
	service := New(project)
	if _, err := service.BeginDetected(other); err == nil {
		t.Fatal("a path outside the project must be refused")
	}
	job, err := service.BeginDetected(detected)
	if err != nil || job.ID == "" {
		t.Fatalf("job %#v, %v", job, err)
	}
}
