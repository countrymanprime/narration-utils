// Package production implements Phase 1 of
// docs/prds/production-tracking.prd.md: a stage timer the narrator starts and
// stops by hand, and the project-scoped log of the sessions it records (Q2).
// A session exists only because the narrator started and stopped a timer:
// nothing here starts one from REAPER activity or any other signal (Q1), and
// nothing here reads or writes a chapter's status - the stage a session is
// logged against is one of the five ChapterStatus values, never a new one.
package production

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

// sessionsSchemaVersion is the only sessions.json version this package reads
// or writes.
const sessionsSchemaVersion = 1

// what names the file for the narrator in a persist notice.
const what = "production time log"

// SourceManual marks a session the narrator started and stopped by hand (Q1
// A). It is the only source there is; the field exists so a later source is
// told apart in the file rather than guessed from its shape.
const SourceManual = "manual"

// ErrTimerRunning is returned by Start while another timer is running: the
// narrator stops it first, so a timer is never switched silently.
var ErrTimerRunning = errors.New("a timer is already running")

// Dir is where this package keeps its data under a project. Unlike the
// derived data a manuscript re-import clears, the time log is kept: the
// hours were worked whatever the manuscript later became.
func Dir(project string) string {
	return filepath.Join(project, "narration-utils", "production")
}

func sessionsPath(project string) string {
	return filepath.Join(Dir(project), "sessions.json")
}

// Session is one stretch of work on one chapter's stage. EndedAt is nil while
// its timer runs; at most one session in a log is running.
type Session struct {
	ID        string       `json:"id"`
	ChapterID string       `json:"chapterId"`
	Stage     stages.Stage `json:"stage"`
	StartedAt time.Time    `json:"startedAt"`
	EndedAt   *time.Time   `json:"endedAt,omitempty"`
	Source    string       `json:"source"`
}

// Running reports whether the session's timer has not been stopped.
func (s Session) Running() bool { return s.EndedAt == nil }

// Duration is the time logged by a stopped session. A running session has
// logged nothing yet, and a session whose end is before its start (the
// system clock was set back while it ran) logs zero rather than a negative
// amount.
func (s Session) Duration() time.Duration {
	if s.EndedAt == nil || s.EndedAt.Before(s.StartedAt) {
		return 0
	}
	return s.EndedAt.Sub(s.StartedAt)
}

func (s Session) clone() Session {
	if s.EndedAt != nil {
		ended := *s.EndedAt
		s.EndedAt = &ended
	}
	return s
}

// sessionsFile is sessions.json: every session logged for one project, in
// the order they were started.
type sessionsFile struct {
	SchemaVersion int       `json:"schemaVersion"`
	Sessions      []Session `json:"sessions"`
}

// Config is what a Service needs.
type Config struct {
	Project string
	// Reporter logs and tells the narrator about a time log that could not be
	// read; nil only reads and keeps.
	Reporter *persist.Reporter
}

// Service starts and stops a project's stage timer and reads its log.
type Service struct {
	config Config
	mu     sync.Mutex
	// now stands in for time.Now in tests.
	// +checklocks:mu
	now func() time.Time
	// rename is a test seam for the atomic write below; nil is os.Rename.
	// +checklocks:mu
	rename func(oldPath, newPath string) error
}

// New returns the service for config.
func New(config Config) *Service {
	return &Service{config: config, now: time.Now}
}

// Start starts a timer on chapterID's stage and logs it as running. It is
// refused with ErrTimerRunning while another timer runs.
func (s *Service) Start(chapterID string, stage stages.Stage) (Session, error) {
	chapterID = strings.TrimSpace(chapterID)
	if chapterID == "" {
		return Session{}, errors.New("choose a chapter to time")
	}
	if !timeable(stage) {
		return Session{}, fmt.Errorf("%q is not a chapter stage", stage)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Session{}, err
	}
	if running, ok := runningIn(file.Sessions); ok {
		return Session{}, timerRunning(file.Sessions[running])
	}
	id, err := newID()
	if err != nil {
		return Session{}, err
	}
	session := Session{
		ID:        id,
		ChapterID: chapterID,
		Stage:     stage,
		StartedAt: s.now().UTC(),
		Source:    SourceManual,
	}
	file.Sessions = append(file.Sessions, session)
	if err := s.writeLocked(file); err != nil {
		return Session{}, err
	}
	return session.clone(), nil
}

// Stop stops the running timer and returns the session it logged. With no
// timer running it is a no-op: it returns false and writes nothing.
func (s *Service) Stop() (Session, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Session{}, false, err
	}
	index, ok := runningIn(file.Sessions)
	if !ok {
		return Session{}, false, nil
	}
	ended := s.now().UTC()
	file.Sessions[index].EndedAt = &ended
	if err := s.writeLocked(file); err != nil {
		return Session{}, false, err
	}
	return file.Sessions[index].clone(), true, nil
}

// Running returns the running session, if there is one.
func (s *Service) Running() (Session, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return Session{}, false, err
	}
	index, ok := runningIn(file.Sessions)
	if !ok {
		return Session{}, false, nil
	}
	return file.Sessions[index].clone(), true, nil
}

// Sessions returns every logged session, the running one included, in the
// order they were started.
func (s *Service) Sessions() ([]Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	out := make([]Session, 0, len(file.Sessions))
	for _, session := range file.Sessions {
		out = append(out, session.clone())
	}
	return out, nil
}

// timeable reports whether stage is one of the five ChapterStatus values.
func timeable(stage stages.Stage) bool {
	switch stage {
	case stages.StageNotStarted, stages.StageRecording, stages.StageEditing, stages.StageProofing, stages.StageFinalized:
		return true
	}
	return false
}

// timerRunning is Start's refusal while session runs, naming what runs.
func timerRunning(session Session) error {
	return fmt.Errorf("%w on %s (%s); stop it first", ErrTimerRunning, session.ChapterID, session.Stage)
}

// path and reporter read the Service's config, which New sets once and nothing changes, so it needs no lock.
func (s *Service) path() string                { return sessionsPath(s.config.Project) }
func (s *Service) reporter() *persist.Reporter { return s.config.Reporter }

func runningIn(sessions []Session) (int, bool) {
	for index, session := range sessions {
		if session.Running() {
			return index, true
		}
	}
	return 0, false
}

func newID() (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("could not name the new session: %w", err)
	}
	return hex.EncodeToString(bytes[:]), nil
}

// validate rejects a decoded log this package would otherwise read as
// something it is not: a stage outside the five, a session with no chapter,
// or more than one running timer.
func validate(file sessionsFile) error {
	running := 0
	for _, session := range file.Sessions {
		if strings.TrimSpace(session.ChapterID) == "" || !timeable(session.Stage) {
			return errors.New("a session names no chapter or an unknown stage")
		}
		if session.Running() {
			running++
		}
	}
	if running > 1 {
		return errors.New("more than one timer is running")
	}
	return nil
}

// readLocked reads sessions.json; s.mu must be held.
//
// +checklocks:s.mu
func (s *Service) readLocked() (sessionsFile, error) {
	var decoded sessionsFile
	newer := 0
	outcome := s.reporter().ReadJSON(s.path(), what, persist.NarratorData, func(raw []byte) error {
		var candidate sessionsFile
		if err := json.Unmarshal(raw, &candidate); err != nil {
			return err
		}
		if candidate.SchemaVersion > sessionsSchemaVersion {
			newer = candidate.SchemaVersion
			return nil
		}
		if err := validate(candidate); err != nil {
			return err
		}
		decoded = candidate
		return nil
	})
	switch outcome {
	case persist.Missing:
		return sessionsFile{SchemaVersion: sessionsSchemaVersion, Sessions: []Session{}}, nil
	case persist.Quarantined, persist.Healed:
		return sessionsFile{}, fmt.Errorf("your %s file could not be read; it was kept aside and a fresh one is started", what)
	case persist.Unreadable:
		return sessionsFile{}, fmt.Errorf("your %s file could not be read", what)
	}
	if err := persist.CheckVersion(newer, sessionsSchemaVersion, what); err != nil {
		return sessionsFile{}, err
	}
	if decoded.Sessions == nil {
		decoded.Sessions = []Session{}
	}
	return decoded, nil
}

// writeLocked replaces sessions.json through a temporary file and a rename;
// s.mu must be held.
//
// +checklocks:s.mu
func (s *Service) writeLocked(file sessionsFile) error {
	file.SchemaVersion = sessionsSchemaVersion
	path := s.path()
	if err := persist.CanOverwrite(path, what); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("could not create the project's production data folder: %w", err)
	}
	bytes, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return fmt.Errorf("could not write the %s file: %w", what, err)
	}
	rename := os.Rename
	if s.rename != nil {
		rename = s.rename
	}
	if err := rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("could not save the %s file: %w", what, err)
	}
	return nil
}
