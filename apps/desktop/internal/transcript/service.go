// Package transcript owns the asynchronous Transcript Compare state machine.
// Its only DAW transport is the versioned file bridge; browser polling and SSE
// are deliberately absent.
package transcript

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/bridge"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

type Config struct{ Project, SessionDir, Python, Backend string }
type Service struct {
	mu                sync.RWMutex
	config            Config
	bridge            *bridge.Client
	settings          *settings.Store
	sidecars          *process.Supervisor
	changed           func(map[string]any)
	state             map[string]any
	child             *process.Child
	progress, logPath string
	logAt             int64
	files             atomic.Pointer[persist.Reporter]
}

// New builds the service. When there is a bridge it subscribes to the events Transcript Compare owns: the
// COMPARE_* family, and ERROR events for its own run (or with no run, a session-level problem). Other consumers of
// the same client subscribe for their own events; nobody reads the log directly.
func New(config Config, client *bridge.Client, store *settings.Store, sidecars *process.Supervisor, changed func(map[string]any)) *Service {
	s := &Service{config: config, bridge: client, settings: store, sidecars: sidecars, changed: changed, state: empty()}
	if client != nil {
		client.Subscribe(bridge.Subscription{
			Tags:   []string{"COMPARE_*", "ERROR"},
			Owns:   s.ownsRun,
			Handle: func(event bridge.Event) { s.Handle(event.Fields) },
			// An event of this run that fails its table (bridge/wire.go) is REAPER's script and this app disagreeing about the protocol:
			// the run says so instead of carrying on with a row of zeros.
			Invalid: s.handleInvalid,
		})
	}
	return s
}

// SetPersist says where to log a last-comparison file that cannot be read (ADR 0069). It is derived data and heals.
func (s *Service) SetPersist(reporter *persist.Reporter) { s.files.Store(reporter) }

// handleInvalid ends the run in progress with a message that names the event and the field that could not be read (never a value).
// The advice is the fix for the usual cause: the REAPER script the narrator imported is older or newer than this app.
func (s *Service) handleInvalid(event bridge.Event, reason error) {
	message := fmt.Sprintf("The Narration Utils script in REAPER sent a message this app could not read (%v). Import the script from this app's REAPER folder again, then start a new comparison.", reason)
	s.mu.Lock()
	if !runInProgress(s.state) {
		s.mu.Unlock()
		return
	}
	if exportPhase(s.state) == "exporting" {
		s.state["markerExport"] = map[string]any{"phase": "error", "message": message, "added": 0, "skipped": 0}
	} else {
		s.state["phase"], s.state["message"] = "error", message
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	if s.changed != nil {
		s.changed(snapshot)
	}
}

// ownsRun reports whether runID is the run this service is tracking.
func (s *Service) ownsRun(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	current, _ := s.state["runId"].(string)
	return runID != "" && runID == current
}
func empty() map[string]any {
	return map[string]any{
		"runId": nil, "phase": "idle", "percent": 0, "message": "Select a track in REAPER, then start a comparison.",
		"logs": []string{}, "chapters": []string{}, "rows": []map[string]any{}, "diff": "", "summary": "", "trackName": nil, "audioItemCount": nil, "completedAt": nil,
		"markerExport": map[string]any{"phase": "idle", "message": "", "added": 0, "skipped": 0}, "elapsed": 0,
	}
}
func clone(value map[string]any) map[string]any {
	bytes, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(bytes, &result)
	return result
}
func (s *Service) snapshotLocked() map[string]any {
	result := clone(s.state)
	if start, ok := s.state["startedAt"].(time.Time); ok {
		result["elapsed"] = time.Since(start).Seconds()
	}
	delete(result, "startedAt")
	delete(result, "options")
	delete(result, "manifest")
	delete(result, "output")
	delete(result, "diffPath")
	return result
}
func (s *Service) Snapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}
func (s *Service) notify() {
	if s.changed != nil {
		s.changed(s.Snapshot())
	}
}

func (s *Service) Start(options map[string]string) error {
	if s.config.Project == "" || !exists(filepath.Join(s.config.Project, "narration-utils", "manuscript", "manuscript.json")) {
		return fmt.Errorf("save the REAPER project and import a manuscript first")
	}
	hintsPath := filepath.Join(s.config.Project, "TranscriptCompare", "vocabulary_hints.txt")
	if err := os.MkdirAll(filepath.Dir(hintsPath), 0o755); err != nil {
		return fmt.Errorf("could not prepare Transcript Compare storage: %w", err)
	}
	if err := os.WriteFile(hintsPath, []byte(strings.TrimSpace(options["hints"])), 0o600); err != nil {
		return fmt.Errorf("could not write vocabulary hints: %w", err)
	}
	s.mu.Lock()
	phase, _ := s.state["phase"].(string)
	if phase == "preparing" || phase == "running" {
		s.mu.Unlock()
		return fmt.Errorf("a comparison is already running")
	}
	runID := fmt.Sprintf("%d000", time.Now().UnixMilli())
	s.state = empty()
	s.state["runId"], s.state["phase"], s.state["message"], s.state["startedAt"], s.state["options"] = runID, "preparing", "Preparing the selected REAPER audio…", time.Now(), options
	s.mu.Unlock()
	if s.bridge == nil {
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	if _, err := s.bridge.Send("prepare_compare", []string{runID}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}
func (s *Service) Cancel() {
	s.mu.Lock()
	phase, _ := s.state["phase"].(string)
	if phase == "preparing" || phase == "need_chapter" {
		s.state["phase"] = "cancelled"
	}
	s.state["message"] = "Cancellation requested…"
	progress := s.progress
	s.mu.Unlock()
	if progress != "" {
		_ = os.WriteFile(progress+".cancel", []byte("cancel"), 0o600)
	}
	s.notify()
}
func (s *Service) Reset() error {
	s.mu.Lock()
	phase, _ := s.state["phase"].(string)
	if phase == "preparing" || phase == "running" {
		s.mu.Unlock()
		return fmt.Errorf("cancel the active comparison before starting a new one")
	}
	s.state, s.child, s.progress, s.logPath, s.logAt = empty(), nil, "", "", 0
	s.mu.Unlock()
	s.notify()
	return nil
}
func (s *Service) LastCompleted() map[string]any {
	var result map[string]any
	s.files.Load().ReadJSON(filepath.Join(s.config.Project, ".narration-last-comparison.json"), "last comparison", persist.Disposable, func(bytes []byte) error {
		if len(bytes) == 0 {
			return nil
		}
		return json.Unmarshal(bytes, &result)
	})
	return result
}

// LoadHints reads the accepted vocabulary hints. No file yet is an empty list;
// a file that cannot be read or is not a JSON list of strings is an error, so
// the Proofing page can say the saved hints were not loaded instead of showing
// an empty box as if none had ever been saved.
func (s *Service) LoadHints() ([]string, error) {
	if s.config.Project == "" {
		return []string{}, nil
	}
	bytes, err := os.ReadFile(filepath.Join(s.config.Project, "TranscriptCompare", "vocab_hints.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return []string{}, fmt.Errorf("could not read the saved vocabulary hints: %w", err)
	}
	var result []string
	if err := json.Unmarshal(bytes, &result); err != nil {
		return []string{}, fmt.Errorf("the saved vocabulary hints file is not a valid list: %w", err)
	}
	if result == nil {
		result = []string{}
	}
	return result, nil
}

// Hints is LoadHints for callers that can carry on without the saved list.
func (s *Service) Hints() []string {
	hints, _ := s.LoadHints()
	return hints
}
func (s *Service) SaveHints(values []string) error {
	if s.config.Project == "" {
		return fmt.Errorf("select a manuscript first")
	}
	seen := map[string]string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			if _, ok := seen[strings.ToLower(value)]; !ok {
				seen[strings.ToLower(value)] = value
			}
		}
	}
	result := make([]string, 0, len(seen))
	for _, value := range seen {
		result = append(result, value)
	}
	sort.Slice(result, func(i, j int) bool { return strings.ToLower(result[i]) < strings.ToLower(result[j]) })
	path := filepath.Join(s.config.Project, "TranscriptCompare", "vocab_hints.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// The page tells the narrator that saving replaces a list that could not be loaded,
	// so keep that file beside the new one rather than destroying it.
	if _, loadErr := s.LoadHints(); loadErr != nil {
		_ = os.Rename(path, path+".corrupt")
	}
	bytes, _ := json.Marshal(result)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, bytes, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
func (s *Service) AddEquivalence(rowID string) (string, error) {
	s.mu.RLock()
	rows, _ := s.state["rows"].([]map[string]any)
	var wanted map[string]any
	for _, row := range rows {
		if row["id"] == rowID {
			wanted = row
			break
		}
	}
	s.mu.RUnlock()
	if wanted == nil || wanted["kind"] != "MISREAD" {
		return "", fmt.Errorf("select a single-word MISREAD result to add an equivalence")
	}
	doc, docOK := wanted["docText"].(string)
	audio, audioOK := wanted["audioText"].(string)
	if !docOK || !audioOK || doc == "" || audio == "" || strings.ContainsAny(doc, " \t\r\n") || strings.ContainsAny(audio, " \t\r\n") {
		return "", fmt.Errorf("select a single-word MISREAD result to add an equivalence")
	}
	path := filepath.Join(s.config.Project, "TranscriptCompare", "equivalences.csv")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err = os.WriteFile(path, []byte("# Transcript Compare - custom word equivalences\n# One comma-separated group per line.\n"), 0o600); err != nil {
			return "", err
		}
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	if _, err = fmt.Fprintf(file, "%s, %s\n", doc, audio); err != nil {
		_ = file.Close() // the write already failed; report that error
		return "", err
	}
	// A failed close can be a deferred write failure (full disk, a synced folder), so report it.
	if err = file.Close(); err != nil {
		return "", err
	}
	return fmt.Sprintf("Added equivalence: %s = %s", doc, audio), nil
}
func (s *Service) Jump(rowID string) error {
	s.mu.RLock()
	runID, _ := s.state["runId"].(string)
	rows, _ := s.state["rows"].([]map[string]any)
	found := false
	for _, row := range rows {
		if row["id"] == rowID {
			found = true
		}
	}
	s.mu.RUnlock()
	if !found || s.bridge == nil {
		return fmt.Errorf("that discrepancy is no longer available")
	}
	_, err := s.bridge.Send("jump_to_compare_marker", []string{runID, rowID})
	return err
}
func (s *Service) Export() error {
	s.mu.Lock()
	phase, _ := s.state["phase"].(string)
	runID, _ := s.state["runId"].(string)
	output, _ := s.state["output"].(string)
	export, _ := s.state["markerExport"].(map[string]any)
	pending := 0
	if rows, ok := s.state["rows"].([]map[string]any); ok {
		for _, row := range rows {
			if row["markerState"] == "pending" {
				pending++
			}
		}
	}
	if phase != "success" || runID == "" || output == "" {
		s.mu.Unlock()
		return fmt.Errorf("run a comparison in this session before exporting its markers")
	}
	if export["phase"] == "exporting" {
		s.mu.Unlock()
		return fmt.Errorf("marker export is already in progress")
	}
	if pending == 0 {
		s.mu.Unlock()
		return fmt.Errorf("there are no new markers ready to export")
	}
	s.state["markerExport"] = map[string]any{"phase": "exporting", "message": fmt.Sprintf("Exporting %d marker%s to REAPER…", pending, plural(pending)), "added": 0, "skipped": 0}
	s.mu.Unlock()
	if s.bridge == nil {
		s.fail("The REAPER bridge is unavailable.")
		return fmt.Errorf("the REAPER bridge is unavailable")
	}
	misread, _ := s.settings.Effective("TranscriptCompare", "color_misread", "FF4040")
	skipped, _ := s.settings.Effective("TranscriptCompare", "color_skipped", "FFC000")
	extra, _ := s.settings.Effective("TranscriptCompare", "color_extra", "40A0FF")
	if _, err := s.bridge.Send("export_compare_markers", []string{runID, output, misread, skipped, extra}); err != nil {
		s.fail(err.Error())
		return err
	}
	s.notify()
	return nil
}

// Drain delivers the events REAPER has appended since the last call, to this service and to every other consumer
// subscribed to the same bridge.
func (s *Service) Drain() error {
	if s.bridge == nil {
		return nil
	}
	return s.bridge.Dispatch()
}
func (s *Service) Handle(fields []string) {
	if len(fields) == 0 {
		return
	}
	if fields[0] == "COMPARE_PREPARED" {
		s.handlePrepared(fields)
		return
	}
	s.mu.Lock()
	if !s.acceptsLocked(fields) {
		s.mu.Unlock()
		return
	}
	changed := false
	switch fields[0] {
	case "COMPARE_MARKER":
		if len(fields) >= 9 && s.state["phase"] == "inspecting" {
			rows := s.state["rows"].([]map[string]any)
			doc, audio := fields[5], fields[6]
			row := map[string]any{"id": fields[2], "kind": fields[3], "name": fields[4], "docText": doc, "audioText": audio, "projectTime": floatAt(fields, 7), "itemIndex": intAt(fields, 8), "srcpos": floatAt(fields, 15), "chapter": textAt(fields, 9), "paragraph": intAt(fields, 10), "scriptContext": fallback(textAt(fields, 11), doc), "audioContext": fallback(textAt(fields, 12), audio), "markerState": fallback(textAt(fields, 13), "pending"), "existingMarkerName": textAt(fields, 14)}
			s.state["rows"] = append(rows, row)
			changed = true
		}
	case "COMPARE_INSPECTED":
		if len(fields) >= 5 && s.state["phase"] == "inspecting" {
			summary := fields[2]
			if existing := intAt(fields, 4); existing > 0 {
				summary += fmt.Sprintf(" %d already marked.", existing)
			}
			s.state["phase"], s.state["percent"], s.state["summary"], s.state["message"], s.state["completedAt"] = "success", 100, summary, "Comparison complete — review discrepancies before exporting markers.", time.Now().UTC().Format(time.RFC3339Nano)
			changed = true
		}
	case "COMPARE_EXPORT_MARKER":
		if len(fields) >= 4 && exportPhase(s.state) == "exporting" {
			if rows, ok := s.state["rows"].([]map[string]any); ok {
				for _, row := range rows {
					if row["id"] == fields[2] {
						row["markerState"], row["existingMarkerName"] = fields[3], textAt(fields, 4)
						changed = true
					}
				}
			}
		}
	case "COMPARE_EXPORTED":
		if len(fields) >= 4 && exportPhase(s.state) == "exporting" {
			added, skipped := intAt(fields, 2), intAt(fields, 3)
			s.state["markerExport"] = map[string]any{"phase": "complete", "added": added, "skipped": skipped, "message": fmt.Sprintf("Exported %d marker%s; skipped %d existing.", added, plural(added), skipped)}
			changed = true
		}
	case "ERROR":
		message := "REAPER integration failed."
		if len(fields) > 2 {
			message = fields[2]
		}
		if exportPhase(s.state) == "exporting" {
			s.state["markerExport"] = map[string]any{"phase": "error", "message": message, "added": 0, "skipped": 0}
		} else {
			s.state["phase"], s.state["message"] = "error", message
		}
		changed = true
	}
	snapshot := s.snapshotLocked()
	s.mu.Unlock()
	if changed {
		if fields[0] == "COMPARE_INSPECTED" || fields[0] == "COMPARE_EXPORTED" {
			s.persist(snapshot)
		}
		if s.changed != nil {
			s.changed(snapshot)
		}
	}
}

// acceptsLocked says whether an event belongs to the run in progress. Every event carries its run ID as its first
// argument and is ignored when that is not this run's. An ERROR is ERROR|run|message; with an empty run (a
// session-level problem, such as an unsupported protocol) it belongs to whatever run is in progress, and an ERROR
// without a message is the older, unattributed shape and is ignored.
func (s *Service) acceptsLocked(fields []string) bool {
	runID, _ := s.state["runId"].(string)
	if fields[0] == "ERROR" {
		if len(fields) < 3 {
			return false
		}
		if fields[1] == "" {
			return runInProgress(s.state)
		}
		return fields[1] == runID
	}
	return len(fields) <= 1 || fields[1] == runID
}

func runInProgress(state map[string]any) bool {
	switch state["phase"] {
	case "preparing", "running", "need_chapter", "inspecting":
		return true
	}
	return exportPhase(state) == "exporting"
}

func (s *Service) handlePrepared(fields []string) {
	if len(fields) < 6 {
		return
	}
	s.mu.Lock()
	if fields[1] != s.state["runId"] || s.state["phase"] != "preparing" {
		s.mu.Unlock()
		return
	}
	s.state["manifest"], s.state["diffPath"], s.state["trackName"] = fields[2], fields[5], fields[4]
	s.state["audioItemCount"] = intAt(fields, 6)
	options, _ := s.state["options"].(map[string]string)
	runID, _ := s.state["runId"].(string)
	s.mu.Unlock()
	output := filepath.Join(s.config.SessionDir, "results_"+runID+".txt")
	progress := filepath.Join(s.config.SessionDir, "progress_"+runID+".txt")
	logPath := filepath.Join(s.config.SessionDir, "log_"+runID+".txt")
	args := []string{"--manifest", fields[2], "--manuscript", fields[3], "--track-name", fields[4], "--out", output, "--diff-out", fields[5], "--model", option(options, "model", "small"), "--progress", progress, "--log", logPath}
	if s.config.Backend != "" {
		args = append([]string{s.config.Backend}, args...)
	}
	if modelDir := option(options, "modelDir", ""); modelDir != "" {
		args = append(args, "--model-dir", modelDir)
	}
	if chapter := option(options, "chapterTitle", ""); chapter != "" {
		args = append(args, "--chapter-title", chapter)
	}
	if chunk := option(options, "chunk", ""); validNumber(chunk) {
		workers := option(options, "workers", "0")
		if workers == "" || workers == "Auto" {
			workers = "0"
		}
		args = append(args, "--chunk-seconds", chunk, "--parallel-workers", workers)
	}
	if s.config.Python == "" || s.sidecars == nil {
		s.fail("Configure the Transcript Compare executable before continuing.")
		return
	}
	child, err := s.sidecars.Start(context.Background(), s.config.Python, args...)
	if err != nil {
		s.fail(err.Error())
		return
	}
	s.mu.Lock()
	s.child, s.progress, s.logPath, s.logAt = child, progress, logPath, 0
	s.state["phase"], s.state["message"], s.state["output"] = "running", "Launching transcript backend…", output
	s.mu.Unlock()
	s.notify()
}
func (s *Service) Poll() {
	s.mu.RLock()
	phase, _ := s.state["phase"].(string)
	progress, logPath, child := s.progress, s.logPath, s.child
	s.mu.RUnlock()
	if phase != "running" {
		return
	}
	changed := false
	if bytes, err := os.ReadFile(progress); err == nil {
		lines := strings.Split(strings.TrimSpace(string(bytes)), "\n")
		stage, pct, message, parseErr := process.ParseProgress(lines[len(lines)-1])
		if parseErr != nil {
			// Keep the last good progress: the old code read a bad percent as 0 and moved the bar back.
			s.files.Load().Warn("progress_line_ignored", fmt.Sprintf("Transcript Compare progress line ignored: %v", parseErr))
		} else {
			s.mu.Lock()
			s.state["percent"] = pct
			if message != "" {
				s.state["message"] = message
			} else {
				s.state["message"] = stage
			}
			switch stage {
			case "CANCELLED":
				s.state["phase"] = "cancelled"
			case "ERROR":
				s.state["phase"] = "error"
			}
			s.mu.Unlock()
			changed = true
		}
	}
	if bytes, err := os.ReadFile(logPath); err == nil {
		s.mu.Lock()
		if s.logAt < int64(len(bytes)) {
			logs := s.state["logs"].([]string)
			for _, line := range strings.Split(string(bytes[s.logAt:]), "\n") {
				if line != "" {
					logs = append(logs, line)
				}
			}
			if len(logs) > 500 {
				logs = logs[len(logs)-500:]
			}
			s.state["logs"], s.logAt = logs, int64(len(bytes))
			changed = true
		}
		s.mu.Unlock()
	}
	if changed {
		s.notify()
	}
	if child == nil || !child.HasExited() {
		return
	}
	s.finishBackend(child)
}
func (s *Service) finishBackend(child *process.Child) {
	s.mu.RLock()
	output, diffPath := textValue(s.state, "output"), textValue(s.state, "diffPath")
	s.mu.RUnlock()
	bytes, err := os.ReadFile(output)
	if err != nil {
		return
	}
	content := string(bytes)
	if rest, ok := strings.CutPrefix(content, "NEED_CHAPTER|"); ok {
		s.mu.Lock()
		s.state["phase"], s.state["chapters"], s.state["message"] = "need_chapter", splitNonEmpty(strings.TrimSpace(rest), "|"), "Choose the manuscript chapter."
		s.mu.Unlock()
		s.notify()
		return
	}
	code, exited := child.ExitCode()
	if !exited {
		return
	}
	if code == 2 {
		s.mu.Lock()
		s.state["phase"], s.state["message"] = "cancelled", "Cancelled — no markers were added."
		s.mu.Unlock()
		s.notify()
		return
	}
	if code != 0 {
		s.fail("Transcript backend failed.")
		return
	}
	s.mu.Lock()
	runID, _ := s.state["runId"].(string)
	s.state["phase"], s.state["message"], s.child = "inspecting", "Checking existing take markers in REAPER…", nil
	if bytes, err := os.ReadFile(diffPath); err == nil {
		s.state["diff"] = string(bytes)
	}
	s.mu.Unlock()
	if s.bridge == nil {
		s.fail("The REAPER bridge is unavailable.")
		return
	}
	if _, err := s.bridge.Send("inspect_compare_results", []string{runID, output}); err != nil {
		s.fail(err.Error())
		return
	}
	s.notify()
}
func (s *Service) fail(message string) {
	s.mu.Lock()
	s.state["phase"], s.state["message"] = "error", message
	s.mu.Unlock()
	s.notify()
}
func (s *Service) persist(snapshot map[string]any) {
	if s.config.Project != "" {
		if bytes, err := json.Marshal(snapshot); err == nil {
			_ = os.WriteFile(filepath.Join(s.config.Project, ".narration-last-comparison.json"), bytes, 0o600)
		}
	}
}
func exists(path string) bool { _, err := os.Stat(path); return err == nil }
func option(values map[string]string, key, fallback string) string {
	if value := values[key]; value != "" {
		return value
	}
	return fallback
}
func validNumber(value string) bool { _, err := strconv.Atoi(value); return err == nil && value != "" }
func plural(value int) string {
	if value == 1 {
		return ""
	}
	return "s"
}
func textAt(values []string, index int) string {
	if index < len(values) {
		return values[index]
	}
	return ""
}

// intAt and floatAt read a number field of an event. bridge.CheckEvent has already refused an event whose number is not a number, so
// a value that is empty here is an optional field an older script does not send, and 0 is its documented default.
func intAt(values []string, index int) int {
	result, _ := strconv.Atoi(textAt(values, index))
	return result
}
func floatAt(values []string, index int) float64 {
	result, _ := strconv.ParseFloat(textAt(values, index), 64)
	return result
}
func fallback(value, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}
func textValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return value
}
func exportPhase(state map[string]any) string {
	value, _ := state["markerExport"].(map[string]any)
	phase, _ := value["phase"].(string)
	return phase
}
func splitNonEmpty(value, separator string) []string {
	result := []string{}
	for _, item := range strings.Split(value, separator) {
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}
