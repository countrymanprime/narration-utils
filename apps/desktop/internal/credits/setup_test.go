package credits

import (
	"reflect"
	"testing"
)

// The credits setup prompt asks only for the tokens the credits the app reads leave unresolved
// (credits-token-setup-and-front-matter-detection PRD Phase 2, CS4 A).

var setupTemplates = []Template{
	{ID: "o1", Kind: "opening", Body: "[Title], written by [Author], narrated by [Narrator]."},
	{ID: "o2", Kind: "opening", Body: "[Series] book [Book Number]."}, // not the first opening: never read
	{ID: "a1", Kind: "chapter_announcement", Body: "[Chapter]{: [Chapter Title]}."},
	{ID: "c1", Kind: "closing", Body: "Copyright [Year] by [Copyright Holder]. [Title] is over."},
}

func TestSetupFieldsAreTheUnresolvedTokensOfTheFirstOpeningAndClosing(t *testing.T) {
	candidates := []Candidate{
		{Token: TokenTitle, Value: "After the Applause", Source: "front matter", Confidence: ConfidenceHigh},
		{Token: TokenYear, Value: "2026", Source: "copyright line", Confidence: ConfidenceHigh},
		{Token: TokenSeries, Value: "Ember", Source: "front matter", Confidence: ConfidenceLow},
	}

	fields := SetupFields(setupTemplates, Values{Author: "Adrian Crow"}, "", candidates)

	var got []string
	for _, field := range fields {
		got = append(got, field.Token+"/"+field.Field)
	}
	want := []string{"Title/title", "Narrator/narrator", "Year/year", "Copyright Holder/copyrightHolder"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	if fields[0].Candidate == nil || fields[0].Candidate.Value != "After the Applause" || fields[2].Candidate == nil || fields[1].Candidate != nil || fields[3].Candidate != nil {
		t.Fatalf("candidates = %+v", fields)
	}
}

func TestTheGlobalNarratorResolvesNarratorAndNoTemplatesAskNothing(t *testing.T) {
	fields := SetupFields(setupTemplates[:1], Values{Title: "T", Author: "A"}, "Ada Finch", nil)
	if len(fields) != 0 {
		t.Fatalf("fields = %+v", fields)
	}
	if fields := SetupFields(nil, Values{}, "", nil); len(fields) != 0 {
		t.Fatalf("no templates asked for %+v", fields)
	}
}

func TestFillEmptyNeverOverwritesASetValue(t *testing.T) {
	values := Values{Title: "Set by the narrator", Narrator: ""}

	filled, changed, err := values.FillEmpty(map[string]string{"title": "Detected", "author": " Adrian Crow ", "narrator": "Ada", "year": ""})

	if err != nil {
		t.Fatal(err)
	}
	if filled.Title != "Set by the narrator" || filled.Author != "Adrian Crow" || filled.Narrator != "Ada" || filled.Year != "" {
		t.Fatalf("filled = %+v", filled)
	}
	if !reflect.DeepEqual(changed, []string{"author", "narrator"}) {
		t.Fatalf("changed = %v", changed)
	}
	if _, _, err := values.FillEmpty(map[string]string{"isbn": "123"}); err == nil {
		t.Fatal("an unknown field was accepted")
	}
}

func TestOpenCandidatesDropsTokensTheProjectAlreadySets(t *testing.T) {
	candidates := []Candidate{{Token: TokenTitle, Value: "A"}, {Token: TokenCopyrightHolder, Value: "B"}, {Token: TokenAuthor, Value: "C"}}

	open := OpenCandidates(candidates, Values{Title: "Set", CopyrightHolder: "Set"})

	if len(open) != 1 || open[0].Token != TokenAuthor {
		t.Fatalf("open = %+v", open)
	}
}
