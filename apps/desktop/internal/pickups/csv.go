// Package pickups is the host's end of the REAPER pickup-list commands over the file bridge (import_pickups,
// export_pickups, next_pickup, resolve_pickup, count_pickups; see docs/architecture/reaper-bridge.md and
// integrations/reaper/narration_pickups.lua). It is the third consumer built on the event fan-out
// (apps/desktop/internal/bridge), alongside the transcript and line-identity services.
//
// CSV format (PRD reaper-automation-follow-through, Open Question 5, answered (a)): a generic CSV with one row
// per pickup, columns start time in seconds, note, and an optional tag - "matching REAPER's own marker CSV
// columns" plus the tag this app's PICKUP: convention uses. A first row whose first cell is literally "start"
// (case-insensitive) is treated as a header and skipped; every other row is data. This never trusts the file:
// a row with a non-finite or negative start, an empty note, or a tag containing "|" (the payload file's own
// field separator) is reported, never silently dropped or guessed at.
package pickups

import (
	"encoding/csv"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Row is one validated pickup: a non-negative, finite start time in seconds, a required note, and an optional
// tag. ParseCSV is the only way to build one from narrator-supplied text.
type Row struct {
	Start float64
	Tag   string
	Note  string
}

// RowIssue is one CSV row ParseCSV could not use, with the 1-based line it came from and why, so the caller can
// report every problem row instead of stopping at the first one.
type RowIssue struct {
	Line    int
	Message string
}

// ParseCSV parses text into validated rows and a report of every row that was not usable. Rows are parsed one
// source line at a time (a quoted field may not itself contain a newline), which keeps a malformed line from
// preventing every row after it from being read.
func ParseCSV(text string) ([]Row, []RowIssue) {
	var rows []Row
	var issues []RowIssue
	lines := strings.Split(text, "\n")
	start := 0
	if len(lines) > 0 && isHeaderLine(lines[0]) {
		start = 1
	}
	for index := start; index < len(lines); index++ {
		raw := strings.TrimRight(lines[index], "\r")
		if strings.TrimSpace(raw) == "" {
			continue
		}
		lineNumber := index + 1
		fields, err := parseCSVLine(raw)
		if err != nil {
			issues = append(issues, RowIssue{Line: lineNumber, Message: "could not parse this row: " + err.Error()})
			continue
		}
		row, problem := validateRow(fields)
		if problem != "" {
			issues = append(issues, RowIssue{Line: lineNumber, Message: problem})
			continue
		}
		rows = append(rows, row)
	}
	return rows, issues
}

func isHeaderLine(line string) bool {
	fields, err := parseCSVLine(strings.TrimRight(line, "\r"))
	if err != nil || len(fields) == 0 {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(fields[0]), "start")
}

func parseCSVLine(line string) ([]string, error) {
	reader := csv.NewReader(strings.NewReader(line))
	reader.FieldsPerRecord = -1
	return reader.Read()
}

func validateRow(fields []string) (Row, string) {
	if len(fields) < 2 {
		return Row{}, "a pickup row needs a start time and a note"
	}
	startRaw := strings.TrimSpace(fields[0])
	start, err := strconv.ParseFloat(startRaw, 64)
	if err != nil || math.IsNaN(start) || math.IsInf(start, 0) || start < 0 {
		return Row{}, fmt.Sprintf("%q is not a valid start time in seconds", startRaw)
	}
	note := oneLine(strings.TrimSpace(fields[1]))
	if note == "" {
		return Row{}, "the note is empty"
	}
	tag := ""
	if len(fields) >= 3 {
		tag = oneLine(strings.TrimSpace(fields[2]))
	}
	if strings.Contains(tag, "|") {
		return Row{}, "the tag cannot contain the '|' character"
	}
	return Row{Start: start, Tag: tag, Note: note}, ""
}

func oneLine(value string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(value) }
