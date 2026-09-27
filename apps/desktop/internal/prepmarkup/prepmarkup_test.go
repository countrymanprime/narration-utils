package prepmarkup

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"
)

func utf16Units(text string) []uint16 { return utf16.Encode([]rune(text)) }

func decodeUnits(units []uint16) []rune { return utf16.Decode(units) }

// book is a stand-in manuscript: chapter id -> its paragraphs, which a test edits between calls the way a re-import or a
// Manuscript Guide rebuild would change the text the host reads back.
type book map[string][]Paragraph

func (b book) paragraphs(chapterID string) ([]Paragraph, error) {
	paragraphs, ok := b[chapterID]
	if !ok {
		return nil, errors.New("unknown chapter")
	}
	return paragraphs, nil
}

func newTestService(t *testing.T, manuscript book) (*Service, string) {
	t.Helper()
	project := t.TempDir()
	return New(Config{Project: project, Paragraphs: manuscript.paragraphs}), project
}

func sampleBook() book {
	return book{
		"c1": {
			{ID: "p1", Index: 0, Text: "“Look out now, Five! Don’t go splashing paint over me like that!”"},
			{ID: "p2", Index: 1, Text: "The soldiers were silent, and looked at Alice."},
		},
		"c2": {{ID: "p9", Index: 2, Text: "An unrelated chapter."}},
	}
}

func mustSave(t *testing.T, service *Service, chapterID, paragraphID string, start, end int, kind, value string) Resolved {
	t.Helper()
	span, err := service.Save(chapterID, paragraphID, start, end, kind, value)
	if err != nil {
		t.Fatalf("Save(%s, %s, %d, %d, %s, %q): %v", chapterID, paragraphID, start, end, kind, value, err)
	}
	return span
}

func mustList(t *testing.T, service *Service, chapterID string) []Resolved {
	t.Helper()
	markup, err := service.List(chapterID)
	if err != nil {
		t.Fatalf("List(%s): %v", chapterID, err)
	}
	if markup.ChapterID != chapterID {
		t.Fatalf("List(%s).ChapterID = %q", chapterID, markup.ChapterID)
	}
	return markup.Spans
}

func TestSaveRecordsTheTextUnderTheSpanInUTF16Offsets(t *testing.T) {
	service, project := newTestService(t, sampleBook())
	// "“Look out now, Five!" - the opening curly quote is one UTF-16 unit, like a JS string index.
	span := mustSave(t, service, "c1", "p1", 15, 20, "stress", "")
	if span.AnchorText != "Five!" || span.Start != 15 || span.End != 20 || span.Stale || span.Kind != Stress {
		t.Fatalf("saved span = %+v", span)
	}
	if span.Paragraph == nil || *span.Paragraph != 0 || span.ChapterID != "c1" || span.ID == "" {
		t.Fatalf("saved span identity = %+v", span)
	}
	if _, err := os.Stat(File(project)); err != nil {
		t.Fatalf("markup file not written at %s: %v", File(project), err)
	}
}

func TestSaveTrimsWhitespaceAtTheEdgesOfTheSelection(t *testing.T) {
	service, _ := newTestService(t, sampleBook())
	// " Five! " with the spaces either side.
	span := mustSave(t, service, "c1", "p1", 14, 21, "pause", "short")
	if span.Start != 15 || span.End != 20 || span.AnchorText != "Five!" {
		t.Fatalf("trimmed span = %+v", span)
	}
}

func TestSaveRejectsWhatItCannotAnchor(t *testing.T) {
	service, _ := newTestService(t, sampleBook())
	cases := []struct {
		name                     string
		chapter, paragraph       string
		start, end               int
		kind, value, wantMessage string
	}{
		{"unknown chapter", "nope", "p1", 0, 4, "stress", "", "chapter"},
		{"paragraph of another chapter", "c1", "p9", 0, 4, "stress", "", "line"},
		{"empty range", "c1", "p1", 4, 4, "stress", "", "range"},
		{"negative start", "c1", "p1", -1, 4, "stress", "", "range"},
		{"past the end", "c1", "p2", 0, 400, "stress", "", "range"},
		{"only whitespace", "c1", "p1", 5, 6, "stress", "", "words"},
		{"unknown kind", "c1", "p1", 1, 5, "shout", "", "kind"},
		{"stress with a value", "c1", "p1", 1, 5, "stress", "x", "value"},
		{"pause without a length", "c1", "p1", 1, 5, "pause", "", "pause"},
		{"pause with an unknown length", "c1", "p1", 1, 5, "pause", "forever", "pause"},
		{"tag without a name", "c1", "p1", 1, 5, "character_tag", "  ", "name"},
		{"tag with a long name", "c1", "p1", 1, 5, "character_tag", strings.Repeat("x", maxValueRunes+1), "name"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Save(test.chapter, test.paragraph, test.start, test.end, test.kind, test.value)
			if err == nil || !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("Save error = %v, want one mentioning %q", err, test.wantMessage)
			}
		})
	}
	if spans := mustList(t, service, "c1"); len(spans) != 0 {
		t.Fatalf("a refused save left spans behind: %+v", spans)
	}
}

func TestSaveRejectsAnOffsetInsideASurrogatePair(t *testing.T) {
	service, _ := newTestService(t, book{"c1": {{ID: "p1", Text: "a😀b"}}})
	if _, err := service.Save("c1", "p1", 2, 4, "stress", ""); err == nil {
		t.Fatal("an offset between the two halves of an emoji was accepted")
	}
	span := mustSave(t, service, "c1", "p1", 1, 4, "stress", "")
	if span.AnchorText != "😀b" {
		t.Fatalf("anchor = %q", span.AnchorText)
	}
}

func TestSaveOfTheSameMarkTwiceKeepsOne(t *testing.T) {
	service, _ := newTestService(t, sampleBook())
	first := mustSave(t, service, "c1", "p1", 15, 20, "character_tag", "Five")
	second := mustSave(t, service, "c1", "p1", 15, 20, "character_tag", " Five ")
	if first.ID != second.ID {
		t.Fatalf("a repeated save made a second span: %s, %s", first.ID, second.ID)
	}
	if spans := mustList(t, service, "c1"); len(spans) != 1 || spans[0].Value != "Five" {
		t.Fatalf("spans = %+v", spans)
	}
}

func TestListReturnsOnlyTheChapterAskedForInTextOrder(t *testing.T) {
	service, _ := newTestService(t, sampleBook())
	mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	mustSave(t, service, "c1", "p1", 15, 20, "pause", "long")
	mustSave(t, service, "c2", "p9", 3, 12, "stress", "")
	spans := mustList(t, service, "c1")
	if len(spans) != 2 || spans[0].ParagraphID != "p1" || spans[1].ParagraphID != "p2" {
		t.Fatalf("c1 spans = %+v", spans)
	}
	if spans := mustList(t, service, "c3"); len(spans) != 0 {
		t.Fatalf("a chapter with nothing saved = %+v", spans)
	}
}

// Phase 5's first test: a span survives an edit to an unrelated chapter, and a rebuild that leaves the text alone.
func TestASpanSurvivesAnEditElsewhere(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	saved := mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	manuscript["c2"] = []Paragraph{{ID: "p9", Index: 2, Text: "A completely rewritten chapter."}}
	// The other paragraph of the same chapter changes too: markup is per line, so it does not care.
	manuscript["c1"][0].Text = "A different first line."
	spans := mustList(t, service, "c1")
	if len(spans) != 1 || spans[0].Stale || spans[0].Start != saved.Start || spans[0].End != saved.End || spans[0].AnchorText != "soldiers" {
		t.Fatalf("after an unrelated edit = %+v", spans)
	}
}

// Phase 5's second test: a span over an edited region is reported stale, at its stored offsets, never moved.
func TestASpanOverAnEditedRegionIsStale(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	manuscript["c1"][1].Text = "The warriors were silent, and looked at Alice."
	spans := mustList(t, service, "c1")
	if len(spans) != 1 || !spans[0].Stale || spans[0].StaleReason != StaleTextChanged || spans[0].Start != 4 || spans[0].End != 12 {
		t.Fatalf("after editing the marked words = %+v", spans)
	}
}

func TestASpanWhoseTextMovedIsStaleNotRepositioned(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	// The same words, now later in the line: Q6 reports this rather than guessing where the mark belongs.
	manuscript["c1"][1].Text = "At once the soldiers were silent, and looked at Alice."
	spans := mustList(t, service, "c1")
	if len(spans) != 1 || !spans[0].Stale {
		t.Fatalf("after the words moved = %+v", spans)
	}
}

func TestASpanPastTheEndOfAShortenedLineIsStale(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	mustSave(t, service, "c1", "p2", 40, 46, "stress", "")
	manuscript["c1"][1].Text = "The soldiers were silent."
	if spans := mustList(t, service, "c1"); len(spans) != 1 || !spans[0].Stale {
		t.Fatalf("after shortening the line = %+v", spans)
	}
}

func TestASpanWhoseLineIsGoneIsStaleWithNoParagraph(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	manuscript["c1"] = manuscript["c1"][:1]
	spans := mustList(t, service, "c1")
	if len(spans) != 1 || !spans[0].Stale || spans[0].StaleReason != StaleParagraphMissing || spans[0].Paragraph != nil {
		t.Fatalf("after the line was removed = %+v", spans)
	}
}

// Phase 5's third test: whitespace-only edits do not flag staleness, inside the span or before it.
func TestWhitespaceOnlyEditsAreNotStale(t *testing.T) {
	cases := []struct{ name, edited string }{
		{"a doubled space inside the span", "The soldiers  were silent, and looked at Alice."},
		{"a line break inside the span", "The soldiers\nwere silent, and looked at Alice."},
		{"spaces added before the span", "The   soldiers were silent, and looked at Alice."},
		{"leading indentation", "\t  The soldiers were silent, and looked at Alice."},
		{"a space removed before the span", "Thesoldiers were silent, and looked at Alice."},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			manuscript := sampleBook()
			service, _ := newTestService(t, manuscript)
			mustSave(t, service, "c1", "p2", 4, 17, "character_tag", "Narrator") // "soldiers were"
			manuscript["c1"][1].Text = test.edited
			spans := mustList(t, service, "c1")
			if len(spans) != 1 || spans[0].Stale {
				t.Fatalf("after %s = %+v", test.name, spans)
			}
			units := utf16Units(test.edited)
			got := string(decodeUnits(units[spans[0].Start:spans[0].End]))
			if strings.Join(strings.Fields(got), " ") != "soldiers were" {
				t.Fatalf("resolved span covers %q in %q", got, test.edited)
			}
		})
	}
}

// Phase 5's fourth test: a stale span can be deleted without the original text.
func TestDeletingAStaleSpanNeedsNoOriginalText(t *testing.T) {
	manuscript := sampleBook()
	service, _ := newTestService(t, manuscript)
	stale := mustSave(t, service, "c1", "p2", 4, 12, "stress", "")
	kept := mustSave(t, service, "c1", "p1", 15, 20, "stress", "")
	manuscript["c1"] = []Paragraph{manuscript["c1"][0]}
	if err := service.Delete("c1", stale.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	spans := mustList(t, service, "c1")
	if len(spans) != 1 || spans[0].ID != kept.ID {
		t.Fatalf("after deleting the stale span = %+v", spans)
	}
	// Deleting it again, or from the wrong chapter, changes nothing and is not an error.
	if err := service.Delete("c1", stale.ID); err != nil {
		t.Fatalf("second Delete: %v", err)
	}
	if err := service.Delete("c2", kept.ID); err != nil {
		t.Fatalf("Delete from another chapter: %v", err)
	}
	if spans := mustList(t, service, "c1"); len(spans) != 1 {
		t.Fatalf("a delete from another chapter removed it: %+v", spans)
	}
}

func TestTheFileIsAPlainVersionedChapterKeyedDocument(t *testing.T) {
	service, project := newTestService(t, sampleBook())
	mustSave(t, service, "c1", "p1", 15, 20, "pause", "short")
	raw, err := os.ReadFile(File(project))
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		SchemaVersion int                         `json:"schemaVersion"`
		Chapters      map[string][]map[string]any `json:"chapters"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.SchemaVersion != SchemaVersion || len(decoded.Chapters["c1"]) != 1 {
		t.Fatalf("file = %s", raw)
	}
	stored := decoded.Chapters["c1"][0]
	for _, key := range []string{"id", "paragraphId", "start", "end", "anchorText", "kind", "value", "createdAt"} {
		if _, ok := stored[key]; !ok {
			t.Errorf("stored span has no %q: %s", key, raw)
		}
	}
	// Stale is worked out on every read, never stored: the file holds only what the narrator placed.
	if _, ok := stored["stale"]; ok {
		t.Errorf("stale was stored: %s", raw)
	}
}

func TestAFileFromANewerAppIsRefusedAndKept(t *testing.T) {
	service, project := newTestService(t, sampleBook())
	if err := os.MkdirAll(filepath.Dir(File(project)), 0o755); err != nil {
		t.Fatal(err)
	}
	newer := []byte(`{"schemaVersion": 99, "chapters": {}}`)
	if err := os.WriteFile(File(project), newer, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.List("c1"); err == nil || !strings.Contains(err.Error(), "newer version") {
		t.Fatalf("List of a newer file = %v", err)
	}
	if _, err := service.Save("c1", "p1", 15, 20, "stress", ""); err == nil {
		t.Fatal("Save over a newer file succeeded")
	}
	if raw, _ := os.ReadFile(File(project)); string(raw) != string(newer) {
		t.Fatalf("the newer file was overwritten: %s", raw)
	}
}

func TestACorruptFileIsKeptAsideAndAFreshOneStarted(t *testing.T) {
	service, project := newTestService(t, sampleBook())
	if err := os.MkdirAll(filepath.Dir(File(project)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(File(project), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if spans := mustList(t, service, "c1"); len(spans) != 0 {
		t.Fatalf("spans from a corrupt file = %+v", spans)
	}
	kept, _ := filepath.Glob(File(project) + ".corrupt-*")
	if len(kept) != 1 {
		t.Fatalf("corrupt copies = %v", kept)
	}
	mustSave(t, service, "c1", "p1", 15, 20, "stress", "")
}

func TestAHandEditedSpanWithoutItsWhitespaceIndexIsCheckedAtItsOffsets(t *testing.T) {
	manuscript := sampleBook()
	service, project := newTestService(t, manuscript)
	if err := os.MkdirAll(filepath.Dir(File(project)), 0o755); err != nil {
		t.Fatal(err)
	}
	hand := `{"schemaVersion":1,"chapters":{"c1":[{"id":"h1","paragraphId":"p2","start":4,"end":12,"anchorText":"soldiers","kind":"stress"},{"id":"h2","paragraphId":"p2","start":0,"end":3,"anchorText":"Two","kind":"stress"}]}}`
	if err := os.WriteFile(File(project), []byte(hand), 0o600); err != nil {
		t.Fatal(err)
	}
	spans := mustList(t, service, "c1")
	if len(spans) != 2 || spans[0].ID != "h2" || !spans[0].Stale || spans[1].ID != "h1" || spans[1].Stale {
		t.Fatalf("hand-edited spans = %+v", spans)
	}
}

func TestWithNoProjectNothingIsSaved(t *testing.T) {
	service := New(Config{Paragraphs: sampleBook().paragraphs})
	if _, err := service.Save("c1", "p1", 15, 20, "stress", ""); err == nil {
		t.Fatal("Save with no project succeeded")
	}
	markup, err := service.List("c1")
	if err != nil || len(markup.Spans) != 0 {
		t.Fatalf("List with no project = %+v, %v", markup, err)
	}
}

func TestTheFileIsNotReadIntoAnyError(t *testing.T) {
	// Manuscript text can be in the file; an error names the file, never its content.
	service, project := newTestService(t, sampleBook())
	if err := os.MkdirAll(filepath.Dir(File(project)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(File(project), []byte(`{"schemaVersion": 7, "chapters": {"c1": [{"anchorText": "secret words"}]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := service.List("c1")
	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("error = %v", err)
	}
}
