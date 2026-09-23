package pickups

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
)

// Config is the session path the service needs to talk to REAPER over the file bridge.
type Config struct{ SessionDir string }

// Service is the state machine for one pickup-list run at a time (import, export, jump, resolve or count),
// mirroring transcript.Service and lineidentity.Service.
type Service struct {
	mu      sync.RWMutex
	config  Config
	bridge  *bridge.Client
	changed func(map[string]any)
	state   map[string]any
}

// New builds the service and, when there is a bridge, subscribes to the events pickups owns: every PICKUPS_*
// and PICKUP_* tag, and ERROR events for its own run (or with no run, a session-level problem). The transcript
// and line-identity services subscribe independently on the same client; Dispatch fans events to all three.
func New(config Config, client *bridge.Client, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, changed: changed, state: empty()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:    []string{"PICKUPS_IMPORTED", "PICKUPS_EXPORTED", "PICKUPS_COUNTED", "PICKUP_NEXT", "PICKUP_RESOLVED", "ERROR"},
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
		"remaining": 0, "total": 0,
		"next":         nil,
		"resolved":     nil,
		"importReport": nil,
		"csv":          "",
	}
}

// Import writes a payload of start|tag|note rows and sends import_pickups. Nothing is written when rows is
// empty: the caller (the Go binding, ParseCSV's result) decides whether a CSV with no valid rows is an error.
func (s *Service) Import(rows []Row) error {
	if len(rows) == 0 {
		return fmt.Errorf("select at least one pickup to import")
	}
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	path := filepath.Join(s.config.SessionDir, "pickups_import_"+runID+".txt")
	var payload strings.Builder
	for _, row := range rows {
		payload.WriteString(strconv.FormatFloat(row.Start, 'f', 6, 64))
		payload.WriteByte('|')
		payload.WriteString(row.Tag)
		payload.WriteByte('|')
		payload.WriteString(row.Note)
		payload.WriteByte('\n')
	}
	if err := os.WriteFile(path, []byte(payload.String()), 0o600); err != nil {
		return fmt.Errorf("could not write the pickup list: %w", err)
	}
	s.begin(runID, "importing", "Importing pickups into REAPER…")
	if _, err := s.bridge.Send("import_pickups", []string{runID, path}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Export asks REAPER for every remaining (open) pickup (export_pickups is read-only) and, once PICKUPS_EXPORTED
// arrives, reads the payload file it wrote and re-encodes it as CSV text (Handle -> readExportedCSV) so the UI
// can offer it as a download with no second round trip.
func (s *Service) Export() error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if err := os.MkdirAll(s.config.SessionDir, 0o755); err != nil {
		return fmt.Errorf("could not prepare the REAPER session directory: %w", err)
	}
	runID := newRunID()
	path := filepath.Join(s.config.SessionDir, "pickups_export_"+runID+".txt")
	s.begin(runID, "exporting", "Exporting pickups from REAPER…")
	if _, err := s.bridge.Send("export_pickups", []string{runID, path}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Next asks REAPER to move the edit cursor to the next open pickup after the cursor (wrapping to the earliest
// one), read-only otherwise.
func (s *Service) Next() error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	runID := newRunID()
	s.begin(runID, "jumping", "Jumping to the next pickup…")
	if _, err := s.bridge.Send("next_pickup", []string{runID}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Resolve marks the open pickup nearest position as done (PICKUP_DONE:), keeping its body, in one undo step.
func (s *Service) Resolve(position float64) error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	runID := newRunID()
	s.begin(runID, "resolving", "Resolving this pickup…")
	if _, err := s.bridge.Send("resolve_pickup", []string{runID, strconv.FormatFloat(position, 'f', 6, 64)}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Count asks REAPER how many pickups remain versus the total (open plus resolved); read-only.
func (s *Service) Count() error {
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	runID := newRunID()
	s.begin(runID, "counting", "Counting pickups…")
	if _, err := s.bridge.Send("count_pickups", []string{runID}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Drain delivers the events REAPER has appended since the last call, to this service and to every other
// consumer subscribed to the same bridge.
func (s *Service) Drain() error {
	if s.bridge == nil {
		return nil
	}
	return s.bridge.Dispatch()
}

func (s *Service) Snapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(s.state)
}

func (s *Service) begin(runID, phase, message string) {
	s.mu.Lock()
	remaining, total := s.state["remaining"], s.state["total"]
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"] = runID, phase, message
	// Counts survive into the next run's state so the UI keeps showing the last known remaining/total while a
	// different action (import, next, resolve) is in flight, instead of flashing back to zero.
	s.state["remaining"], s.state["total"] = remaining, total
	s.mu.Unlock()
}

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

func (s *Service) ownsRun(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current, _ := s.state["runId"].(string)
	return runID != "" && runID == current
}

func (s *Service) handleInvalid(event bridge.Event, reason error) {
	message := fmt.Sprintf("The Narration Utils script in REAPER sent a message this app could not read (%v). Import the script from this app's REAPER folder again, then try again.", reason)
	s.mu.Lock()
	if !runInProgress(s.state) {
		s.mu.Unlock()
		return
	}
	s.state["phase"], s.state["message"] = "error", message
	snapshot := clone(s.state)
	s.mu.Unlock()
	if s.changed != nil {
		s.changed(snapshot)
	}
}

func runInProgress(state map[string]any) bool {
	switch state["phase"] {
	case "importing", "exporting", "jumping", "resolving", "counting":
		return true
	}
	return false
}

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
	case "PICKUPS_IMPORTED":
		if len(fields) >= 5 && s.state["phase"] == "importing" {
			added, existing, invalid := intAt(fields, 2), intAt(fields, 3), intAt(fields, 4)
			s.state["importReport"] = map[string]any{"added": added, "existing": existing, "invalid": invalid}
			s.state["phase"], s.state["message"] = "success", importSummary(added, existing, invalid)
			changed = true
		}
	case "PICKUPS_EXPORTED":
		if len(fields) >= 4 && s.state["phase"] == "exporting" {
			path, count := textAt(fields, 2), intAt(fields, 3)
			csvText, err := readExportedCSV(path)
			if err != nil {
				s.state["phase"], s.state["message"] = "error", err.Error()
			} else {
				s.state["csv"] = csvText
				s.state["phase"], s.state["message"] = "success", fmt.Sprintf("Exported %d pickup%s.", count, plural(count))
			}
			changed = true
		}
	case "PICKUP_NEXT":
		if len(fields) >= 5 && s.state["phase"] == "jumping" {
			position, tag, note := floatAt(fields, 2), textAt(fields, 3), textAt(fields, 4)
			s.state["next"] = map[string]any{"position": position, "tag": tag, "note": note}
			s.state["phase"], s.state["message"] = "success", "Jumped to the next pickup."
			changed = true
		}
	case "PICKUP_RESOLVED":
		if len(fields) >= 5 && s.state["phase"] == "resolving" {
			position, tag, note := floatAt(fields, 2), textAt(fields, 3), textAt(fields, 4)
			s.state["resolved"] = map[string]any{"position": position, "tag": tag, "note": note}
			s.state["phase"], s.state["message"] = "success", "Marked this pickup done."
			changed = true
		}
	case "PICKUPS_COUNTED":
		if len(fields) >= 4 && s.state["phase"] == "counting" {
			remaining, total := intAt(fields, 2), intAt(fields, 3)
			s.state["remaining"], s.state["total"] = remaining, total
			s.state["phase"], s.state["message"] = "success", fmt.Sprintf("%d pickup%s remaining of %d.", remaining, plural(remaining), total)
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
	snapshot := clone(s.state)
	s.mu.Unlock()
	if changed && s.changed != nil {
		s.changed(snapshot)
	}
}

// readExportedCSV reads export_pickups' start|tag|note payload file and re-encodes it as CSV text (header
// start,note,tag) matching the column order ParseCSV reads, so export then import round-trips through the same
// file shape a narrator would open in a spreadsheet.
func readExportedCSV(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("could not read the exported pickup list: %w", err)
	}
	var builder strings.Builder
	writer := csv.NewWriter(&builder)
	if err := writer.Write([]string{"start", "note", "tag"}); err != nil {
		return "", err
	}
	for _, raw := range strings.Split(string(content), "\n") {
		raw = strings.TrimRight(raw, "\r")
		if raw == "" {
			continue
		}
		fields := splitPipeFields(raw, 3)
		if len(fields) != 3 {
			continue
		}
		start, tag, note := fields[0], fields[1], fields[2]
		if err := writer.Write([]string{start, note, tag}); err != nil {
			return "", err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", err
	}
	return builder.String(), nil
}

// splitPipeFields splits value into at most count fields on "|"; the last field is the remainder, so it may
// contain pipes (matches lineidentity's helper of the same name and narration_bridge_core.lua's pipe_fields).
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

func newRunID() string { return fmt.Sprintf("%d000", time.Now().UnixMilli()) }
func plural(value int) string {
	if value == 1 {
		return ""
	}
	return "s"
}
func importSummary(added, existing, invalid int) string {
	summary := fmt.Sprintf("Imported %d pickup%s", added, plural(added))
	if existing > 0 {
		summary += fmt.Sprintf(", %d already there", existing)
	}
	if invalid > 0 {
		summary += fmt.Sprintf(", %d invalid row%s skipped", invalid, plural(invalid))
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
func floatAt(values []string, index int) float64 {
	result, _ := strconv.ParseFloat(textAt(values, index), 64)
	return result
}
func clone(value map[string]any) map[string]any {
	bytes, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(bytes, &result)
	return result
}
