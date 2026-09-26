// Package runlog is the host's structured, leveled run log (docs/prds/tool-run-logging.prd.md): JSON lines written
// through log/slog to a capped, rotating file next to host.log. Every tool run gets a run id; the host writes a
// `run.start` record when it begins and a `run.end` record when it finishes, and — once the debug switch is on — the
// decision points in between. Content never enters this log at any level: ids, counts, hashes, paths, timings and
// settings only, never manuscript or transcript text (ADR 0069's "where, not what", threat-model row 7a).
package runlog

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultMaxBytes caps the log; two backups (`run.jsonl.1`, `run.jsonl.2`) are kept, so the log never holds more
	// than about three times this (Decisions Log, Q3).
	DefaultMaxBytes int64 = 5 << 20
	maxBackups            = 2

	timeLayout = "2006-01-02T15:04:05.000Z07:00"
)

// Logger owns the run log file and its level. A nil *Logger accepts every Begin call and returns a nil *Run, which in
// turn drops every record, so callers that run without a logger (tests, a failed setup) need no checks — the same
// nil-log pattern as hostlog.Log.
type Logger struct {
	level     *slog.LevelVar
	envForced bool
	handler   slog.Handler

	mu       sync.Mutex
	path     string
	maxBytes int64

	now   func() time.Time
	newID func() string
}

// New returns a run logger at path. A maxBytes of 0 or less means DefaultMaxBytes. NARRATION_DEBUG=1 turns on debug
// records from construction and cannot be turned off by SetDebug (Q1): a scripted or agent run asks for debug detail
// without touching the Settings page, and a stale setting must not silently defeat it.
func New(path string, maxBytes int64) *Logger {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	l := &Logger{
		level:    new(slog.LevelVar),
		path:     path,
		maxBytes: maxBytes,
		now:      time.Now,
		newID:    newRunID,
	}
	if os.Getenv("NARRATION_DEBUG") == "1" {
		l.level.Set(slog.LevelDebug)
		l.envForced = true
	}
	l.handler = slog.NewJSONHandler(&rotatingWriter{logger: l}, &slog.HandlerOptions{
		Level:       l.level,
		ReplaceAttr: l.replaceAttr,
	})
	return l
}

// DefaultPath is the run log, next to host.log (docs/prds/tool-run-logging.prd.md's Architecture section).
func DefaultPath() string {
	if value := os.Getenv("APPDATA"); value != "" {
		return filepath.Join(value, "narration-utils", "logs", "run.jsonl")
	}
	if value := os.Getenv("USERPROFILE"); value != "" {
		return filepath.Join(value, "AppData", "Roaming", "narration-utils", "logs", "run.jsonl")
	}
	return filepath.Join("AppData", "Roaming", "narration-utils", "logs", "run.jsonl")
}

// Path is where the log is written, for messages that tell the narrator where to look.
func (l *Logger) Path() string {
	if l == nil {
		return ""
	}
	return l.path
}

// SetDebug turns debug-level records on or off. It is a no-op on a nil Logger and, once NARRATION_DEBUG=1 has forced
// debug on, a no-op in either direction: the environment override always wins. It takes effect immediately for every
// run already in progress, since they share this Logger's level.
func (l *Logger) SetDebug(enabled bool) {
	if l == nil || l.envForced {
		return
	}
	if enabled {
		l.level.Set(slog.LevelDebug)
	} else {
		l.level.Set(slog.LevelInfo)
	}
}

// DebugEnabled reports whether decision records are currently written, for callers that build an expensive attribute
// only when it will be kept (the "cost when off" success metric covers the common case: slog itself skips a disabled
// level before formatting, so most callers need not check this first).
func (l *Logger) DebugEnabled() bool {
	if l == nil {
		return false
	}
	return l.level.Level() <= slog.LevelDebug
}

// Run is one tool run's handle: its id and a logger that already carries `run` and `tool` on every record. A nil
// *Run (from a nil *Logger, or returned by nothing else) drops every call.
type Run struct {
	id      string
	tool    string
	logger  *slog.Logger
	now     func() time.Time
	started time.Time
	// runsDir and level back phase 2's StderrWriter (the folder a sidecar's stderr lands in) and Level (the shared
	// level a launched sidecar reads into NARRATION_LOG_LEVEL). Begin fills both; a Run built any other way (there is
	// none today) would find them nil-safe regardless.
	runsDir string
	level   *slog.LevelVar
}

// ID is this run's id, shared with the sidecar it launches and the bridge commands it sends (phases 2 and 6).
func (r *Run) ID() string {
	if r == nil {
		return ""
	}
	return r.id
}

// Begin starts a run for tool, writes its `run.start` record with attrs (key inputs by reference, settings, versions
// — never content), and returns a handle for the decision records and the eventual End. A nil Logger returns a nil
// Run.
func (l *Logger) Begin(tool string, attrs ...any) *Run {
	if l == nil {
		return nil
	}
	id := l.newID()
	runsDir := filepath.Join(filepath.Dir(l.path), "runs")
	l.pruneRunFiles(runsDir)
	run := &Run{
		id:      id,
		tool:    tool,
		logger:  slog.New(l.handler).With("run", id, "tool", tool),
		now:     l.now,
		started: l.now(),
		runsDir: runsDir,
		level:   l.level,
	}
	run.logger.LogAttrs(context.Background(), slog.LevelInfo, tool+" run started", asAttrs(append([]any{"event", "run.start"}, attrs...))...)
	return run
}

// End writes this run's `run.end` record: outcome (for example "ok", "failed", "cancelled"), how long it ran, and
// attrs (counts and ids — never content). It is a no-op on a nil Run, so a launch path that never wrapped its run in
// Begin fails a guard test (phase 3) rather than a nil check at every call site.
func (r *Run) End(outcome string, attrs ...any) {
	if r == nil {
		return
	}
	duration := r.now().Sub(r.started)
	args := append([]any{"event", "run.end", "outcome", outcome, "duration_ms", duration.Milliseconds()}, attrs...)
	r.logger.LogAttrs(context.Background(), slog.LevelInfo, r.tool+" run ended", asAttrs(args)...)
}

// Decision writes one debug-level record for a decision point inside a run (phases 4 to 6): what the tool chose and
// why, in ids and counts. It costs nothing when debug is off — slog checks the level before formatting attrs — and is
// a no-op on a nil Run.
func (r *Run) Decision(event, msg string, attrs ...any) {
	if r == nil {
		return
	}
	r.logger.LogAttrs(context.Background(), slog.LevelDebug, msg, asAttrs(append([]any{"event", event}, attrs...))...)
}

func asAttrs(args []any) []slog.Attr {
	attrs := make([]slog.Attr, 0, len(args)/2)
	for i := 0; i+1 < len(args); i += 2 {
		key, ok := args[i].(string)
		if !ok {
			continue
		}
		attrs = append(attrs, slog.Any(key, args[i+1]))
	}
	return attrs
}

// replaceAttr renames the handler's own time key to `ts`, formatted through this Logger's clock (a test seam,
// fixedClock in tests) rather than the real wall clock slog would otherwise stamp records with, and lowercases the
// level so records read "debug"/"info"/"warn"/"error" rather than slog's default upper case.
func (l *Logger) replaceAttr(groups []string, a slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return a
	}
	switch a.Key {
	case slog.TimeKey:
		return slog.String("ts", l.now().UTC().Format(timeLayout))
	case slog.LevelKey:
		return slog.String("level", strings.ToLower(a.Value.String()))
	}
	return a
}

func newRunID() string {
	var buf [8]byte
	_, _ = rand.Read(buf[:])
	return fmt.Sprintf("%s-%s", time.Now().UTC().Format("20060102T150405.000"), hex.EncodeToString(buf[:]))
}

// rotatingWriter is the JSON handler's sink: it rotates the file (current -> .1 -> .2, dropping any older backup)
// before a write that would push it over the cap, the same shape as hostlog.rotateLocked, and serializes writes so
// concurrent runs never interleave a line.
type rotatingWriter struct {
	logger *Logger
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	l := w.logger
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
		return 0, fmt.Errorf("could not prepare the run log folder: %w", err)
	}
	if err := l.rotateLocked(int64(len(p))); err != nil {
		return 0, err
	}
	file, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, fmt.Errorf("could not open the run log: %w", err)
	}
	n, err := file.Write(p)
	if err != nil {
		_ = file.Close()
		return n, err
	}
	return n, file.Close()
}

// rotateLocked moves the current file down the backup chain when the next write would push it over the cap. Callers
// hold l.mu.
func (l *Logger) rotateLocked(next int64) error {
	info, err := os.Stat(l.path)
	if err != nil || info.Size()+next <= l.maxBytes {
		return nil
	}
	oldest := fmt.Sprintf("%s.%d", l.path, maxBackups)
	_ = os.Remove(oldest)
	for i := maxBackups - 1; i >= 1; i-- {
		from := fmt.Sprintf("%s.%d", l.path, i)
		to := fmt.Sprintf("%s.%d", l.path, i+1)
		if _, err := os.Stat(from); err == nil {
			if err := os.Rename(from, to); err != nil {
				return fmt.Errorf("could not rotate the run log: %w", err)
			}
		}
	}
	if err := os.Rename(l.path, l.path+".1"); err != nil {
		return fmt.Errorf("could not rotate the run log: %w", err)
	}
	return nil
}
