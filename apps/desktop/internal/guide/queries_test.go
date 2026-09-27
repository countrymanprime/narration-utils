package guide

import (
	"strings"
	"testing"
)

func occurrence(chapter string, paragraph int, excerpt string) map[string]any {
	return map[string]any{"chapter": chapter, "paragraph": paragraph, "excerpt": excerpt}
}

func queriesFixture() []any {
	return []any{
		map[string]any{
			"id": "entity-wren", "canonical_name": "Wren", "category": "Character", "occurrence_count": 2, "locked": false, "review_state": "reviewed",
			"pronunciation": map[string]any{"ipa": "wɹɛn", "source": "user", "confidence": "narrator", "status": "query_sent", "note": "Asked."},
			"occurrences":   []any{occurrence("Chapter 2", 7, "…Wren said…"), occurrence("Chapter 1", 3, "…met Wren…")},
			"aliases": []any{
				map[string]any{"text": "the Sparrow", "pronunciation": map[string]any{"ipa": "x", "source": "CMU dictionary", "confidence": "medium", "status": "author_confirmed"}, "occurrences": []any{occurrence("Chapter 1", 1, "…the Sparrow…")}},
				map[string]any{"text": "Wrennie", "pronunciation": map[string]any{"ipa": "", "source": "not generated", "confidence": "unknown"}, "occurrences": []any{occurrence("Chapter 1", 0, "…Wrennie…")}},
			},
		},
		map[string]any{
			"id": "entity-ash", "canonical_name": "Council of Ash", "category": "Organization", "occurrence_count": 0, "locked": true, "review_state": "reviewed",
			"pronunciation": map[string]any{"ipa": "æʃ", "source": "CMU dictionary", "confidence": "medium"},
			"occurrences":   []any{},
		},
		map[string]any{
			"id": "entity-dawn", "canonical_name": "Dawnspire", "category": "Place", "occurrence_count": 1, "locked": false, "review_state": "reviewed",
			"pronunciation": map[string]any{"ipa": "dɔn", "source": "CMU dictionary", "confidence": "medium", "status": "author_confirmed"},
			"occurrences":   []any{occurrence("Chapter 1", 2, "…Dawnspire…")},
		},
	}
}

func TestPronunciationQueriesListEveryNameNotAuthorConfirmedOnceInReadingOrder(t *testing.T) {
	got, err := serviceWithGuideFile(t, queriesFixture()).PronunciationQueries()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, row := range got {
		names = append(names, row.Name)
	}
	// Wrennie (paragraph 0), Wren (first seen at paragraph 3, not 7), then Council of Ash, which is never seen, last.
	if want := "Wrennie,Wren,Council of Ash"; strings.Join(names, ",") != want {
		t.Fatalf("names = %v, want %s", names, want)
	}
	wrennie, wren, ash := got[0], got[1], got[2]
	if wrennie.AliasIndex == nil || *wrennie.AliasIndex != 1 || wrennie.EntityID != "entity-wren" || wrennie.Entry != "Wren" {
		t.Fatalf("Wrennie = %+v", wrennie)
	}
	if wrennie.Status != "researched" || wrennie.Chapter != "Chapter 1" || wrennie.Excerpt != "…Wrennie…" {
		t.Fatalf("an alias with no status reads as researched, with its first occurrence: %+v", wrennie)
	}
	if wren.AliasIndex != nil || wren.Status != "query_sent" || wren.Note != "Asked." || wren.Source != "user" || wren.Chapter != "Chapter 1" || wren.Excerpt != "…met Wren…" {
		t.Fatalf("Wren = %+v", wren)
	}
	if ash.Chapter != "" || ash.Excerpt != "" || ash.Status != "researched" || ash.Category != "Organization" {
		t.Fatalf("Council of Ash = %+v", ash)
	}
}

func TestPronunciationQueriesWithNoStoryBibleIsEmpty(t *testing.T) {
	got, err := New(t.TempDir(), "", "", nil, nil).PronunciationQueries()
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestPronunciationQueriesCSVHasAHeaderAndOneRowPerQuery(t *testing.T) {
	queries, err := serviceWithGuideFile(t, queriesFixture()).PronunciationQueries()
	if err != nil {
		t.Fatal(err)
	}
	text := QueriesCSV(queries)
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("lines = %d:\n%s", len(lines), text)
	}
	if lines[0] != strings.Join(QueryCSVHeader, ",") {
		t.Fatalf("header = %q", lines[0])
	}
	if !strings.HasPrefix(lines[2], "Wren,Wren,Character,Chapter 1,…met Wren…,wɹɛn,Yours,query_sent,Asked.,entity-wren,") {
		t.Fatalf("Wren row = %q", lines[2])
	}
	if !strings.HasSuffix(lines[1], ",entity-wren,1") {
		t.Fatalf("an alias row carries its index: %q", lines[1])
	}
}

func TestQueriesCSVNeutralisesACellASpreadsheetWouldRunAsAFormula(t *testing.T) {
	text := QueriesCSV([]PronunciationQuery{{Name: "=HYPERLINK(\"x\")", Entry: "+1", Note: "@cmd", IPA: "-ə", Status: "researched", EntityID: "e"}})
	row := strings.Split(strings.TrimRight(text, "\n"), "\n")[1]
	for _, want := range []string{`"'=HYPERLINK(""x"")"`, "'+1", "'@cmd", "'-ə"} {
		if !strings.Contains(row, want) {
			t.Fatalf("row %q lacks %q", row, want)
		}
	}
}

func TestAnExportedFileAndAHandEditedOneReadBack(t *testing.T) {
	queries, err := serviceWithGuideFile(t, queriesFixture()).PronunciationQueries()
	if err != nil {
		t.Fatal(err)
	}
	rows, issues := ParseQueriesCSV(QueriesCSV(queries))
	if len(issues) != 0 || len(rows) != len(queries) {
		t.Fatalf("rows = %d, issues = %v", len(rows), issues)
	}
	if rows[1].EntityID != "entity-wren" || rows[1].AliasIndex != nil || rows[1].Status != "query_sent" || rows[0].AliasIndex == nil || *rows[0].AliasIndex != 1 {
		t.Fatalf("rows = %+v", rows)
	}
	// An author's edit in a spreadsheet: columns reordered, CRLF line ends, a status typed by hand, the answer in the note, a
	// row with no entry id, and a formula guard kept.
	edited := "status,word,note,entry_id,alias_index\r\n" +
		"Author confirmed,Wren,\"Rhymes with \"\"ten\"\"\",entity-wren,\r\n" +
		"author_confirmed,Somebody,,,\r\n" +
		"maybe,Wrennie,,entity-wren,1\r\n" +
		"query_sent,'-x,,entity-wren,one\r\n"
	rows, issues = ParseQueriesCSV(edited)
	if len(rows) != 1 || rows[0].Name != "Wren" || rows[0].Status != "author_confirmed" || rows[0].Note != `Rhymes with "ten"` || rows[0].AliasIndex != nil {
		t.Fatalf("rows = %+v", rows)
	}
	if len(issues) != 3 || issues[0].Line != 3 || issues[1].Line != 4 || issues[2].Line != 5 {
		t.Fatalf("issues = %+v", issues)
	}
}

func TestParseQueriesCSVNeedsAHeaderWithTheWordAndEntryIDColumns(t *testing.T) {
	if _, issues := ParseQueriesCSV("Wren,entity-wren\n"); len(issues) != 1 || issues[0].Line != 1 {
		t.Fatalf("issues = %+v", issues)
	}
}
