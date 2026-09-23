package coverage

import (
	"errors"
	"testing"
)

func manuscriptData(paragraphs ...any) map[string]any {
	return map[string]any{
		"documentId": "doc-1",
		"chapters":   []any{map[string]any{"id": "c-0001", "title": "One", "subtitle": "The Pool", "contentKind": "narration"}},
		"paragraphs": paragraphs,
	}
}

func paragraph(id, text string) map[string]any {
	return map[string]any{"id": id, "chapterId": "c-0001", "text": text}
}

func TestTheChapterHashFollowsTheTextAndTheParagraphIds(t *testing.T) {
	base, err := chapterBasis(manuscriptData(paragraph("p-000001", "Alice."), paragraph("p-000002", "Rabbit.")), "c-0001")
	if err != nil {
		t.Fatal(err)
	}
	if base.DocumentID != "doc-1" || base.Title != "One" || base.Hash == "" {
		t.Fatalf("basis = %+v", base)
	}
	variants := map[string]map[string]any{
		"a text edit":         manuscriptData(paragraph("p-000001", "Alice!"), paragraph("p-000002", "Rabbit.")),
		"a paragraph id":      manuscriptData(paragraph("p-000009", "Alice."), paragraph("p-000002", "Rabbit.")),
		"a paragraph removed": manuscriptData(paragraph("p-000001", "Alice.")),
		"a merged paragraph":  manuscriptData(paragraph("p-000001", "Alice.Rabbit.")),
	}
	for name, data := range variants {
		changed, err := chapterBasis(data, "c-0001")
		if err != nil || changed.Hash == base.Hash {
			t.Fatalf("%s must change the hash (%v)", name, err)
		}
	}
	same, _ := chapterBasis(manuscriptData(paragraph("p-000001", "Alice."), map[string]any{"id": "p-x", "chapterId": "c-0002", "text": "Other."}, paragraph("p-000002", "Rabbit.")), "c-0001")
	if same.Hash != base.Hash {
		t.Fatal("another chapter's paragraph must not change the hash")
	}
}

func TestAChapterWithNoParagraphsOrNoDocumentIsRefused(t *testing.T) {
	for name, data := range map[string]map[string]any{
		"no paragraphs": manuscriptData(),
		"no document":   {"chapters": []any{}},
	} {
		_, err := chapterBasis(data, "c-0001")
		var refusal *UnknownError
		if !errors.As(err, &refusal) || refusal.Error() == "" {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
}

func TestReasonOfIgnoresOtherErrors(t *testing.T) {
	if _, ok := ReasonOf(errors.New("plain")); ok {
		t.Fatal("a plain error has no reason")
	}
}
