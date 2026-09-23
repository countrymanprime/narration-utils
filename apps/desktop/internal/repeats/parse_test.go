package repeats

import (
	"strings"
	"testing"
)

func TestParseOutputParsesGroupsAndMembersInOrder(t *testing.T) {
	text := strings.Join([]string{
		"SUMMARY|Found 1 repeated-span group(s) across 2 segment(s)",
		"SPAN_GROUP|0|3|7|2",
		"SPAN_MEMBER|0|0|{ITEM-1}|{TAKE-1}|C:/audio/a.wav|0.000|4.500|3|7|1.000|0.950|",
		"SPAN_MEMBER|0|1|{ITEM-1}|{TAKE-2}|C:/audio/b.wav|10.000|4.500|3|7|1.000|0.910|EC0",
		"",
	}, "\n")

	groups, err := ParseOutput(text)
	if err != nil {
		t.Fatalf("ParseOutput: %v", err)
	}
	if len(groups) != 1 {
		t.Fatalf("want 1 group, got %d", len(groups))
	}

	g := groups[0]
	if g.ID != 0 || g.FirstUnit != 3 || g.LastUnit != 7 {
		t.Fatalf("unexpected group header: %+v", g)
	}
	if len(g.Members) != 2 {
		t.Fatalf("want 2 members, got %d", len(g.Members))
	}

	m0, m1 := g.Members[0], g.Members[1]
	if m0.ItemIndex != 0 || m0.ItemGUID != "{ITEM-1}" || m0.TakeGUID != "{TAKE-1}" || m0.SourceFile != "C:/audio/a.wav" {
		t.Fatalf("unexpected member 0: %+v", m0)
	}
	if m0.StartOffset != 0.0 || m0.Length != 4.5 || m0.Coverage != 1.0 || m0.Quality != 0.95 || m0.ExactCopyGroup != "" {
		t.Fatalf("unexpected member 0 fields: %+v", m0)
	}
	if m1.ExactCopyGroup != "EC0" {
		t.Fatalf("want member 1 exact-copy group EC0, got %q", m1.ExactCopyGroup)
	}
}

func TestParseOutputIgnoresOrdinaryCompareLines(t *testing.T) {
	// The ordinary run() output (SUMMARY/DIFF/MARKER) and NEED_CHAPTER must
	// be silently ignored, not error - additive lines are only ever added,
	// per the PRD's Q2 evidence.
	text := strings.Join([]string{
		"SUMMARY|MATCH: 'Chapter One' (score 0.90) - 1 discrepancy marker(s)",
		"DIFF|/tmp/diff.txt",
		"MARKER|0|1.500|MISREAD|MISREAD: 'a' as 'b'|a|b|Chapter One|0|a|b|high|0.700",
		"NEED_CHAPTER|Chapter One|Chapter Two",
	}, "\n")

	groups, err := ParseOutput(text)
	if err != nil {
		t.Fatalf("ParseOutput: %v", err)
	}
	if len(groups) != 0 {
		t.Fatalf("want 0 groups from a plain compare run's output, got %d", len(groups))
	}
}

func TestParseOutputRejectsAMemberForAnUnknownGroup(t *testing.T) {
	text := "SPAN_MEMBER|9|0|{ITEM-1}|{TAKE-1}|a.wav|0|1|0|1|1.0|1.0|\n"

	if _, err := ParseOutput(text); err == nil {
		t.Fatal("want an error for a SPAN_MEMBER referencing an unparsed group")
	}
}

func TestParseOutputRejectsAMalformedLine(t *testing.T) {
	text := "SPAN_GROUP|not-a-number|3|7|2\n"

	if _, err := ParseOutput(text); err == nil {
		t.Fatal("want an error for a non-numeric SPAN_GROUP id")
	}
}
