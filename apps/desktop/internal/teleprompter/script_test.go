package teleprompter

import (
	"reflect"
	"testing"
)

// The host's copy of the sidecar's chapter script (chapter_script.load_chapter_script) and sentence bounds
// (locate.sentence_bounds), read-aloud-resume-from-daw PRD Phase 3.

const scriptManuscript = `{"documentId":"doc-1","chapters":[{"id":"c1","title":"Chapter One"},{"id":"c2","title":"Two"}],
"paragraphs":[{"id":"p1","chapterId":"c1","text":"She ran.  The door opened! \"Who?\""},{"id":"p2","chapterId":"c2","text":"Elsewhere."},
{"id":"p3","chapterId":"c1","text":"No end here\u001fat all"}]}`

func TestAChapterScriptIsTheTitleThenEachParagraphSplitOnWhitespace(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, scriptManuscript)

	script, ok := LoadChapterScript(project, "c1")

	if !ok {
		t.Fatal("chapter c1 was not found")
	}
	want := []string{"Chapter", "One", "She", "ran.", "The", "door", "opened!", `"Who?"`, "No", "end", "here", "at", "all"}
	if !reflect.DeepEqual(script.Tokens, want) {
		t.Fatalf("tokens = %q, want %q", script.Tokens, want)
	}
	// Python's str.split() also splits on the information separators (U+001C to U+001F): the index space must match.
	if !reflect.DeepEqual(script.Breaks, []int{0, 2, 8}) {
		t.Fatalf("breaks = %v", script.Breaks)
	}
	if _, ok := LoadChapterScript(project, "missing"); ok {
		t.Fatal("an unknown chapter loaded")
	}
	if _, ok := LoadChapterScript(t.TempDir(), "c1"); ok {
		t.Fatal("a project without a manuscript loaded")
	}
}

func TestSentenceAtEndsAtSentencePunctuationAndNeverCrossesAParagraph(t *testing.T) {
	project := t.TempDir()
	writeManuscript(t, project, scriptManuscript)
	script, _ := LoadChapterScript(project, "c1")

	for _, c := range []struct {
		index int
		want  Sentence
	}{
		{0, Sentence{Start: 0, End: 2, Text: "Chapter One"}},
		{3, Sentence{Start: 2, End: 4, Text: "She ran."}},
		{5, Sentence{Start: 4, End: 7, Text: "The door opened!"}},
		{7, Sentence{Start: 7, End: 8, Text: `"Who?"`}},
		{10, Sentence{Start: 8, End: 13, Text: "No end here at all"}},
	} {
		if got := script.SentenceAt(c.index); got != c.want {
			t.Fatalf("SentenceAt(%d) = %+v, want %+v", c.index, got, c.want)
		}
	}
}

func TestWordsLeftCountsOnlyTokensTheTrackerReads(t *testing.T) {
	script := ChapterScript{Tokens: []string{"The", "end.", "—", "*", "it's"}}
	for index, want := range map[int]bool{0: true, 2: true, 4: true, 5: false} {
		if got := script.WordsLeft(index); got != want {
			t.Fatalf("WordsLeft(%d) = %v, want %v", index, got, want)
		}
	}
	punctuationOnly := ChapterScript{Tokens: []string{"The", "end.", "—", "*"}}
	if punctuationOnly.WordsLeft(2) {
		t.Fatal("only punctuation is left, yet words were reported")
	}
}
