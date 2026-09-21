package bridge

import (
	"strings"
	"testing"
)

// Real events, field for field, as integrations/reaper/tests/compare_test.lua and line_identity_test.lua pin them: the harness proves
// what Lua emits, and these prove what Go accepts, so the two halves of the protocol are tied to the same lines.
var realEvents = map[string][]string{
	"COMPARE_PREPARED":      {"COMPARE_PREPARED", "r1", "C:/s/manifest.json", "C:/p/narration-utils/manuscript/manuscript.json", "Narrator", "C:/s/diff.txt", "3"},
	"COMPARE_MARKER":        {"COMPARE_MARKER", "r1", "0@12.500000", "MISREAD", "MISREAD: alice", "Alice", "Alyss", "102.5", "0", "Chapter 1", "4", "script ctx", "audio ctx", "pending", "", "12.5"},
	"COMPARE_INSPECTED":     {"COMPARE_INSPECTED", "r1", "2 discrepancy(s) found.", "2", "0"},
	"COMPARE_EXPORT_MARKER": {"COMPARE_EXPORT_MARKER", "r1", "0@12.500000", "exported", ""},
	"COMPARE_EXPORTED":      {"COMPARE_EXPORTED", "r1", "2", "1"},
	"ERROR":                 {"ERROR", "r1", "Transcript results were not found."},
	"LINES_STAMPED":         {"LINES_STAMPED", "t1", "3", "0", "1", "0"},
	"LINES_READ":            {"LINES_READ", "t1", "C:/s/lines.txt", "12"},
	"LINES_STALE":           {"LINES_STALE", "t1", "{AAAAAAAA-0000-4000-8000-000000000001}"},
	"LINES_CONFLICT":        {"LINES_CONFLICT", "t1", "{AAAAAAAA-0000-4000-8000-000000000002}"},
	"REGIONS_CREATED":       {"REGIONS_CREATED", "t1", "4", "0", "0"},
}

func TestEveryRealEventPassesItsTable(t *testing.T) {
	for tag, fields := range realEvents {
		if err := CheckEvent(fields); err != nil {
			t.Errorf("%s: %v", tag, err)
		}
	}
}

func TestTheTableKnowsEveryTagTheBridgeEmits(t *testing.T) {
	for tag := range realEvents {
		if _, known := eventSpecs[tag]; !known {
			t.Errorf("%s is emitted by the bridge but has no entry in the table", tag)
		}
	}
	for tag := range eventSpecs {
		if _, real := realEvents[tag]; !real {
			t.Errorf("%s is in the table but no real event pins it", tag)
		}
	}
}

func TestATagThatIsNotInTheTableIsPassedThrough(t *testing.T) {
	// A newer script may emit an event this host does not know yet: additive, so no error.
	if err := CheckEvent([]string{"SOMETHING_NEW", "r1", "x"}); err != nil {
		t.Fatalf("an unknown tag must not be an error: %v", err)
	}
}

func TestATruncatedMarkerIsAnErrorThatNamesTheEventAndCountsTheFields(t *testing.T) {
	line := realEvents["COMPARE_MARKER"][:6]
	err := CheckEvent(line)
	if err == nil {
		t.Fatal("a marker cut after the audio text must be an error, not a row of zeros")
	}
	for _, want := range []string{"COMPARE_MARKER", "6", "9"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q does not mention %q", err, want)
		}
	}
}

func TestAnOlderScriptThatSendsFewerOptionalMarkerFieldsIsAccepted(t *testing.T) {
	// Version skew is real for the Lua script: the user imports it into REAPER, so it can be older than the host. The fields after the
	// ninth are optional and default when absent.
	for cut := 9; cut <= 16; cut++ {
		if err := CheckEvent(realEvents["COMPARE_MARKER"][:cut]); err != nil {
			t.Errorf("a marker of %d fields: %v", cut, err)
		}
	}
}

func TestANumberThatIsNotANumberIsAnErrorThatNamesTheFieldAndNeverQuotesIt(t *testing.T) {
	cases := []struct {
		tag   string
		index int
		field string
	}{
		{"COMPARE_MARKER", 7, "projectTime"},
		{"COMPARE_MARKER", 8, "itemIndex"},
		{"COMPARE_MARKER", 10, "paragraph"},
		{"COMPARE_MARKER", 15, "srcpos"},
		{"COMPARE_INSPECTED", 3, "total"},
		{"COMPARE_EXPORTED", 2, "added"},
		{"LINES_STAMPED", 4, "missing"},
		{"REGIONS_CREATED", 4, "invalid"},
		{"COMPARE_PREPARED", 6, "items"},
	}
	for _, c := range cases {
		fields := append([]string(nil), realEvents[c.tag]...)
		fields[c.index] = "SECRET-TEXT"
		err := CheckEvent(fields)
		if err == nil {
			t.Errorf("%s field %d: a non-number was accepted", c.tag, c.index)
			continue
		}
		if !strings.Contains(err.Error(), c.field) || strings.Contains(err.Error(), "SECRET") {
			t.Errorf("%s field %d: error %q must name %q and not the value", c.tag, c.index, err, c.field)
		}
	}
}

func TestARequiredNumberThatIsEmptyIsAnErrorButAnOptionalOneMayBeEmpty(t *testing.T) {
	fields := append([]string(nil), realEvents["COMPARE_MARKER"]...)
	fields[7] = ""
	if err := CheckEvent(fields); err == nil {
		t.Fatal("an empty project time must be an error")
	}
	fields = append([]string(nil), realEvents["COMPARE_MARKER"]...)
	fields[10], fields[15] = "", ""
	if err := CheckEvent(fields); err != nil {
		t.Fatalf("an empty optional paragraph and srcpos are absent, not wrong: %v", err)
	}
}

func TestAnErrorEventOfTheOlderShapeIsStillReadable(t *testing.T) {
	// ERROR|<message> (no run id) is the shape before ADR 0068; the transcript service ignores it, so the table must not make it a
	// second, louder kind of failure.
	if err := CheckEvent([]string{"ERROR", "Unsupported hub protocol"}); err != nil {
		t.Fatal(err)
	}
}

func TestAnEmptyEventIsAnError(t *testing.T) {
	if err := CheckEvent(nil); err == nil {
		t.Fatal("no fields at all is not an event")
	}
}

func TestTheFieldNamesOfARealEventAreListedForDiagnosticsWithoutValues(t *testing.T) {
	names := FieldNames("COMPARE_MARKER")
	if len(names) != 15 || names[6] != "projectTime" || names[14] != "srcpos" {
		t.Fatalf("names = %v", names)
	}
	if FieldNames("SOMETHING_NEW") != nil {
		t.Fatal("an unknown tag has no field names")
	}
}
