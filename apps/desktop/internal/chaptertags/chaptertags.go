package chaptertags

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bogem/id3v2/v2"
)

// maxCTOCEntries is the largest chapter count a CTOC frame's one-byte entry-count field can hold
// (http://id3.org/id3v2-chapters-1.0). No real audiobook has this many chapters; this only guards the byte
// truncation buildCTOCBody would otherwise do silently.
const maxCTOCEntries = 255

// Chapter is one already-rendered per-chapter MP3 file (a Phase 11 RENDER_TARGETS entry, title from the region
// name), used only to learn how long that chapter runs.
type Chapter struct {
	Title string
	Path  string
}

// TimedChapter is one chapter's position on the combined book file's timeline: Start is the sum of every earlier
// chapter's duration, End is Start plus this chapter's own duration.
type TimedChapter struct {
	Title string
	Start time.Duration
	End   time.Duration
}

// BuildTimeline reads each chapter's rendered MP3 file (in the given order - the narrator's chapter order, not
// sorted) and lays out a sequential timeline: chapter N starts where chapter N-1 ended. It never reads the
// combined book file (Embed's destPath) - only the per-chapter files, which is the input this app actually has
// (Phase 11's RENDER_TARGETS). An empty title is rejected (a CHAP frame needs one) and a chapter whose file has
// not been rendered yet (does not exist, or is not an MP3) fails with a message naming the missing file, rather
// than silently skipping it or guessing its length.
func BuildTimeline(chapters []Chapter) ([]TimedChapter, error) {
	if len(chapters) == 0 {
		return nil, fmt.Errorf("no chapters to embed")
	}
	timeline := make([]TimedChapter, 0, len(chapters))
	var cursor time.Duration
	for i, chapter := range chapters {
		title := strings.TrimSpace(chapter.Title)
		if title == "" {
			return nil, fmt.Errorf("chapter %d has no title", i+1)
		}
		duration, err := mp3Duration(chapter.Path)
		if err != nil {
			return nil, fmt.Errorf("could not read %q (%s): %w", title, chapter.Path, err)
		}
		start := cursor
		end := cursor + duration
		timeline = append(timeline, TimedChapter{Title: title, Start: start, End: end})
		cursor = end
	}
	return timeline, nil
}

// Embed writes ID3v2 CHAP and CTOC frames describing timeline into a NEW copy of destPath, beside it, and
// returns that new file's path. destPath itself is opened read-only and is never modified - the copy is where
// every mutation happens. destPath must already be an MP3 (ID3v2's CHAP/CTOC frames are meaningless in a WAV
// container; see the PRD phase-12 note in docs/adr/0099-... for why this feature is MP3-only). Re-running Embed
// on the same destPath is safe: any CHAP/CTOC frames already in the copy from a previous run are replaced, not
// duplicated, and every other existing tag (title, artist, ...) is preserved.
func Embed(destPath string, timeline []TimedChapter) (string, error) {
	if len(timeline) == 0 {
		return "", fmt.Errorf("no chapters to embed")
	}
	if len(timeline) > maxCTOCEntries {
		return "", fmt.Errorf("%d chapters is more than a CTOC frame can list (max %d)", len(timeline), maxCTOCEntries)
	}
	if !strings.EqualFold(filepath.Ext(destPath), ".mp3") {
		return "", fmt.Errorf("%q is not an MP3 file; ID3 chapter tags only apply to MP3", destPath)
	}
	if _, err := os.Stat(destPath); err != nil {
		return "", fmt.Errorf("could not find %q: %w", destPath, err)
	}

	outPath := chapteredCopyPath(destPath)
	if err := copyFile(destPath, outPath); err != nil {
		return "", fmt.Errorf("could not create %q: %w", outPath, err)
	}

	tag, err := id3v2.Open(outPath, id3v2.Options{Parse: true})
	if err != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("could not read the ID3 tag of the new copy %q: %w", outPath, err)
	}
	// Closed explicitly on every path below (Windows cannot remove an open file), never left to a bare defer.

	tag.DeleteFrames("CHAP")
	tag.DeleteFrames("CTOC")

	childIDs := make([]string, 0, len(timeline))
	for i, chapter := range timeline {
		elementID := fmt.Sprintf("chp%d", i+1)
		childIDs = append(childIDs, elementID)
		tag.AddChapterFrame(id3v2.ChapterFrame{
			ElementID:   elementID,
			StartTime:   chapter.Start,
			EndTime:     chapter.End,
			StartOffset: id3v2.IgnoredOffset,
			EndOffset:   id3v2.IgnoredOffset,
			Title:       &id3v2.TextFrame{Encoding: id3v2.EncodingUTF8, Text: chapter.Title},
		})
	}
	tag.AddFrame("CTOC", id3v2.UnknownFrame{Body: buildCTOCBody("toc", childIDs)})

	saveErr := tag.Save()
	_ = tag.Close() // release the file handle before a failed save tries to remove it (Windows)
	if saveErr != nil {
		_ = os.Remove(outPath)
		return "", fmt.Errorf("could not write chapter tags to %q: %w", outPath, saveErr)
	}
	return outPath, nil
}

// chapteredCopyPath names the new file "beside" destPath: the render is untouched at its own name, and the
// tagged copy sits next to it as "<name>.chapters.mp3".
func chapteredCopyPath(destPath string) string {
	ext := filepath.Ext(destPath)
	base := strings.TrimSuffix(destPath, ext)
	return base + ".chapters" + ext
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }() // read-only
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() { _ = out.Close() }() // out.Close() below is what actually flushes and is checked
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

// buildCTOCBody hand-builds an ID3v2 Chapters Addendum CTOC frame body (http://id3.org/id3v2-chapters-1.0),
// which bogem/id3v2 does not model as a typed frame: Element ID, a flags byte (top-level and ordered both set),
// an entry count, then each child element ID, all null-terminated Latin-1 strings. No optional sub-frames.
func buildCTOCBody(elementID string, childElementIDs []string) []byte {
	const (
		topLevelFlag = 0x02
		orderedFlag  = 0x01
	)
	body := make([]byte, 0, len(elementID)+1+1+1+len(childElementIDs)*8)
	body = append(body, []byte(elementID)...)
	body = append(body, 0x00)
	body = append(body, byte(topLevelFlag|orderedFlag))
	body = append(body, byte(len(childElementIDs))) //nolint:gosec // G115: Embed rejects more than maxCTOCEntries (255) before this is called
	for _, id := range childElementIDs {
		body = append(body, []byte(id)...)
		body = append(body, 0x00)
	}
	return body
}
