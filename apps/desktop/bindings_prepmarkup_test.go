package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/prepmarkup"
)

// markupManuscript is a one-chapter manuscript the reader would show, written where the manuscript service reads it.
const markupManuscript = `{"schemaVersion":1,"documentId":"doc-1","chapters":[{"id":"c-0001","title":"Chapter One","contentKind":"narration"}],"paragraphs":[{"id":"p-000001","chapterId":"c-0001","index":0,"text":"“Off with her head!” the Queen shouted."},{"id":"p-000002","chapterId":"c-0001","index":1,"text":"The soldiers were silent."}]}`

func markupHost(t *testing.T) (*Host, string) {
	t.Helper()
	project := t.TempDir()
	writeNested(t, filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), markupManuscript)
	host := NewHost()
	next := host.config
	next.projectFolder = project
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	return host, project
}

func decodeMarkupSpan(t *testing.T) func(string, error) prepmarkup.Resolved {
	return func(payload string, err error) prepmarkup.Resolved {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var span prepmarkup.Resolved
		if err := json.Unmarshal([]byte(payload), &span); err != nil {
			t.Fatalf("%v: %s", err, payload)
		}
		return span
	}
}

// The three bindings' payloads (the goldens the UI's schemas are checked against): a fresh list, a saved span of each
// kind, and a list after the text under one of them changed.
func TestContractPrepMarkupBindings(t *testing.T) {
	host, project := markupHost(t)
	payload, err := host.PrepMarkupList("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "prep-markup-list-empty", payload)

	// "Off with her head!" after the opening curly quote: UTF-16 offsets 1..19.
	payload, err = host.PrepMarkupSave("c-0001", "p-000001", 1, 19, "character_tag", "Queen")
	checkBindingContract(t, "prep-markup-save", payload)
	tag := decodeMarkupSpan(t)(payload, err)
	if tag.AnchorText != "Off with her head!" || tag.Stale {
		t.Fatalf("saved tag = %+v", tag)
	}
	stress := decodeMarkupSpan(t)(host.PrepMarkupSave("c-0001", "p-000002", 4, 12, "stress", ""))
	decodeMarkupSpan(t)(host.PrepMarkupSave("c-0001", "p-000002", 18, 24, "pause", "long"))

	payload, err = host.PrepMarkupList("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "prep-markup-list", payload)

	// The narrator re-imports a manuscript where the soldiers became warriors: that span is stale, the others are not.
	edited := strings.Replace(markupManuscript, "The soldiers were silent.", "The warriors were silent.", 1)
	writeNested(t, filepath.Join(project, "narration-utils", "manuscript", "manuscript.json"), edited)
	payload, err = host.PrepMarkupList("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	checkBindingContract(t, "prep-markup-list-stale", payload)
	var listed prepmarkup.ChapterMarkup
	if err := json.Unmarshal([]byte(payload), &listed); err != nil {
		t.Fatal(err)
	}
	stale := 0
	for _, span := range listed.Spans {
		if span.Stale {
			stale++
			if span.ID != stress.ID {
				t.Fatalf("the wrong span went stale: %+v", span)
			}
		}
	}
	if stale != 1 {
		t.Fatalf("stale spans = %d, want 1: %s", stale, payload)
	}

	payload, err = host.PrepMarkupDelete("c-0001", stress.ID)
	if err != nil || payload != "null" {
		t.Fatalf("delete = %s, %v", payload, err)
	}
	after := decodeAnswerMarkup(t, host)
	if len(after.Spans) != 2 {
		t.Fatalf("after delete = %+v", after)
	}
}

func decodeAnswerMarkup(t *testing.T, host *Host) prepmarkup.ChapterMarkup {
	t.Helper()
	payload, err := host.PrepMarkupList("c-0001")
	if err != nil {
		t.Fatal(err)
	}
	var markup prepmarkup.ChapterMarkup
	if err := json.Unmarshal([]byte(payload), &markup); err != nil {
		t.Fatal(err)
	}
	return markup
}

func TestPrepMarkupBindingsRefuseWhatTheyCannotAnchor(t *testing.T) {
	host, _ := markupHost(t)
	if _, err := host.PrepMarkupSave("c-0001", "p-999999", 0, 3, "stress", ""); err == nil {
		t.Fatal("a span on a line that is not in the chapter was saved")
	}
	if _, err := host.PrepMarkupSave("c-0001", "p-000002", 0, 3, "shout", ""); err == nil {
		t.Fatal("an unknown kind was saved")
	}
}

func TestPrepMarkupBindingsWithNoProject(t *testing.T) {
	host := NewHost()
	if payload, err := host.PrepMarkupList("c-0001"); err != nil || payload != `{"chapterId":"c-0001","spans":[]}` {
		t.Fatalf("list with no project = %s, %v", payload, err)
	}
	if _, err := host.PrepMarkupSave("c-0001", "p-000001", 0, 3, "stress", ""); err == nil {
		t.Fatal("a save with no project succeeded")
	}
	if _, err := host.PrepMarkupDelete("c-0001", "x"); err == nil {
		t.Fatal("a delete with no project succeeded")
	}
}

// Markup is narrator data that a re-import keeps (the stale list above is what a changed line looks like), but the
// explicit Clear project data removes it with the notes.
func TestClearProjectDataRemovesPrepMarkup(t *testing.T) {
	host, project := markupHost(t)
	decodeMarkupSpan(t)(host.PrepMarkupSave("c-0001", "p-000002", 4, 12, "stress", ""))
	if _, err := os.Stat(prepmarkup.File(project)); err != nil {
		t.Fatal(err)
	}
	if _, err := host.ManuscriptClearProjectData(true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(prepmarkup.File(project)); !os.IsNotExist(err) {
		t.Fatalf("markup after Clear project data: %v", err)
	}
}
