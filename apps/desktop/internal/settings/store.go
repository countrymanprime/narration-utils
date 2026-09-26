// Package settings preserves Narration Utils' three-layer JSON settings
// contract: project overrides, then per-user global settings, then repository
// defaults. It intentionally reads existing files without rewriting schemas.
package settings

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/countrymanprime/narration-utils/shell/internal/layout"
	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

type Values map[string]string

type Store struct {
	mu sync.Mutex
	// +checklocks:mu
	repo string
	// +checklocks:mu
	project string
	persist atomic.Pointer[persist.Reporter]
}

func New(repo, project string) *Store      { return &Store{repo: repo, project: project} }
func (s *Store) SetProject(project string) { s.mu.Lock(); defer s.mu.Unlock(); s.project = project }

// SetPersist says where to report a settings file that cannot be read (ADR 0069). Without it a corrupt file is still kept aside.
func (s *Store) SetPersist(reporter *persist.Reporter) { s.persist.Store(reporter) }

// reporter is read without s.mu: Save holds it while it reads the file it is about to change.
func (s *Store) reporter() *persist.Reporter { return s.persist.Load() }

func (s *Store) Effective(tool, key, fallback string) (string, string) {
	if value, ok := s.Project(tool)[key]; ok {
		return value, "project"
	}
	if value, ok := s.Global(tool)[key]; ok {
		return value, "global"
	}
	if value, ok := s.Defaults(tool)[key]; ok {
		return value, "repo_default"
	}
	return fallback, "hardcoded"
}

// builtinDefaults mirrors config/defaults.json. That file only exists in
// a source checkout; an installed build has no repo root, so without this every
// effective default read back empty - most visibly the Settings color pickers,
// which rendered #000000 for every color. store_test.go keeps the two in sync.
var builtinDefaults = map[string]Values{
	// notifications defaults on (D8: OS notifications on by default, opt-out in Settings, N2). debug_logging defaults
	// off (docs/prds/tool-run-logging.prd.md Q1, ADR 0251): decision records are opt-in, on the Settings page or with
	// NARRATION_DEBUG=1.
	"General": {"log_verbosity": "normal", "notifications": "true", "credits_room_tone_seconds": "0", "debug_logging": "false"},
	// build_after_import defaults on (D8: build the Story Bible after import by default, B1-B3).
	"ManuscriptGuide":   {"spacy_model": "en_core_web_sm", "build_after_import": "true"},
	"Piper":             {"tts_provider": "piper", "tts_voice_id": "en_US-ljspeech-high"},
	"Updates":           {"check_on_startup": "true", "channel": "candidates"},
	"Manuscript":        {"color_note": "B85C1E"},
	"TranscriptCompare": {"chunk_seconds": "60", "model_size": "small", "color_misread": "FF4040", "color_skipped": "FFC000", "color_extra": "40A0FF"},
	"Teleprompter":      {"engine": "whisper", "model": "tiny"},
	// auto_start_launcher defaults off (owner decision D10): the spike that proved REAPER auto-runs a script
	// argument (ADR 0092, W12) does not by itself decide whether the app should always do it.
	// experimental_reaper_actions defaults off (owner decision D38): the bridge commands not yet verified in a real
	// REAPER stay off until the narrator turns them on (internal/bridge/actions.go).
	"DAW": {"auto_start_launcher": "false", "experimental_reaper_actions": "false"},
	// RecordingCoverage mirrors coverage.DefaultSettings: the recording check's shipped values, chosen on synthetic fixtures
	// and still Proposed and uncalibrated on real narration (docs/utilities/recording-coverage.md, ADR 0132, Q15).
	// background_checks defaults on (S7 B, D27): it only ever runs with the model installed, on mains power and while
	// REAPER is idle (coverage.NextBackground, ADR 0211).
	"RecordingCoverage": {"min_paragraph_present": "0.8", "max_missing_run": "3", "max_misread_run": "8", "min_anchor_run": "3", "background_checks": "true"},
	// StageRecommendations defaults every signal to required and suggestions on (docs/prds/chapter-stage-recommendations.prd.md
	// Phase 6, Q8): a narrator who never opens this settings page keeps the behaviour Phase 1 shipped with (every declared
	// signal id required).
	// editing.empty_space/clicks/breaths default to required (Q5 option A: "it matches the product definition").
	// Clicks and breaths can never actually be met while their detector is unvalidated (Phase 4 has not run), so
	// this default means the editing stage cannot be recommended until either Phase 4 lands or the narrator sets
	// editing.clicks/editing.breaths to "ignored" here - the documented cost of Q5's own recommendation, not a bug.
	"StageRecommendations": {
		"suggestions_enabled": "true", "recording.text_present": "required",
		"editing.empty_space": "required", "editing.clicks": "required", "editing.breaths": "required",
		// proofing.pickups is the always-required proofing signal (proofing-readiness-signals.prd.md Proposed Solution 1).
		"proofing.pickups": "required",
	},
	// TakeReview holds the pickup/duplicate detector's Q12 thresholds and
	// Q3 scan-scope settings (internal/takereview), layered like every
	// other tool here. Thresholds mirror repeats.DefaultThresholds();
	// pickup_track_name and the pickup_range pair are mutually exclusive
	// narrator-designated additions to the chapter track's own items (Q3
	// option B) and both default empty (no pickup scope beyond the
	// chapter track).
	"TakeReview": {
		"full_coverage_threshold":          "0.9",
		"near_duplicate_quality_threshold": "0.97",
		"pickup_track_name":                "",
		"pickup_range_start_seconds":       "",
		"pickup_range_end_seconds":         "",
	},
}

// Defaults returns the repo file's values for tool, with any key the file does
// not provide filled from builtinDefaults.
func (s *Store) Defaults(tool string) Values {
	values := s.readTool(layout.Path(s.repoPath(), layout.DefaultsFile), tool, persist.Disposable)
	for key, value := range builtinDefaults[tool] {
		if _, ok := values[key]; !ok {
			values[key] = value
		}
	}
	return values
}
func (s *Store) Global(tool string) Values {
	return s.readTool(globalPath(), tool, persist.NarratorData)
}
func (s *Store) Project(tool string) Values {
	project := s.projectPath()
	if project == "" {
		return Values{}
	}
	return s.readTool(project, tool, persist.NarratorData)
}

func (s *Store) Fields(scope string) map[string]map[string]any {
	result := map[string]map[string]any{}
	for _, tool := range []string{"General", "ManuscriptGuide", "Piper", "Manuscript", "TranscriptCompare", "Updates"} {
		defaults := s.Defaults(tool)
		global := s.Global(tool)
		project := s.Project(tool)
		keys := map[string]bool{}
		for key := range defaults {
			keys[key] = true
		}
		for key := range global {
			keys[key] = true
		}
		for key := range project {
			keys[key] = true
		}
		for key := range keys {
			value, source := s.Effective(tool, key, "")
			if scope == "" || scope == source || scope == "effective" {
				result[tool+"."+key] = map[string]any{"value": value, "source": source}
			}
		}
	}
	return result
}

// Save changes exactly one requested tier. A nil value removes a project
// override; global nil is retained as JSON null for compatibility with the
// previous host's explicit global reset representation.
func (s *Store) Save(tool, scope string, changes map[string]*string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := globalPath()
	if scope == "project" {
		path = projectPath(s.project)
		if path == "" {
			return fmt.Errorf("open a project before changing project settings")
		}
	} else if scope != "global" {
		return fmt.Errorf("unsupported settings scope")
	}
	document := s.readDocument(path, persist.NarratorData)
	if err := persist.CanOverwrite(path, "settings"); err != nil {
		return err
	}
	section, _ := document[tool].(map[string]any)
	if section == nil {
		section = map[string]any{}
	}
	for key, value := range changes {
		if value == nil && scope == "project" {
			delete(section, key)
		} else if value == nil {
			section[key] = nil
		} else {
			section[key] = *value
		}
	}
	document[tool] = section
	return writeDocument(path, document)
}

func (s *Store) repoPath() string { s.mu.Lock(); defer s.mu.Unlock(); return s.repo }
func (s *Store) projectPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return projectPath(s.project)
}
func projectPath(project string) string {
	if project == "" {
		return ""
	}
	return filepath.Join(project, "narration-utils", "settings.json")
}
func globalPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", "global-settings.json")
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", "global-settings.json")
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", "global-settings.json")
}

// readTool reads one tool's section of a settings file as text. Every setting is stored as a string, but a hand-edited file may hold
// a boolean or a number (a bool setting written as true, for one): those are read as their text. An object or a list is not a
// setting value: it is ignored, and the log names the key (never the value). A null is the explicit global reset that Save writes,
// so it is ignored without a log line.
func (s *Store) readTool(path, tool string, class persist.Class) Values {
	raw := s.readDocument(path, class)
	section, _ := raw[tool].(map[string]any)
	result := Values{}
	var ignored []string
	for key, value := range section {
		switch typed := value.(type) {
		case string:
			result[key] = typed
		case bool:
			result[key] = strconv.FormatBool(typed)
		case float64:
			result[key] = strconv.FormatFloat(typed, 'f', -1, 64)
		case nil:
		default:
			ignored = append(ignored, key)
		}
	}
	if len(ignored) > 0 {
		sort.Strings(ignored)
		s.reporter().Warn("settings_value_ignored", fmt.Sprintf("%s section %s has values that are not text, numbers or booleans and were ignored: %s", filepath.Base(path), tool, strings.Join(ignored, ", ")))
	}
	return result
}

// readDocument reads a settings file. A file that cannot be decoded is handled by class (kept aside and reported for the narrator's
// own settings), so the Save that follows never replaces it without a trace.
func (s *Store) readDocument(path string, class persist.Class) map[string]any {
	var document map[string]any
	s.reporter().ReadJSON(path, "settings", class, func(bytes []byte) error {
		var decoded map[string]any
		if err := json.Unmarshal(bytes, &decoded); err != nil {
			return err
		}
		if decoded == nil {
			return fmt.Errorf("not a JSON object")
		}
		document = decoded
		return nil
	})
	if document == nil {
		return map[string]any{}
	}
	return document
}
func writeDocument(path string, document map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create settings directory: %w", err)
	}
	bytes, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write settings: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return fmt.Errorf("could not activate settings: %w", err)
	}
	return nil
}
