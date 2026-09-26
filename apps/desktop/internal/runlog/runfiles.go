package runlog

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	// maxRunFiles and maxRunFileAge are Q3's per-run retention: the last 20 runs or 7 days, whichever keeps fewer. A
	// file must be within both to survive a prune — the more aggressive of the two limits wins, never the looser one.
	maxRunFiles   = 20
	maxRunFileAge = 7 * 24 * time.Hour
)

// Level is "debug" or "info", read live from the shared level a sidecar's NARRATION_LOG_LEVEL is built from — not
// fixed at Begin, so a sidecar started after the narrator turns debug on mid-run still gets it. "info" on a nil Run.
func (r *Run) Level() string {
	if r == nil || r.level == nil || r.level.Level() > slog.LevelDebug {
		return "info"
	}
	return "debug"
}

// StderrWriter appends everything written to it to this run's own file, logs/runs/<run-id>.stderr.jsonl — the sidecar
// stderr internal/process now keeps instead of discarding. A nil Run, or one with no runs folder, discards silently:
// a run only exists to log, never to block whatever launched it.
func (r *Run) StderrWriter() io.WriteCloser {
	if r == nil || r.runsDir == "" {
		return discardWriteCloser{}
	}
	return &stderrFileWriter{path: filepath.Join(r.runsDir, r.id+".stderr.jsonl")}
}

type discardWriteCloser struct{}

func (discardWriteCloser) Write(p []byte) (int, error) { return len(p), nil }
func (discardWriteCloser) Close() error                { return nil }

// stderrFileWriter opens, appends and closes on every Write, the same shape as hostlog.Log.Report and runlog's own
// rotatingWriter: simple, and safe without a mutex here since exec.Cmd relays one stream through one goroutine, so a
// given run's file only ever has one writer.
type stderrFileWriter struct{ path string }

func (w *stderrFileWriter) Write(p []byte) (int, error) {
	if err := os.MkdirAll(filepath.Dir(w.path), 0o755); err != nil {
		return 0, fmt.Errorf("could not prepare the run's stderr folder: %w", err)
	}
	file, err := os.OpenFile(w.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, fmt.Errorf("could not open the run's stderr file: %w", err)
	}
	defer file.Close()
	return file.Write(p)
}

func (w *stderrFileWriter) Close() error { return nil }

// pruneRunFiles keeps the newest maxRunFiles files in dir and drops any older than maxRunFileAge, run on every Begin
// so a burst of short runs cannot fill the disk and a quiet week does not keep stale debug detail around (Q3). A
// missing dir (nothing has run yet) is not an error.
func (l *Logger) pruneRunFiles(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type file struct {
		path    string
		modTime time.Time
	}
	files := make([]file, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, file{filepath.Join(dir, entry.Name()), info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modTime.After(files[j].modTime) })
	now := l.now()
	for i, f := range files {
		if i >= maxRunFiles || now.Sub(f.modTime) > maxRunFileAge {
			_ = os.Remove(f.path)
		}
	}
}
