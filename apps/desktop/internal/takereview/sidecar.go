package takereview

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// SidecarRequest is everything the sidecar's --find-repeats mode needs
// beyond the manifest file itself, mirroring its argument set
// (sidecars/transcript-compare/core/compare.py).
type SidecarRequest struct {
	ManifestPath   string
	ManuscriptPath string
	TrackName      string
	ChapterTitle   string
	Model          string
	Language       string
	MinSpanOverlap float64
	// ProgressPath is where the sidecar writes its stage|pct|message progress line (ADR 0015), and where a
	// "<ProgressPath>.cancel" file asks it to stop; empty runs it without either.
	ProgressPath string
}

// SidecarRunner runs the sidecar's additive --find-repeats mode and
// returns its raw tagged output text (the SUMMARY/SPAN_GROUP/SPAN_MEMBER
// lines repeats.ParseOutput reads). Scanner depends on this interface, not
// a concrete process invocation, so it can be unit-tested with a fake;
// ProcessRunner is the real implementation.
type SidecarRunner interface {
	FindRepeats(ctx context.Context, req SidecarRequest) (string, error)
}

// ProcessRunner is the real SidecarRunner: it shells out to the Transcript
// Compare sidecar via process.Supervisor.Run, the same synchronous helper
// the packaged smoke test and Story Bible mutations use. It blocks until the
// sidecar exits; the host's scan job (apps/desktop/takereview.go) tails the
// progress file it names meanwhile, and cancelling ctx stops the process.
type ProcessRunner struct {
	Sidecars   *process.Supervisor
	Python     string
	Backend    string
	SessionDir string
}

func (r *ProcessRunner) FindRepeats(ctx context.Context, req SidecarRequest) (string, error) {
	if r.Python == "" || r.Sidecars == nil {
		return "", fmt.Errorf("takereview: configure the Transcript Compare executable before scanning")
	}
	if err := os.MkdirAll(r.SessionDir, 0o755); err != nil {
		return "", fmt.Errorf("takereview: could not create the scan session directory: %w", err)
	}

	out := filepath.Join(r.SessionDir, fmt.Sprintf("repeats_%d.txt", time.Now().UnixNano()))
	args := findRepeatsArgs(req, out)
	if r.Backend != "" {
		args = append([]string{r.Backend}, args...)
	}

	code, _, stderr, err := r.Sidecars.Run(ctx, r.Python, args...)
	if err != nil {
		return "", fmt.Errorf("takereview: could not start the repeated-span detector: %w", err)
	}
	if code != 0 {
		return "", fmt.Errorf("takereview: repeated-span detector exited %d: %s", code, stderr)
	}

	raw, err := os.ReadFile(out)
	if err != nil {
		return "", fmt.Errorf("takereview: could not read the repeated-span detector's output: %w", err)
	}
	return string(raw), nil
}

// findRepeatsArgs is the sidecar's --find-repeats argument list for req, writing its tagged output to out.
func findRepeatsArgs(req SidecarRequest, out string) []string {
	args := []string{"--manifest", req.ManifestPath, "--manuscript", req.ManuscriptPath, "--find-repeats", "--out", out}
	if req.TrackName != "" {
		args = append(args, "--track-name", req.TrackName)
	}
	if req.ChapterTitle != "" {
		args = append(args, "--chapter-title", req.ChapterTitle)
	}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	if req.Language != "" {
		args = append(args, "--language", req.Language)
	}
	if req.MinSpanOverlap > 0 {
		args = append(args, "--min-span-overlap", strconv.FormatFloat(req.MinSpanOverlap, 'f', -1, 64))
	}
	if req.ProgressPath != "" {
		args = append(args, "--progress", req.ProgressPath)
	}
	return args
}
