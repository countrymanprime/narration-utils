package credits

import (
	"reflect"
	"testing"
)

func TestRenderReplacesKnownTokens(t *testing.T) {
	result := Render("[Title], written by [Author], narrated by [Narrator].", map[string]string{
		"Title": "Bad Ideas Look Great in Neon", "Author": "A. Writer", "Narrator": "You",
	})
	want := "Bad Ideas Look Great in Neon, written by A. Writer, narrated by You."
	if result.Text != want {
		t.Fatalf("Text = %q, want %q", result.Text, want)
	}
	if len(result.Unresolved) != 0 {
		t.Fatalf("Unresolved = %v, want none", result.Unresolved)
	}
	if result.Words != 13 {
		t.Fatalf("Words = %d, want 13 (matches strings.Fields on the rendered text)", result.Words)
	}
}

func TestRenderReportsUnresolvedTokensByNameAndNeverRendersThemAsEmptyText(t *testing.T) {
	result := Render("Read by [Narrator]. Copyright by [Copyright].", map[string]string{"Narrator": "You"})
	if result.Text != "Read by You. Copyright by [Copyright]." {
		t.Fatalf("an unresolved token must stay visible in the text, got %q", result.Text)
	}
	if !reflect.DeepEqual(result.Unresolved, []string{"Copyright"}) {
		t.Fatalf("Unresolved = %v, want [Copyright]", result.Unresolved)
	}
}

func TestRenderTreatsAnEmptyValueAsUnresolvedTooNotJustAMissingKey(t *testing.T) {
	result := Render("[Title]", map[string]string{"Title": ""})
	if !reflect.DeepEqual(result.Unresolved, []string{"Title"}) {
		t.Fatalf("Unresolved = %v, want [Title] (empty is not a value)", result.Unresolved)
	}
}

func TestRenderDropsAnOptionalSegmentCleanlyWhenItsTokenIsEmpty(t *testing.T) {
	result := Render("[Title]{, [Subtitle]}. Written by [Author].", map[string]string{
		"Title": "Bad Ideas Look Great in Neon", "Author": "A. Writer",
	})
	want := "Bad Ideas Look Great in Neon. Written by A. Writer."
	if result.Text != want {
		t.Fatalf("Text = %q, want %q (the optional segment must vanish with its own punctuation)", result.Text, want)
	}
	if len(result.Unresolved) != 0 {
		t.Fatalf("Unresolved = %v, want none: a dropped optional token is not an unresolved one", result.Unresolved)
	}
}

func TestRenderKeepsAnOptionalSegmentWhenItsTokenResolves(t *testing.T) {
	result := Render("[Title]{, [Subtitle]}.", map[string]string{"Title": "Neon", "Subtitle": "A Novel"})
	want := "Neon, A Novel."
	if result.Text != want {
		t.Fatalf("Text = %q, want %q", result.Text, want)
	}
}

func TestRenderDropsAnOptionalSegmentWithAnyOfSeveralTokensMissing(t *testing.T) {
	result := Render("[Title]{, Book [Book Number] of [Series]}.", map[string]string{"Title": "Neon", "Series": "The Neon Files"})
	want := "Neon."
	if result.Text != want {
		t.Fatalf("Text = %q, want %q", result.Text, want)
	}
	if len(result.Unresolved) != 0 {
		t.Fatalf("Unresolved = %v, want none", result.Unresolved)
	}
}

func TestRenderWordCountMatchesWhitespaceSplitOnTheRenderedText(t *testing.T) {
	result := Render("You have been listening to [Title]. The End.", map[string]string{"Title": "Neon"})
	if result.Words != 8 {
		t.Fatalf("Words = %d, want 8", result.Words)
	}
}

func TestRenderOnEmptyTemplateIsEmptyWithNoUnresolvedTokens(t *testing.T) {
	result := Render("", map[string]string{"Title": "Neon"})
	if result.Text != "" || result.Words != 0 || len(result.Unresolved) != 0 {
		t.Fatalf("Result = %+v, want the zero result", result)
	}
}

func TestRenderDeduplicatesRepeatedUnresolvedTokenNames(t *testing.T) {
	result := Render("[Narrator] reads for [Narrator].", nil)
	if !reflect.DeepEqual(result.Unresolved, []string{"Narrator"}) {
		t.Fatalf("Unresolved = %v, want [Narrator] once", result.Unresolved)
	}
}
