package bridge

import (
	"strings"
	"testing"
)

// Real events, field for field, as integrations/reaper/tests/compare_test.lua and line_identity_test.lua pin them: the harness proves
// what Lua emits, and these prove what Go accepts, so the two halves of the protocol are tied to the same lines.
var realEvents = map[string][]string{
	"COMPARE_PREPARED":      {"COMPARE_PREPARED", "r1", "C:/s/manifest.json", "C:/p/narration-utils/manuscript/manuscript.json", "Narrator", "C:/s/diff.txt", "3", "41"},
	"COMPARE_MARKER":        {"COMPARE_MARKER", "r1", "0@12.500000", "MISREAD", "MISREAD: alice", "Alice", "Alyss", "102.5", "0", "Chapter 1", "4", "script ctx", "audio ctx", "pending", "", "12.5", "{AAAAAAAA-0000-4000-8000-000000000001}", "{AAAAAAAA-0000-4000-8000-0000000000A1}", "{00000001-0000-4000-8000-000000000001}"},
	"COMPARE_INSPECTED":     {"COMPARE_INSPECTED", "r1", "2 discrepancy(s) found.", "2", "0"},
	"COMPARE_EXPORT_MARKER": {"COMPARE_EXPORT_MARKER", "r1", "0@12.500000", "exported", ""},
	"COMPARE_EXPORTED":      {"COMPARE_EXPORTED", "r1", "2", "1"},
	"ERROR":                 {"ERROR", "r1", "Transcript results were not found."},
	"LINES_STAMPED":         {"LINES_STAMPED", "t1", "3", "0", "1", "0"},
	"LINES_READ":            {"LINES_READ", "t1", "C:/s/lines.txt", "12"},
	"LINES_STALE":           {"LINES_STALE", "t1", "{AAAAAAAA-0000-4000-8000-000000000001}"},
	"LINES_CONFLICT":        {"LINES_CONFLICT", "t1", "{AAAAAAAA-0000-4000-8000-000000000002}"},
	"REGIONS_CREATED":       {"REGIONS_CREATED", "t1", "2", "0", "0", "0", "0", "0"},
	"PLAY_POSITION":         {"PLAY_POSITION", "p1", "5", "12.500000", "12.375000", "3.000000"},
	"PUNCHED":               {"PUNCHED", "u1", "39.500000"},
	"PROJECT_STATUS":        {"PROJECT_STATUS", "", "C:/p/Book.rpp", "0"},
	"PICKUPS_IMPORTED":      {"PICKUPS_IMPORTED", "t1", "2", "0", "0"},
	"PICKUPS_EXPORTED":      {"PICKUPS_EXPORTED", "t1", "C:/s/pickups.txt", "2"},
	"PICKUPS_COUNTED":       {"PICKUPS_COUNTED", "t1", "1", "2"},
	"PICKUP_NEXT":           {"PICKUP_NEXT", "t1", "9.25", "narrator", "Mispronounced"},
	"PICKUP_RESOLVED":       {"PICKUP_RESOLVED", "t1", "9.25", "narrator", "Mispronounced"},
	"RENDER_CONFIGURED":     {"RENDER_CONFIGURED", "t1", "C:/p/renders", "2", "C:/p/renders/Chapter 1.wav;C:/p/renders/Chapter 2.wav"},
	"PROJECT_STATE":         {"PROJECT_STATE", "t1", "7", "C:/p/Book.rpp"},
	"CLEANUP_LAUNCHED":      {"CLEANUP_LAUNCHED", "t1", "repair_pops_clicks", "Item: Repair pops/clicks..."},
	// integrations/reaper/tests/cleanup_preview_test.lua (diagnostics-delivery-and-cleanup-tools PRD Phase 10, ADR 0251).
	"CLEANUP_STALE":     {"CLEANUP_STALE", "c1", "f-0001", "{AAAAAAAA-0000-4000-8000-000000000001}", "range"},
	"CLEANUP_PREVIEWED": {"CLEANUP_PREVIEWED", "c1", "2", "0"},
	"CLEANUP_APPLIED":   {"CLEANUP_APPLIED", "c1", "1"},
	// integrations/reaper/tests/level_normalize_test.lua (diagnostics-delivery-and-cleanup-tools PRD Phase 11, ADR 0252).
	"GAIN_STALE":         {"GAIN_STALE", "g1", "f-0001", "{AAAAAAAA-0000-4000-8000-000000000001}", "item"},
	"GAIN_ITEM":          {"GAIN_ITEM", "g1", "{AAAAAAAA-0000-4000-8000-000000000001}", "1.000000", "1.412538"},
	"GAIN_APPLIED":       {"GAIN_APPLIED", "g1", "1"},
	"RETAKE_LANE_PICKED": {"RETAKE_LANE_PICKED", "t1", "line-000004", "{AAAAAAAA-0000-4000-8000-000000000001}", "2"},
	"TAKE_CREATED":       {"TAKE_CREATED", "t1", "{AAAAAAAA-0000-4000-8000-000000000001}", "{BBBBBBBB-0000-4000-8000-000000000002}"},
	"TAKE_STALE":         {"TAKE_STALE", "t1", "{AAAAAAAA-0000-4000-8000-000000000001}"},
	// integrations/reaper/tests/navigation_test.lua (review-dashboard PRD Phase 6).
	"NAVIGATED":     {"NAVIGATED", "n1", "{AAAAAAAA-0000-4000-8000-000000000001}", "102.500000"},
	"LOOP_STARTED":  {"LOOP_STARTED", "l1", "{AAAAAAAA-0000-4000-8000-000000000001}", "101.000000", "105.000000"},
	"LOOP_STOPPED":  {"LOOP_STOPPED", "s1", "3", "0"},
	"PONG":          {"PONG", "p1", "1", "0", "0"},
	"FINDING_STALE": {"FINDING_STALE", "n1", "{FFFFFFFF-0000-4000-8000-00000000FFFF}", "item"},
	// integrations/reaper/tests/finding_marker_test.lua (review-dashboard PRD Phase 8).
	"FINDING_MARKER": {"FINDING_MARKER", "m1", "added", "{AAAAAAAA-0000-4000-8000-0000000000A1}", "12.500000", "MISREAD: 'pink eyes' as 'pink ice'"},
	// integrations/reaper/tests/track_state_test.lua (chapter_track_state).
	"TRACK_STATE":     {"TRACK_STATE", "t1", "{00000001-0000-4000-8000-000000000001}", "0", "2.500000", "1.250000", "C:/p/Book.rpp", "0", "7", "1", "2", "1024", ""},
	"TRACK_ITEM":      {"TRACK_ITEM", "t1", "{AAAAAAAA-0000-4000-8000-000000000001}", "{00000004-0000-4000-8000-000000000004}", "0.000000", "4.000000", "0.000000", "1.000000", "C:\\Audio\\ch1|take 1.wav"},
	"TRACK_STATE_END": {"TRACK_STATE_END", "t1", "2", "2"},
	"TRACK_STALE":     {"TRACK_STALE", "t1", "{FFFFFFFF-0000-4000-8000-00000000FFFF}"},
	// integrations/reaper/tests/transport_test.lua (arm_only, record_start, record_stop).
	"ARMED":           {"ARMED", "a1", "{00000001-0000-4000-8000-000000000001}", "2", "1"},
	"RECORD_STARTED":  {"RECORD_STARTED", "r1", "{00000001-0000-4000-8000-000000000001}", "42.500000"},
	"RECORD_STOPPED":  {"RECORD_STOPPED", "s1", "3", "0"},
	"RECORD_ENDED":    {"RECORD_ENDED", "r1", "2", "0"},
	"RECORD_NOT_OURS": {"RECORD_NOT_OURS", "s1"},
	// integrations/reaper/tests/workspace_test.lua (set_active_take, list_fx_chains, apply_fx_chain).
	"ACTIVE_TAKE_SET":   {"ACTIVE_TAKE_SET", "u1", "{AAAAAAAA-0000-4000-8000-000000000001}", "{00000004-0000-4000-8000-000000000004}", "1"},
	"ITEM_STALE":        {"ITEM_STALE", "x3", "{AAAAAAAA-0000-4000-8000-000000000001}", "range"},
	"FX_CHAIN":          {"FX_CHAIN", "f1", "Voice/Test EQ.RfxChain"},
	"FX_CHAINS_LISTED":  {"FX_CHAINS_LISTED", "f1", "3", "0"},
	"FX_CHAIN_APPLIED":  {"FX_CHAIN_APPLIED", "c1", "Voice/Test EQ.RfxChain", "{00000001-0000-4000-8000-000000000001}", "1"},
	"FX_PLUGIN":         {"FX_PLUGIN", "p1", "VST3: ReaEQ (Cockos)"},
	"FX_PLUGINS_LISTED": {"FX_PLUGINS_LISTED", "p1", "2", "0"},
	"TAKE_FX_ADDED":     {"TAKE_FX_ADDED", "x1", "VST3: ReaEQ (Cockos)", "{00000005-0000-4000-8000-000000000005}", "{00000006-0000-4000-8000-000000000006}", "2"},
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
	// ninth are optional and default when absent, including the three GUIDs a script older than Phase 6 does not send.
	for cut := 9; cut <= 19; cut++ {
		if err := CheckEvent(realEvents["COMPARE_MARKER"][:cut]); err != nil {
			t.Errorf("a marker of %d fields: %v", cut, err)
		}
	}
}

func TestAnOlderScriptsPreparedAnswerWithoutTheChangeCountIsAccepted(t *testing.T) {
	// The change count (follow-through PRD Phase 13) is the seventh field; a script older than it, or a REAPER without
	// GetProjectStateChangeCount, sends six.
	if err := CheckEvent(realEvents["COMPARE_PREPARED"][:7]); err != nil {
		t.Fatalf("a six-field COMPARE_PREPARED: %v", err)
	}
	if err := CheckEvent(append(append([]string{}, realEvents["COMPARE_PREPARED"][:7]...), "many")); err == nil {
		t.Fatal("a change count that is not a number was accepted")
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
		{"NAVIGATED", 3, "projectTime"},
		{"LOOP_STARTED", 4, "end"},
		{"LOOP_STOPPED", 2, "restored"},
		{"PONG", 3, "looping"},
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
	if len(names) != 18 || names[6] != "projectTime" || names[14] != "srcpos" || names[15] != "itemGuid" || names[17] != "trackGuid" {
		t.Fatalf("names = %v", names)
	}
	if FieldNames("SOMETHING_NEW") != nil {
		t.Fatal("an unknown tag has no field names")
	}
}

// TestAProjectStatusHeartbeatWithAnUnsavedProjectIsStillValid is ADR 0092/W10: an unsaved REAPER project reports an
// empty rpp (never omitted, spike S6), so the field must be allowed to be empty although it is required.
func TestAProjectStatusHeartbeatWithAnUnsavedProjectIsStillValid(t *testing.T) {
	if err := CheckEvent([]string{"PROJECT_STATUS", "", "", "1"}); err != nil {
		t.Fatalf("an unsaved project's heartbeat must be valid: %v", err)
	}
}

func TestAProjectStatusHeartbeatNeedsItsUnsavedFlagToBeANumber(t *testing.T) {
	err := CheckEvent([]string{"PROJECT_STATUS", "", "C:/p/Book.rpp", ""})
	if err == nil || !strings.Contains(err.Error(), "unsaved") {
		t.Fatalf("an empty required unsaved flag must be an error naming the field: %v", err)
	}
}
