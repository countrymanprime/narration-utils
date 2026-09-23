// Package lineidentity is the host's end of the manuscript line-identity commands over the REAPER file
// bridge (stamp_item_lines, read_line_ids; see docs/architecture/manuscript-line-identity.md and
// integrations/reaper/narration_line_identity.lua). It is the second consumer built on the event fan-out
// (apps/desktop/internal/bridge), alongside the transcript service.
//
// Line ID scheme (PRD reaper-automation-follow-through, Open Question 4, answered (a)): a line ID stamped
// onto a REAPER item is the manuscript entity ID (a paragraph ID such as "p-000001" or a chapter ID such as
// "c-0001") plus the manuscript's source SHA-256, so a re-import that renumbers entities is detectable
// instead of silently drifting. The stored line text (already written by the Lua side) is the second signal:
// on read, this package compares it to the entity's current text and reports drift, stale-source or removed
// instead of ever re-stamping on its own.
package lineidentity

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/manuscript"
)

// Config is the project and session paths the service needs.
type Config struct{ Project, SessionDir string }

// Row is one item the narrator asked to stamp: an item GUID, the manuscript entity ID it should carry
// (a paragraph or chapter ID), and that entity's current text. The service composes the wire line ID
// (ComposeLineID) and never trusts a caller-supplied line ID or source hash.
type Row struct{ ItemGUID, LineID, Text string }

// Service is the state machine for one stamp or read run at a time, mirroring transcript.Service.
type Service struct {
	mu         sync.RWMutex
	config     Config
	bridge     *bridge.Client
	manuscript *manuscript.Service
	changed    func(map[string]any)
	state      map[string]any
}

// New builds the service. When there is a bridge it subscribes to the events line identity owns: the
// LINES_* family, and ERROR events for its own run (or with no run, a session-level problem). The
// transcript service subscribes independently on the same client; Dispatch fans events to both.
func New(config Config, client *bridge.Client, manuscriptService *manuscript.Service, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, manuscript: manuscriptService, changed: changed, state: empty()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"LINES_*", "ERROR"},
			Owns:    s.ownsRun,
			Handle:  func(event bridge.Event) { s.Handle(event.Fields) },
			Invalid: s.handleInvalid,
		})
	}
	return s
}

func empty() map[string]any {
	return map[string]any{
		"runId": nil, "phase": "idle", "message": "",
		"stamp": map[string]any{"applied": 0, "unchanged": 0, "missingCount": 0, "conflictsCount": 0, "missing": []string{}, "conflicts": []string{}},
		"lines": []map[string]any{}, "linesRead": 0,
	}
}

// Stamp writes a payload of item_guid|line_id|line_text rows (the line ID composed from each row's
// manuscript entity ID and the manuscript's current source SHA-256) and sends stamp_item_lines. An item
// whose GUID no longer resolves is reported by REAPER as stale; one that already carries a different line ID
// is reported as a conflict unless overwrite is set. Nothing is written when rows is empty.
func (s *Service) Stamp(rows []Row, overwrite bool) error {
	if len(rows) == 0 {
		return fmt.Errorf("select at least one item to stamp")
	}
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	data, err := s.manuscriptData()
	if err != nil {
		return err
	}
	sourceHash, err := sourceSHA256(data)
	if err != nil {
		return err
	}
	var payload strings.Builder
	for _, row := range rows {
		if row.ItemGUID == "" || row.LineID == "" {
			return fmt.Errorf("every stamped row needs an item and a manuscript line")
		}
		payload.WriteString(row.ItemGUID)
		payload.WriteByte('|')
		payload.WriteString(ComposeLineID(row.LineID, sourceHash))
		payload.WriteByte('|')
		payload.WriteString(oneLine(row.Text))
		payload.WriteByte('\n')
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	path := filepath.Join(s.config.SessionDir, "lines_stamp_"+runID+".txt")
	if err := os.WriteFile(path, []byte(payload.String()), 0o600); err != nil {
		return fmt.Errorf("could not write the manuscript line list: %w", err)
	}
	s.mu.Lock()
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"] = runID, "stamping", "Stamping manuscript line identity in REAPER…"
	s.mu.Unlock()
	overwriteFlag := "0"
	if overwrite {
		overwriteFlag = "1"
	}
	if _, err := s.bridge.Send("stamp_item_lines", []string{runID, path, overwriteFlag}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Read asks REAPER for every stamped item (read_line_ids is read-only) and, once LINES_READ arrives,
// parses the report and annotates each row against the current manuscript (Handle -> parseAndAnnotate).
func (s *Service) Read() error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	path := filepath.Join(s.config.SessionDir, "lines_read_"+runID+".txt")
	s.mu.Lock()
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"] = runID, "reading", "Reading manuscript line identity from REAPER…"
	s.mu.Unlock()
	if _, err := s.bridge.Send("read_line_ids", []string{runID, path}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Drain delivers the events REAPER has appended since the last call, to this service and to every other
// consumer subscribed to the same bridge (transcript.Service.Drain does the same on its client).
func (s *Service) Drain() error {
	if s.bridge == nil {
		return nil
	}
	return s.bridge.Dispatch()
}

func (s *Service) Snapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}
func (s *Service) snapshotLocked() map[string]any { return clone(s.state) }
func (s *Service) notify() {
	if s.changed != nil {
		s.changed(s.Snapshot())
	}
}
func (s *Service) fail(message string) {
	s.mu.Lock()
	s.state["phase"], s.state["message"] = "error", message
	s.mu.Unlock()
	s.notify()
}

// ownsRun reports whether runID is the run this service is tracking.
func (s *Service) ownsRun(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current, _ := s.state["runId"].(string)
	return runID != "" && runID == current
}

// handleInvalid ends the run in progress with a message naming the event and the field that could not be
// read (never a value, since a field can hold the narrator's words): the same shape as transcript.Service.
func (s *Service) handleInvalid(event bridge.Event, reason error) {
	message := fmt.Sprintf("The Narration Utils script in REAPER sent a message this app could not read (%v). Import the script from this app's REAPER folder again, then try again.", reason)
	s.mu.Lock()
	if !runInProgress(s.state) {
		s.mu.Unlock()
		return
	}
	s.state["phase"], s.state["message"] = "error", message
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	if s.changed != nil {
		s.changed(snapshot)
	}
}

func runInProgress(state map[string]any) bool {
	switch state["phase"] {
	case "stamping", "reading":
		return true
	}
	return false
}

// acceptsLocked says whether an event belongs to the run in progress, the same rule transcript.Service
// applies: every event carries its run ID as its first argument, and an ERROR with an empty run ID belongs
// to whatever run is in progress (a session-level problem, such as an unsupported protocol).
func (s *Service) acceptsLocked(fields []string) bool {
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" {
		if len(fields) < 2 {
			return false
		}
		if fields[1] == "" {
			return runInProgress(s.state)
		}
		return fields[1] == runID
	}
	return len(fields) <= 1 || fields[1] == runID
}

func (s *Service) Handle(fields []string) {
	if len(fields) == 0 {
		return
	}
	s.mu.Lock()
	if !s.acceptsLocked(fields) {
		s.mu.Unlock()
		return
	}
	changed := false
	switch fields[0] {
	case "LINES_STALE":
		if len(fields) >= 3 {
			stamp := s.state["stamp"].(map[string]any)
			stamp["missing"] = append(stamp["missing"].([]string), fields[2])
			changed = true
		}
	case "LINES_CONFLICT":
		if len(fields) >= 3 {
			stamp := s.state["stamp"].(map[string]any)
			stamp["conflicts"] = append(stamp["conflicts"].([]string), fields[2])
			changed = true
		}
	case "LINES_STAMPED":
		if len(fields) >= 6 && s.state["phase"] == "stamping" {
			stamp := s.state["stamp"].(map[string]any)
			applied, unchanged, missingCount, conflictsCount := intAt(fields, 2), intAt(fields, 3), intAt(fields, 4), intAt(fields, 5)
			stamp["applied"], stamp["unchanged"], stamp["missingCount"], stamp["conflictsCount"] = applied, unchanged, missingCount, conflictsCount
			s.state["phase"], s.state["message"] = "success", stampSummary(applied, unchanged, missingCount, conflictsCount)
			changed = true
		}
	case "LINES_READ":
		if len(fields) >= 4 && s.state["phase"] == "reading" {
			path, count := textAt(fields, 2), intAt(fields, 3)
			lines, err := s.parseAndAnnotate(path)
			if err != nil {
				s.state["phase"], s.state["message"] = "error", err.Error()
			} else {
				s.state["lines"], s.state["linesRead"] = lines, count
				s.state["phase"], s.state["message"] = "success", fmt.Sprintf("Read %d stamped line%s.", count, plural(count))
			}
			changed = true
		}
	case "ERROR":
		message := "REAPER integration failed."
		if len(fields) > 2 {
			message = fields[2]
		}
		s.state["phase"], s.state["message"] = "error", message
		changed = true
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	if changed && s.changed != nil {
		s.changed(snapshot)
	}
}

// lineRow is one parsed row of a read_line_ids report: item_guid|line_id|position|length|line_text.
type lineRow struct {
	itemGUID, lineID, text string
	position, length       float64
}

// parseLineRow parses one report line. A line with too few fields, an empty GUID or line ID, or a position
// or length that is not a number is malformed and skipped (never crashes the read): read_line_ids is
// REAPER's own report, not narrator input, but a script older or newer than this app can still disagree
// with it (the same defensiveness as bridge/wire.go for events.log).
func parseLineRow(raw string) (lineRow, bool) {
	fields := splitPipeFields(raw, 5)
	if len(fields) != 5 || fields[0] == "" || fields[1] == "" {
		return lineRow{}, false
	}
	position, posErr := strconv.ParseFloat(fields[2], 64)
	length, lenErr := strconv.ParseFloat(fields[3], 64)
	if posErr != nil || lenErr != nil {
		return lineRow{}, false
	}
	return lineRow{itemGUID: fields[0], lineID: fields[1], position: position, length: length, text: fields[4]}, true
}

// splitPipeFields splits value into at most count fields on "|"; the last field is the remainder, so it may
// contain pipes (matches integrations/reaper/narration_bridge_core.lua's pipe_fields, without percent
// decoding: this file protocol is not the command-line protocol bridge.go encodes).
func splitPipeFields(value string, count int) []string {
	fields := make([]string, 0, count)
	rest := value
	for len(fields) < count-1 {
		at := strings.IndexByte(rest, '|')
		if at < 0 {
			break
		}
		fields = append(fields, rest[:at])
		rest = rest[at+1:]
	}
	return append(fields, rest)
}

// parseAndAnnotate reads a read_line_ids report and, for every row, decides its status against the current
// manuscript: "stale-source" when the stamped source hash no longer matches (a re-import happened), "removed"
// when the entity ID no longer exists, "drift" when the stored text no longer matches the entity's current
// text, "unrecognized" for a line ID this scheme did not compose (an older stamp), "unknown" when the
// manuscript itself cannot be loaded to compare against, and "ok" otherwise. A malformed report line is
// skipped, never guessed at.
func (s *Service) parseAndAnnotate(path string) ([]map[string]any, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("could not read the manuscript line report: %w", err)
	}
	data, dataErr := s.manuscriptData()
	var texts map[string]string
	var currentHash string
	if dataErr == nil {
		texts = entityText(data)
		currentHash, _ = sourceSHA256(data)
	}
	lines := []map[string]any{}
	for _, raw := range strings.Split(string(content), "\n") {
		raw = strings.TrimRight(raw, "\r")
		if raw == "" {
			continue
		}
		row, ok := parseLineRow(raw)
		if !ok {
			continue
		}
		entityID, stampedHash, idOK := ParseLineID(row.lineID)
		entry := map[string]any{
			"itemGuid": row.itemGUID, "lineId": row.lineID, "entityId": entityID,
			"position": row.position, "length": row.length, "text": row.text,
		}
		entry["status"] = rowStatus(idOK, dataErr, stampedHash, currentHash, entityID, row.text, texts, entry)
		lines = append(lines, entry)
	}
	sort.Slice(lines, func(i, j int) bool { return lines[i]["itemGuid"].(string) < lines[j]["itemGuid"].(string) })
	return lines, nil
}

// rowStatus is parseAndAnnotate's per-row decision, split out so it reads as one rule at a time; it may add
// "currentText" to entry when the manuscript's text at the entity differs from what REAPER has stored.
func rowStatus(idOK bool, dataErr error, stampedHash, currentHash, entityID, storedText string, texts map[string]string, entry map[string]any) string {
	if !idOK {
		return "unrecognized"
	}
	if dataErr != nil {
		return "unknown"
	}
	if stampedHash != currentHash {
		return "stale-source"
	}
	text, found := texts[entityID]
	if !found {
		return "removed"
	}
	if text != storedText {
		entry["currentText"] = text
		return "drift"
	}
	return "ok"
}

// ComposeLineID and ParseLineID implement the line ID scheme (Open Question 4, answered (a)): the
// manuscript entity ID plus the manuscript's source SHA-256, joined by "@" (an entity ID is "p-000006" or
// "c-0004" and never contains "@").
const lineIDSeparator = "@"

func ComposeLineID(entityID, sourceSHA256 string) string {
	return entityID + lineIDSeparator + sourceSHA256
}

func ParseLineID(lineID string) (entityID, sourceSHA256 string, ok bool) {
	at := strings.LastIndex(lineID, lineIDSeparator)
	if at <= 0 || at == len(lineID)-1 {
		return "", "", false
	}
	return lineID[:at], lineID[at+1:], true
}

func (s *Service) manuscriptData() (map[string]any, error) {
	if s.manuscript == nil {
		return nil, fmt.Errorf("the manuscript service is unavailable")
	}
	return s.manuscript.Load()
}

func sourceSHA256(data map[string]any) (string, error) {
	source, ok := data["source"].(map[string]any)
	if !ok {
		return "", fmt.Errorf("the manuscript has no recorded source checksum")
	}
	sha, ok := source["sha256"].(string)
	if !ok || sha == "" {
		return "", fmt.Errorf("the manuscript has no recorded source checksum")
	}
	return sha, nil
}

// entityText maps every chapter and paragraph ID to the text a stamp of it should carry: a chapter's title
// (chapter-level identity, Open Question 3's first slice) and a paragraph's own text. The two ID spaces
// never collide ("c-" versus "p-" prefixes), so one map serves both granularities.
func entityText(data map[string]any) map[string]string {
	texts := map[string]string{}
	if chapters, ok := data["chapters"].([]any); ok {
		for _, raw := range chapters {
			if chapter, ok := raw.(map[string]any); ok {
				if id, _ := chapter["id"].(string); id != "" {
					title, _ := chapter["title"].(string)
					texts[id] = oneLine(title)
				}
			}
		}
	}
	if paragraphs, ok := data["paragraphs"].([]any); ok {
		for _, raw := range paragraphs {
			if paragraph, ok := raw.(map[string]any); ok {
				if id, _ := paragraph["id"].(string); id != "" {
					text, _ := paragraph["text"].(string)
					texts[id] = oneLine(text)
				}
			}
		}
	}
	return texts
}

func oneLine(value string) string { return strings.NewReplacer("\r", " ", "\n", " ").Replace(value) }
func newRunID() string            { return fmt.Sprintf("%d000", time.Now().UnixMilli()) }
func plural(value int) string {
	if value == 1 {
		return ""
	}
	return "s"
}
func stampSummary(applied, unchanged, missing, conflicts int) string {
	summary := fmt.Sprintf("Stamped %d line%s", applied, plural(applied))
	if unchanged > 0 {
		summary += fmt.Sprintf(", %d already stamped", unchanged)
	}
	if missing > 0 {
		summary += fmt.Sprintf(", %d stale item%s", missing, plural(missing))
	}
	if conflicts > 0 {
		summary += fmt.Sprintf(", %d conflict%s", conflicts, plural(conflicts))
	}
	return summary + "."
}
func textAt(values []string, index int) string {
	if index < len(values) {
		return values[index]
	}
	return ""
}
func intAt(values []string, index int) int {
	result, _ := strconv.Atoi(textAt(values, index))
	return result
}
func clone(value map[string]any) map[string]any {
	bytes, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(bytes, &result)
	return result
}
