package runlog

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// DiagnosticsScope picks which records ExportDiagnostics gathers (PRD Q5: "last run" or "last 30 minutes").
type DiagnosticsScope struct {
	// RunID, when set, keeps only this run's own records (and its stderr file, if one exists under logs/runs/).
	// Empty means the Since window below applies instead.
	RunID string
	// Since keeps every record no older than this far back from now. Ignored when RunID is set.
	Since time.Duration
}

// LastRunID returns the run id of the last record in the log, or "" if the log has no records yet (a fresh install,
// or one with debug never turned on and no job run since the file last rotated).
func (l *Logger) LastRunID() (string, error) {
	if l == nil {
		return "", nil
	}
	file, err := os.Open(l.path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("could not open the run log: %w", err)
	}
	defer func() { _ = file.Close() }() // read-only

	var last string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		var record struct {
			Run string `json:"run"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			continue
		}
		if record.Run != "" {
			last = record.Run
		}
	}
	return last, scanner.Err()
}

// ExportDiagnostics writes destPath as one .jsonl file holding the run log's own records matching scope, plus (for a
// RunID scope) that run's own logs/runs/<run-id>.stderr.jsonl if one exists — the host and sidecar records of one run
// side by side, the way the PRD's user flow describes handing a run to an agent. It returns the number of lines
// written. A nil Logger writes nothing and returns (0, nil): there is no log to export from.
func (l *Logger) ExportDiagnostics(scope DiagnosticsScope, destPath string) (int, error) {
	if l == nil {
		return 0, nil
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return 0, fmt.Errorf("could not prepare the diagnostics folder: %w", err)
	}
	out, err := os.OpenFile(destPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, fmt.Errorf("could not create the diagnostics file: %w", err)
	}
	defer func() { _ = out.Close() }()

	written, err := copyMatchingLines(out, l.path, scope, l.now())
	if err != nil {
		return written, err
	}
	if scope.RunID != "" {
		stderrPath := filepath.Join(filepath.Dir(l.path), "runs", scope.RunID+".stderr.jsonl")
		more, err := copyRawLines(out, stderrPath)
		written += more
		if err != nil {
			return written, err
		}
	}
	if err := out.Close(); err != nil {
		return written, fmt.Errorf("could not finish the diagnostics file: %w", err)
	}
	return written, nil
}

// copyMatchingLines appends run.jsonl's records matching scope to out, one JSON object per source line (a source
// line that fails to parse, or that scope excludes, is skipped rather than copied verbatim, since a hand-edited or
// mid-rotation line must not smuggle unfiltered content into the bundle).
func copyMatchingLines(out *os.File, path string, scope DiagnosticsScope, now time.Time) (int, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("could not open the run log: %w", err)
	}
	defer func() { _ = file.Close() }() // read-only

	cutoff := now.Add(-scope.Since)
	written := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		var record struct {
			Run string `json:"run"`
			Ts  string `json:"ts"`
		}
		line := scanner.Bytes()
		if err := json.Unmarshal(line, &record); err != nil {
			continue
		}
		if scope.RunID != "" {
			if record.Run != scope.RunID {
				continue
			}
		} else if scope.Since > 0 {
			ts, err := time.Parse(timeLayout, record.Ts)
			if err != nil || ts.Before(cutoff) {
				continue
			}
		}
		if _, err := out.Write(append(append([]byte(nil), line...), '\n')); err != nil {
			return written, fmt.Errorf("could not write the diagnostics file: %w", err)
		}
		written++
	}
	return written, scanner.Err()
}

// copyRawLines appends every line of path to out unfiltered: a per-run stderr file already belongs to exactly one
// run, so nothing more to match against.
func copyRawLines(out *os.File, path string) (int, error) {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("could not open the run's stderr file: %w", err)
	}
	defer func() { _ = file.Close() }() // read-only

	written := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		if _, err := out.Write(append(append([]byte(nil), scanner.Bytes()...), '\n')); err != nil {
			return written, fmt.Errorf("could not write the diagnostics file: %w", err)
		}
		written++
	}
	return written, scanner.Err()
}
