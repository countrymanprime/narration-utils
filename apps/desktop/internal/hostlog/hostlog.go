// Package hostlog is the host's local log (ADR 0069): one append-only text file, capped in size, that records where
// data went wrong and never what the data was. The UI reports a payload that did not match its schema through it
// (SystemReportDiagnostic), and the readers of persisted files report a fallback through it, so a wrong shape leaves a
// trace on the machine. Nothing is uploaded (ADR 0032).
package hostlog

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultMaxBytes caps the log; one backup (`host.log.1`) is kept, so the log never holds more than about twice this.
	DefaultMaxBytes int64 = 1 << 20
	// MaxMessageRunes caps one entry: a stack trace or a long path list is not more useful in full.
	MaxMessageRunes = 2000
)

var kindPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// Log appends entries to a file. A nil *Log accepts and drops every entry so callers that run without a log (tests, a
// failed setup) need no checks.
type Log struct {
	mu       sync.Mutex
	path     string
	maxBytes int64
	now      func() time.Time
}

// New returns a log at path. A maxBytes of 0 or less means DefaultMaxBytes.
func New(path string, maxBytes int64) *Log {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	return &Log{path: path, maxBytes: maxBytes, now: time.Now}
}

// DefaultPath is the per-user log next to the other per-user files (recent projects, global settings).
func DefaultPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", "logs", "host.log")
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", "logs", "host.log")
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", "logs", "host.log")
}

// Path is where the log is written, for messages that tell the narrator where to look.
func (l *Log) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// Report appends one entry: time, a kind such as `wire_invalid` and a message. It is best effort for the caller (the
// UI ignores a failure) but returns the error so a test, or a caller that cares, can see it.
func (l *Log) Report(kind, message string) error {
	if l == nil {
		return nil
	}
	line := fmt.Sprintf("%s %s %s\n", l.now().UTC().Format("2006-01-02T15:04:05.000Z07:00"), cleanKind(kind), cleanMessage(message))
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return fmt.Errorf("could not prepare the host log folder: %w", err)
	}
	if err := l.rotateLocked(int64(len(line))); err != nil {
		return err
	}
	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("could not open the host log: %w", err)
	}
	if _, err := file.WriteString(line); err != nil {
		_ = file.Close()
		return fmt.Errorf("could not write the host log: %w", err)
	}
	return file.Close()
}

// rotateLocked moves the current file to `.1` (replacing any older backup) when the next entry would push it over the cap.
func (l *Log) rotateLocked(next int64) error {
	info, err := os.Stat(l.path)
	if err != nil || info.Size()+next <= l.maxBytes {
		return nil
	}
	backup := l.path + ".1"
	_ = os.Remove(backup)
	if err := os.Rename(l.path, backup); err != nil {
		return fmt.Errorf("could not rotate the host log: %w", err)
	}
	return nil
}

func cleanKind(kind string) string {
	if kindPattern.MatchString(kind) {
		return kind
	}
	return "unknown_kind"
}

// cleanMessage keeps an entry on one line and free of control characters, so a message cannot forge a second entry, and
// cuts it at MaxMessageRunes.
func cleanMessage(message string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, message)
	if runes := []rune(cleaned); len(runes) > MaxMessageRunes {
		return string(runes[:MaxMessageRunes]) + "…"
	}
	return cleaned
}
