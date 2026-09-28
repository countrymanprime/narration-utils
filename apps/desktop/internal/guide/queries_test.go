package guide

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// serviceWithFakeSidecarAndEntities is serviceWithGuideFile plus a working (fake, no-op) sidecar process, for a test that
// needs ImportQueriesCSV to actually call SetPronunciationStatus, not just read the file back. The fake sidecar
// (preview_test.go's TestMain) does nothing to the guide file and exits 0 for any mode it does not know, which "ok" is,
// so a test reads back what it was called with from the log, the way the app-level pronunciation-status tests do
// (guidepronunciationdepth_test.go), never the Story Bible file, which only the real Python sidecar actually rewrites.
func serviceWithFakeSidecarAndEntities(t *testing.T, entities any) (*Service, string) {
	t.Helper()
	project := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "sidecar.log")
	t.Setenv(fakeSidecarEnv, "ok")
	t.Setenv(fakeLogEnv, logPath)
	sidecars := process.NewSupervisor()
	t.Cleanup(func() { _ = sidecars.Close() })
	service := New(project, os.Args[0], "", settings.New(project, project), sidecars)
	if err := os.MkdirAll(filepath.Dir(service.guidePath()), 0o755); err != nil {
		t.Fatal(err)
	}
	bytes, err := json.Marshal(map[string]any{"schema_version": 2, "entities": entities})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.guidePath(), bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return service, logPath
}

// sidecarCalls reads back the fake sidecar's log: one line per call, its arguments space-joined.
func sidecarCalls(t *testing.T, logPath string) []string {
	t.Helper()
	raw, err := os.ReadFile(logPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimRight(string(raw), "\n"), "\n")
}

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

// MatchQueryAnswers (prep-depth P6): a parsed answer matches an entity or alias that is still there; one that is not is
// reported by its own line, never guessed at.

func TestMatchQueryAnswersMatchesAnEntityAndAnAliasByIDAndIndex(t *testing.T) {
	entities, err := serviceWithGuideFile(t, queriesFixture()).Entities()
	if err != nil {
		t.Fatal(err)
	}
	aliasIndex := 1
	answers := []QueryAnswer{
		{Line: 2, EntityID: "entity-wren", Name: "Wren", Status: pronunciationConfirmed},
		{Line: 3, EntityID: "entity-wren", AliasIndex: &aliasIndex, Name: "Wrennie", Status: "query_sent"},
	}
	matched, issues := MatchQueryAnswers(entities, answers)
	if len(issues) != 0 {
		t.Fatalf("issues = %+v", issues)
	}
	if len(matched) != 2 || matched[0].Name != "Wren" || matched[1].Name != "Wrennie" {
		t.Fatalf("matched = %+v", matched)
	}
}

func TestMatchQueryAnswersReportsAnEntityOrAliasThatIsNoLongerThere(t *testing.T) {
	entities, err := serviceWithGuideFile(t, queriesFixture()).Entities()
	if err != nil {
		t.Fatal(err)
	}
	outOfRange := 9
	answers := []QueryAnswer{
		{Line: 2, EntityID: "entity-gone", Name: "Nobody", Status: "researched"},
		{Line: 3, EntityID: "entity-wren", AliasIndex: &outOfRange, Name: "Wrennie", Status: "researched"},
	}
	matched, issues := MatchQueryAnswers(entities, answers)
	if len(matched) != 0 {
		t.Fatalf("matched = %+v", matched)
	}
	if len(issues) != 2 || issues[0].Line != 2 || issues[1].Line != 3 {
		t.Fatalf("issues = %+v", issues)
	}
	if !strings.Contains(issues[0].Message, "Nobody") || !strings.Contains(issues[1].Message, "Wrennie") {
		t.Fatalf("issues = %+v", issues)
	}
}

// ImportQueriesCSV (prep-depth P6): applies every matched row's status and note through the same sidecar call the
// narrator's own "Mark answered" uses, and reports every row it could not use, whether ParseQueriesCSV or the match
// against the current entities rejected it, by line, sorted the way the file reads.

func TestImportQueriesCSVAppliesMatchedRowsAndReportsEveryUnusableOneByLine(t *testing.T) {
	service, logPath := serviceWithFakeSidecarAndEntities(t, queriesFixture())
	// Line 2: Wrennie (an alias) confirmed with a note. Line 3: a status ParseQueriesCSV cannot read. Line 4: Wren
	// confirmed, no note. Line 5: an entity that no longer exists.
	csv := "word,entry_id,alias_index,status,note\r\n" +
		"Wrennie,entity-wren,1,author_confirmed,Rhymes with hen\r\n" +
		"Bad,entity-wren,,not-a-status,\r\n" +
		"Wren,entity-wren,,author_confirmed,\r\n" +
		"Ghost,entity-gone,,researched,\r\n"
	applied, issues, err := service.ImportQueriesCSV(csv)
	if err != nil {
		t.Fatal(err)
	}
	if applied != 2 {
		t.Fatalf("applied = %d, issues = %v", applied, issues)
	}
	if len(issues) != 2 || !strings.HasPrefix(issues[0], "line 3:") || !strings.HasPrefix(issues[1], "line 5:") {
		t.Fatalf("issues = %v", issues)
	}
	calls := sidecarCalls(t, logPath)
	if len(calls) != 2 {
		t.Fatalf("sidecar calls = %v", calls)
	}
	if !strings.HasPrefix(calls[0], "pronunciation-status ") || !strings.Contains(calls[0], "--entity-id entity-wren") ||
		!strings.Contains(calls[0], "--status author_confirmed") || !strings.Contains(calls[0], "--note=Rhymes with hen") ||
		!strings.Contains(calls[0], "--alias-index 1") {
		t.Fatalf("Wrennie's call = %q", calls[0])
	}
	if !strings.HasPrefix(calls[1], "pronunciation-status ") || !strings.Contains(calls[1], "--entity-id entity-wren") ||
		!strings.Contains(calls[1], "--status author_confirmed") || strings.Contains(calls[1], "--alias-index") || strings.Contains(calls[1], "--note") {
		t.Fatalf("Wren's call = %q", calls[1])
	}
}

func TestImportQueriesCSVLeavesAnExistingNoteAloneWhenTheRowsNoteIsBlank(t *testing.T) {
	service, logPath := serviceWithFakeSidecarAndEntities(t, queriesFixture())
	// Wren already carries the note "Asked." (queriesFixture); a re-imported row with no note must send no --note, the
	// same "nil means leave it alone" rule GuidePronunciationSetStatus already follows for a direct edit, so the sidecar
	// never sees a blank note it would otherwise write over the one already there.
	csv := "word,entry_id,alias_index,status,note\nWren,entity-wren,,query_sent,\n"
	if applied, issues, err := service.ImportQueriesCSV(csv); err != nil || len(issues) != 0 || applied != 1 {
		t.Fatalf("applied = %d, issues = %v, err = %v", applied, issues, err)
	}
	calls := sidecarCalls(t, logPath)
	if len(calls) != 1 || strings.Contains(calls[0], "--note") {
		t.Fatalf("calls = %v, want no --note", calls)
	}
}

func TestImportQueriesCSVWithNoStoryBibleReportsEveryRowAsUnmatched(t *testing.T) {
	service := New(t.TempDir(), "", "", nil, nil)
	applied, issues, err := service.ImportQueriesCSV("word,entry_id,status\nWren,entity-wren,author_confirmed\n")
	if err != nil {
		t.Fatal(err)
	}
	if applied != 0 || len(issues) != 1 || !strings.HasPrefix(issues[0], "line 2:") {
		t.Fatalf("applied = %d, issues = %v", applied, issues)
	}
}
