package pickups

import (
	"reflect"
	"testing"
)

func TestParseCSVParsesStartNoteTagRows(t *testing.T) {
	rows, issues := ParseCSV("1.5,Mispronounced,narrator\n9.25,Second pickup,\n")
	if len(issues) != 0 {
		t.Fatalf("issues = %#v", issues)
	}
	want := []Row{{Start: 1.5, Note: "Mispronounced", Tag: "narrator"}, {Start: 9.25, Note: "Second pickup", Tag: ""}}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("rows = %#v, want %#v", rows, want)
	}
}

func TestParseCSVSkipsAHeaderRow(t *testing.T) {
	rows, issues := ParseCSV("start,note,tag\n1.5,Mispronounced,narrator\n")
	if len(issues) != 0 {
		t.Fatalf("issues = %#v", issues)
	}
	if len(rows) != 1 || rows[0].Start != 1.5 {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestParseCSVAllowsATagLessTwoColumnRow(t *testing.T) {
	rows, issues := ParseCSV("2,Only a note\n")
	if len(issues) != 0 {
		t.Fatalf("issues = %#v", issues)
	}
	if len(rows) != 1 || rows[0].Tag != "" || rows[0].Note != "Only a note" {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestParseCSVSkipsBlankLines(t *testing.T) {
	rows, issues := ParseCSV("1,First\n\n2,Second\n")
	if len(issues) != 0 {
		t.Fatalf("issues = %#v", issues)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %#v", rows)
	}
}

func TestParseCSVReportsANonNumericStartWithoutStoppingTheRest(t *testing.T) {
	rows, issues := ParseCSV("not-a-number,First\n2,Second\n")
	if len(rows) != 1 || rows[0].Note != "Second" {
		t.Fatalf("rows = %#v", rows)
	}
	if len(issues) != 1 || issues[0].Line != 1 {
		t.Fatalf("issues = %#v", issues)
	}
}

func TestParseCSVRejectsANegativeStart(t *testing.T) {
	_, issues := ParseCSV("-1,First\n")
	if len(issues) != 1 {
		t.Fatalf("issues = %#v", issues)
	}
}

func TestParseCSVRejectsNonFiniteStarts(t *testing.T) {
	for _, value := range []string{"NaN", "Inf", "-Inf", "Infinity"} {
		_, issues := ParseCSV(value + ",First\n")
		if len(issues) != 1 {
			t.Fatalf("%s: issues = %#v", value, issues)
		}
	}
}

func TestParseCSVRejectsATooShortRow(t *testing.T) {
	_, issues := ParseCSV("1.5\n")
	if len(issues) != 1 {
		t.Fatalf("issues = %#v", issues)
	}
}

func TestParseCSVRejectsAnEmptyNote(t *testing.T) {
	_, issues := ParseCSV("1.5, ,narrator\n")
	if len(issues) != 1 {
		t.Fatalf("issues = %#v", issues)
	}
}

func TestParseCSVRejectsATagContainingAPipe(t *testing.T) {
	_, issues := ParseCSV("1.5,A note,tag|with|pipes\n")
	if len(issues) != 1 {
		t.Fatalf("issues = %#v", issues)
	}
}

func TestParseCSVHandlesCRLFLineEndingsAndQuotedCommas(t *testing.T) {
	rows, issues := ParseCSV("1.5,\"Mispronounced, badly\",narrator\r\n2,Second\r\n")
	if len(issues) != 0 {
		t.Fatalf("issues = %#v", issues)
	}
	want := []Row{{Start: 1.5, Note: "Mispronounced, badly", Tag: "narrator"}, {Start: 2, Note: "Second", Tag: ""}}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("rows = %#v, want %#v", rows, want)
	}
}

func TestParseCSVOnEmptyInputReturnsNoRowsAndNoIssues(t *testing.T) {
	rows, issues := ParseCSV("")
	if len(rows) != 0 || len(issues) != 0 {
		t.Fatalf("rows = %#v, issues = %#v", rows, issues)
	}
}
