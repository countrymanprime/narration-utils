package bridge

import (
	"fmt"
	"strconv"
)

// The events the Lua bridge appends to events.log, as a table (ADR 0069). Lua is imported into REAPER by the narrator, so it can
// be older or newer than the host: a line that is too short, or whose numbers are not numbers, used to be read by index with
// helpers that turned every parse error into 0 and produced a zero-filled row. Each event is now checked against this table
// before any consumer sees it, and an event that fails is reported (see Client.Dispatch) and never delivered as data.
//
// The table lists the fields after the tag, in order. Required fields must be present and, for numbers, non-empty and numeric.
// Optional fields (the tail of a marker, which an older script does not send) may be absent or empty, and are checked only when they
// hold something. A tag that is not in the table is a newer script's event and passes through (additive changes need no bump).
// integrations/reaper/tests pins what Lua emits and wire_test.go pins what this table accepts, from the same lines.
type fieldKind int

const (
	textField fieldKind = iota
	intField
	numberField
)

type fieldSpec struct {
	name string
	kind fieldKind
}

type eventSpec struct {
	required []fieldSpec
	optional []fieldSpec
}

func text(name string) fieldSpec   { return fieldSpec{name, textField} }
func count(name string) fieldSpec  { return fieldSpec{name, intField} }
func number(name string) fieldSpec { return fieldSpec{name, numberField} }

var eventSpecs = map[string]eventSpec{
	"COMPARE_PREPARED": {required: []fieldSpec{text("run"), text("manifest"), text("manuscript"), text("track"), text("diff"), count("items")}},
	"COMPARE_MARKER": {
		required: []fieldSpec{text("run"), text("id"), text("kind"), text("name"), text("docText"), text("audioText"), number("projectTime"), count("itemIndex")},
		optional: []fieldSpec{text("chapter"), count("paragraph"), text("scriptContext"), text("audioContext"), text("markerState"), text("existingMarkerName"), number("srcpos"),
			// Appended by review-dashboard PRD Phase 6 (never reordered): the identity a finding is navigated by.
			text("itemGuid"), text("takeGuid"), text("trackGuid")},
	},
	"COMPARE_INSPECTED":     {required: []fieldSpec{text("run"), text("summary"), count("total"), count("alreadyMarked")}},
	"COMPARE_EXPORT_MARKER": {required: []fieldSpec{text("run"), text("row"), text("state")}, optional: []fieldSpec{text("existingName")}},
	"COMPARE_EXPORTED":      {required: []fieldSpec{text("run"), count("added"), count("skipped")}},
	// ERROR|<message> is the shape before the run id was added (ADR 0068); it stays readable and consumers ignore it.
	"ERROR":            {required: []fieldSpec{text("run")}, optional: []fieldSpec{text("message")}},
	"LINES_STAMPED":    {required: []fieldSpec{text("run"), count("applied"), count("unchanged"), count("missing"), count("conflicts")}},
	"LINES_READ":       {required: []fieldSpec{text("run"), text("path"), count("count")}},
	"LINES_STALE":      {required: []fieldSpec{text("run"), text("guid")}},
	"LINES_CONFLICT":   {required: []fieldSpec{text("run"), text("guid")}},
	"REGIONS_CREATED":  {required: []fieldSpec{text("run"), count("created"), count("existing"), count("invalid")}},
	"PICKUPS_IMPORTED": {required: []fieldSpec{text("run"), count("added"), count("existing"), count("invalid")}},
	"PICKUPS_EXPORTED": {required: []fieldSpec{text("run"), text("path"), count("count")}},
	"PICKUPS_COUNTED":  {required: []fieldSpec{text("run"), count("remaining"), count("total")}},
	"PICKUP_NEXT":      {required: []fieldSpec{text("run"), number("position"), text("tag"), text("note")}},
	"PICKUP_RESOLVED":  {required: []fieldSpec{text("run"), number("position"), text("tag"), text("note")}},
	// Phase 11 (reaper-automation-follow-through PRD): configure-only render setup. targets is RENDER_TARGETS,
	// semicolon-joined, empty when count is 0 (no chapter regions yet).
	"RENDER_CONFIGURED": {required: []fieldSpec{text("run"), text("folder"), count("count"), text("targets")}},
	// Phase 13 (reaper-automation-follow-through PRD): the live "project changed since this check" indicator.
	// changeCount is GetProjectStateChangeCount(0); projectPath is empty when the project has never been saved.
	"PROJECT_STATE": {required: []fieldSpec{text("run"), count("changeCount"), text("projectPath")}},
	// PROJECT_STATUS is the reachability heartbeat ADR 0092 (W10) recommends: narration_ui_bridge.lua's tick loop
	// appends it periodically with an empty run (Fields[1] == ""), so events.go's existing fan-out (a run-less event
	// reaches every subscriber, Subscription.wants) delivers it as a broadcast with no dedicated route needed. rpp is
	// EnumProjects(-1, '')'s second return value verbatim (the empty string for an unsaved project, never omitted -
	// spike S6 confirmed REAPER never returns nil there), and unsaved is "1" exactly when rpp is empty.
	// changeCount (GetProjectStateChangeCount(0)) was appended for DAW chapter-track auto-sync Phase 4: optional, so an
	// older script's three-field heartbeat still passes, and empty on a REAPER without the call.
	"PROJECT_STATUS": {required: []fieldSpec{text("run"), text("rpp"), count("unsaved")}, optional: []fieldSpec{count("changeCount")}},
	// Phase 23 (reaper-automation-follow-through PRD, ADR 0146): a cleanup launcher opened its dialog. tool is the
	// allow-listed key the host sent; action is the action-list name REAPER matched (so the narrator sees what opened).
	"CLEANUP_LAUNCHED": {required: []fieldSpec{text("run"), text("tool"), text("action")}},
	// Phase 25 (reaper-automation-follow-through PRD, ADR 0147): the narrator's retake now plays alone. lineId and
	// itemGuid name the retake (a line id alone names several items on a lane track); lane is the 0-based lane REAPER
	// read from the item when the pick ran.
	"RETAKE_LANE_PICKED": {required: []fieldSpec{text("run"), text("lineId"), text("itemGuid"), count("lane")}},
	"TAKE_CREATED":       {required: []fieldSpec{text("run"), text("targetItemGuid"), text("newTakeGuid")}},
	"TAKE_STALE":         {required: []fieldSpec{text("run"), text("guid")}},
	// Going to and looping a finding (narration_navigation.lua, review-dashboard PRD Phase 6, bridge.Navigator). Times are
	// project seconds; restored/kept count the time selection, loop points and repeat; looping and playing are 0 or 1;
	// reason is item, take or range.
	"NAVIGATED":     {required: []fieldSpec{text("run"), text("itemGuid"), number("projectTime")}},
	"LOOP_STARTED":  {required: []fieldSpec{text("run"), text("itemGuid"), number("start"), number("end")}},
	"LOOP_STOPPED":  {required: []fieldSpec{text("run"), count("restored"), count("kept")}},
	"PONG":          {required: []fieldSpec{text("run"), text("version"), count("looping"), count("playing")}},
	"FINDING_STALE": {required: []fieldSpec{text("run"), text("guid"), text("reason")}},
	// review-dashboard PRD Phase 8: the approved marker, "added" or "existing" (the take already had one; nothing changed).
	"FINDING_MARKER": {required: []fieldSpec{text("run"), text("state"), text("takeGuid"), number("sourceTime"), text("name")}},
	// chapter_track_state (narration_track_state.lua; read-aloud-resume P4, read-aloud-control-bar P6, TMI-11): the
	// transport and one track, read-only. guid is empty when no track was named; playState is GetPlayState's bit field;
	// times are seconds; recInput is the track's I_RECINPUT (empty with no track); inputDevice is empty when REAPER has
	// no input open. One TRACK_ITEM per item on the track follows, then TRACK_STATE_END (listed, and the track's total).
	"TRACK_STATE": {required: []fieldSpec{text("run"), text("guid"), count("playState"), number("editCursor"), number("playPosition"), text("rpp"), count("unsaved"),
		count("changeCount"), count("thisArmed"), count("armedCount")}, optional: []fieldSpec{count("recInput"), text("inputDevice")}},
	"TRACK_ITEM":      {required: []fieldSpec{text("run"), text("itemGuid"), text("takeGuid"), number("position"), number("length"), number("sourceOffset"), number("playrate"), text("sourceFile")}},
	"TRACK_STATE_END": {required: []fieldSpec{text("run"), count("listed"), count("total")}},
	"TRACK_STALE":     {required: []fieldSpec{text("run"), text("guid")}},
}

// CheckEvent validates one decoded event line (the tag first) against the table. The error names the tag, the position and name of
// the field, and how many fields there were: never a value, because a field can hold the narrator's words.
func CheckEvent(fields []string) error {
	if len(fields) == 0 || fields[0] == "" {
		return fmt.Errorf("an event line has no tag")
	}
	spec, known := eventSpecs[fields[0]]
	if !known {
		return nil
	}
	if len(fields)-1 < len(spec.required) {
		return fmt.Errorf("%s has %d fields, and this app needs at least %d", fields[0], len(fields), len(spec.required)+1)
	}
	all := append(append([]fieldSpec(nil), spec.required...), spec.optional...)
	for position := 1; position < len(fields) && position <= len(all); position++ {
		field, value := all[position-1], fields[position]
		required := position <= len(spec.required)
		if field.kind == textField || (value == "" && !required) {
			continue
		}
		if err := checkNumber(field.kind, value); err != nil {
			return fmt.Errorf("%s field %d (%s) is not %s", fields[0], position, field.name, kindName(field.kind))
		}
	}
	return nil
}

func checkNumber(kind fieldKind, value string) error {
	if kind == intField {
		_, err := strconv.Atoi(value)
		return err
	}
	_, err := strconv.ParseFloat(value, 64)
	return err
}

func kindName(kind fieldKind) string {
	if kind == intField {
		return "a whole number"
	}
	return "a number"
}

// FieldNames lists the names of the fields after the tag of a known event, for diagnostics; nil for a tag not in the table.
func FieldNames(tag string) []string {
	spec, known := eventSpecs[tag]
	if !known {
		return nil
	}
	names := make([]string, 0, len(spec.required)+len(spec.optional))
	for _, field := range append(append([]fieldSpec(nil), spec.required...), spec.optional...) {
		names = append(names, field.name)
	}
	return names
}
