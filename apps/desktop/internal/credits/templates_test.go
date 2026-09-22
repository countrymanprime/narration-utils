package credits

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestListSeedsTheShippedDefaultTemplatesOnAFreshStore(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(templates) != len(defaultTemplates) {
		t.Fatalf("List() = %d templates, want the %d shipped defaults", len(templates), len(defaultTemplates))
	}
	var kinds []string
	for _, tpl := range templates {
		if !tpl.BuiltIn {
			t.Fatalf("shipped template %q is not marked BuiltIn", tpl.Name)
		}
		kinds = append(kinds, tpl.Kind)
	}
	if !contains(kinds, "opening") || !contains(kinds, "closing") {
		t.Fatalf("kinds = %v, want at least one opening and one closing default", kinds)
	}
}

func TestSaveAddsANewTemplateAndListReturnsIt(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	saved, err := store.Save(Template{Kind: "opening", Name: "My studio's opening", Body: "[Title], by [Author]."})
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" {
		t.Fatal("Save did not assign an ID to a new template")
	}
	if saved.BuiltIn {
		t.Fatal("a narrator-added template must not be marked BuiltIn")
	}
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if !containsID(templates, saved.ID) {
		t.Fatalf("List() = %v, want it to include the saved template %s", templates, saved.ID)
	}
}

func TestSaveWithAnExistingIDUpdatesInPlace(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	saved, err := store.Save(Template{Kind: "closing", Name: "Draft", Body: "[Title]"})
	if err != nil {
		t.Fatal(err)
	}
	saved.Body = "The End: [Title]"
	updated, err := store.Save(saved)
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != saved.ID {
		t.Fatalf("updating an existing template must keep its ID, got %s want %s", updated.ID, saved.ID)
	}
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, tpl := range templates {
		if tpl.ID == saved.ID {
			count++
			if tpl.Body != "The End: [Title]" {
				t.Fatalf("Body = %q, want the update to stick", tpl.Body)
			}
		}
	}
	if count != 1 {
		t.Fatalf("found %d templates with ID %s, want exactly 1 (update, not append)", count, saved.ID)
	}
}

func TestDuplicateCopiesATemplateAsANewNonBuiltInEntry(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	original := templates[0]
	duplicate, err := store.Duplicate(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate.ID == original.ID {
		t.Fatal("Duplicate must assign a new ID")
	}
	if duplicate.BuiltIn {
		t.Fatal("a duplicate of a built-in template must be editable (not BuiltIn), even though the original ships built-in")
	}
	if duplicate.Body != original.Body || duplicate.Kind != original.Kind {
		t.Fatalf("Duplicate = %+v, want the same body and kind as %+v", duplicate, original)
	}
	if !strings.Contains(duplicate.Name, original.Name) {
		t.Fatalf("Name = %q, want it to reference the original name %q", duplicate.Name, original.Name)
	}
}

func TestDeleteRemovesATemplate(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	saved, err := store.Save(Template{Kind: "opening", Name: "Mine", Body: "[Title]"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(saved.ID); err != nil {
		t.Fatal(err)
	}
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if containsID(templates, saved.ID) {
		t.Fatalf("List() = %v, want %s gone after Delete", templates, saved.ID)
	}
}

func TestDeletingABuiltInTemplateIsAllowedTheNarratorOwnsTheLibrary(t *testing.T) {
	store := NewTemplateStore(filepath.Join(t.TempDir(), "credit-templates.json"))
	templates, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	victim := templates[0]
	if err := store.Delete(victim.ID); err != nil {
		t.Fatal(err)
	}
	templates, err = store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(templates) != len(defaultTemplates)-1 {
		t.Fatalf("List() = %d templates, want one fewer than the %d defaults", len(templates), len(defaultTemplates))
	}
}

func TestTemplatesSurviveAcrossStoreInstancesTheFileIsThePersistentCopy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credit-templates.json")
	first := NewTemplateStore(path)
	saved, err := first.Save(Template{Kind: "opening", Name: "Mine", Body: "[Title]"})
	if err != nil {
		t.Fatal(err)
	}
	second := NewTemplateStore(path)
	templates, err := second.List()
	if err != nil {
		t.Fatal(err)
	}
	if !containsID(templates, saved.ID) {
		t.Fatalf("a fresh Store over the same path must see the earlier save: %v", templates)
	}
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

func containsID(list []Template, id string) bool {
	for _, item := range list {
		if item.ID == id {
			return true
		}
	}
	return false
}
