package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/prepcompleteness"
)

// prepCompletenessManuscript has two chapters, so the rollup can show one row still open and one row complete.
const prepCompletenessManuscript = `{"schemaVersion":1,"documentId":"doc-1","chapters":[{"id":"c-0001","title":"Chapter One","contentKind":"narration"},{"id":"c-0002","title":"Chapter Two","contentKind":"narration"}],"paragraphs":[{"id":"p-000001","chapterId":"c-0001","index":0,"text":"The Queen shouted."},{"id":"p-000002","chapterId":"c-0002","index":0,"text":"The soldiers were silent."}]}`

// prepCompletenessEntities has one name still open in Chapter One (the query total this row's rollup should show),
// one confirmed in Chapter Two (so that chapter's own query count is zero), and one whose name never occurs (an
// empty Chapter, folded into the book-wide unattributed count with no row to blame).
var prepCompletenessEntities = []any{
	map[string]any{
		"id": "entity-queen", "canonical_name": "the Queen", "category": "Character", "occurrence_count": 1, "locked": false, "review_state": "reviewed",
		"pronunciation": map[string]any{"ipa": "kwiːn", "source": "cmu", "confidence": "high", "status": "researched"},
		"occurrences":   []any{map[string]any{"chapter": "Chapter One", "paragraph": 0, "excerpt": "The Queen shouted."}},
		"aliases":       []any{},
	},
	map[string]any{
		"id": "entity-soldiers", "canonical_name": "soldiers", "category": "Character", "occurrence_count": 1, "locked": false, "review_state": "reviewed",
		"pronunciation": map[string]any{"ipa": "ˈsoʊldʒərz", "source": "cmu", "confidence": "high", "status": "author_confirmed"},
		"occurrences":   []any{map[string]any{"chapter": "Chapter Two", "paragraph": 0, "excerpt": "The soldiers were silent."}},
		"aliases":       []any{},
	},
	map[string]any{
		"id": "entity-unseen", "canonical_name": "Bandersnatch", "category": "Creature", "occurrence_count": 0, "locked": false, "review_state": "reviewed",
		"pronunciation": map[string]any{"ipa": "", "source": "", "confidence": "", "status": "researched"},
		"occurrences":   []any{},
		"aliases":       []any{},
	},
}

func prepCompletenessHost(t *testing.T) *Host {
	t.Helper()
	project := t.TempDir()
	writeNested(t, filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), prepCompletenessManuscript)
	guidePath := filepath.Join(project, "ManuscriptGuide", "manuscript_guide.json")
	if err := os.MkdirAll(filepath.Dir(guidePath), 0o755); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]any{"schema_version": 2, "entities": prepCompletenessEntities})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(guidePath, body, 0o600); err != nil {
		t.Fatal(err)
	}
	host := NewHost()
	next := host.config
	next.projectFolder = project
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	return host
}

func TestPrepCompletenessSummaryRollsUpOpenQueriesAndStaleMarkupPerChapter(t *testing.T) {
	host := prepCompletenessHost(t)
	// A stale span in Chapter Two: the manuscript changes after it is placed, so Chapter Two still has open prep work
	// even though its own pronunciation query is already confirmed.
	if _, err := host.PrepMarkupSave("c-0002", "p-000002", 4, 12, "stress", ""); err != nil {
		t.Fatal(err)
	}
	edited := `{"schemaVersion":1,"documentId":"doc-1","chapters":[{"id":"c-0001","title":"Chapter One","contentKind":"narration"},{"id":"c-0002","title":"Chapter Two","contentKind":"narration"}],"paragraphs":[{"id":"p-000001","chapterId":"c-0001","index":0,"text":"The Queen shouted."},{"id":"p-000002","chapterId":"c-0002","index":0,"text":"The warriors were silent."}]}`
	writeNested(t, filepath.Join(host.config.projectFolder, "narration-utils", "manuscript", "manuscript.json"), edited)

	payload, err := host.PrepCompletenessSummary()
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "prep-completeness-summary", payload)

	var summary prepcompleteness.Summary
	if err := json.Unmarshal([]byte(payload), &summary); err != nil {
		t.Fatal(err)
	}
	if len(summary.Chapters) != 2 {
		t.Fatalf("chapters = %+v", summary.Chapters)
	}
	one, two := summary.Chapters[0], summary.Chapters[1]
	if one.ChapterID != "c-0001" || one.OpenQueries != 1 || one.StaleMarkupSpans != 0 || one.Complete {
		t.Fatalf("Chapter One = %+v", one)
	}
	if two.ChapterID != "c-0002" || two.OpenQueries != 0 || two.StaleMarkupSpans != 1 || two.Complete {
		t.Fatalf("Chapter Two = %+v", two)
	}
	want := prepcompleteness.Totals{Chapters: 2, CompleteChapters: 0, OpenQueries: 2, StaleMarkupSpans: 1, UnattributedQueries: 1}
	if summary.Totals != want {
		t.Fatalf("totals = %+v, want %+v", summary.Totals, want)
	}
}

func TestPrepCompletenessSummaryWithNoProjectIsEmpty(t *testing.T) {
	host := NewHost()
	payload, err := host.PrepCompletenessSummary()
	if err != nil {
		t.Fatal(err)
	}
	if payload != `{"chapters":[],"totals":{"chapters":0,"completeChapters":0,"openQueries":0,"staleMarkupSpans":0,"unattributedQueries":0}}` {
		t.Fatalf("payload = %s", payload)
	}
}

func TestPrepCompletenessSummaryWithNoStoryBibleYetIsAllComplete(t *testing.T) {
	project := t.TempDir()
	writeNested(t, filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), prepCompletenessManuscript)
	host := NewHost()
	next := host.config
	next.projectFolder = project
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	payload, err := host.PrepCompletenessSummary()
	if err != nil {
		t.Fatal(err)
	}
	var summary prepcompleteness.Summary
	if err := json.Unmarshal([]byte(payload), &summary); err != nil {
		t.Fatal(err)
	}
	if len(summary.Chapters) != 2 {
		t.Fatalf("chapters = %+v", summary.Chapters)
	}
	for _, chapter := range summary.Chapters {
		if !chapter.Complete || chapter.OpenQueries != 0 || chapter.StaleMarkupSpans != 0 {
			t.Fatalf("chapter = %+v, want complete with no Story Bible yet", chapter)
		}
	}
}
