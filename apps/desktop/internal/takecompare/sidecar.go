package takecompare

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/process"
)

// SidecarRequest is what the sidecar's --take-divergence mode needs beyond the manifest itself.
type SidecarRequest struct {
	ManifestPath   string
	ManuscriptPath string
	Model          string
	Language       string
	// ProgressPath is where the sidecar writes its stage|pct|message line (ADR 0015); "<ProgressPath>.cancel" asks it
	// to stop between takes. Empty runs it without either.
	ProgressPath string
}

// SidecarRunner runs compare.py --take-divergence and answers its results file's text. Comparer depends on this
// interface so it can be tested with a fake; ProcessRunner is the real one.
type SidecarRunner interface {
	TakeDivergence(ctx context.Context, req SidecarRequest) (string, error)
}

// ProcessRunner runs the Transcript Compare sidecar through the process supervisor, as the take-review scan does
// (internal/takereview.ProcessRunner): an argv slice, never a shell, inside the Job Object.
type ProcessRunner struct {
	Sidecars   *process.Supervisor
	Python     string
	Backend    string
	SessionDir string
}

// exitCancelled is the mode's own exit code for a run stopped through its cancel file.
const exitCancelled = 2

func (r *ProcessRunner) TakeDivergence(ctx context.Context, req SidecarRequest) (string, error) {
	if r.Python == "" || r.Sidecars == nil {
		return "", fmt.Errorf("takecompare: configure the Transcript Compare executable before comparing takes")
	}
	if err := os.MkdirAll(r.SessionDir, 0o755); err != nil {
		return "", fmt.Errorf("takecompare: could not create the comparison session folder: %w", err)
	}
	out := filepath.Join(r.SessionDir, fmt.Sprintf("take_divergence_%d.txt", time.Now().UnixNano()))
	defer func() { _ = os.Remove(out) }()
	args := takeDivergenceArgs(req, out)
	if r.Backend != "" {
		args = append([]string{r.Backend}, args...)
	}
	code, _, stderr, err := r.Sidecars.Run(ctx, r.Python, args...)
	switch {
	case err != nil:
		return "", fmt.Errorf("takecompare: could not start the take aligner: %w", err)
	case code == exitCancelled && ctx.Err() != nil:
		return "", ctx.Err()
	case code != 0:
		return "", fmt.Errorf("takecompare: the take aligner exited %d: %s", code, stderr)
	}
	raw, err := os.ReadFile(out)
	if err != nil {
		return "", fmt.Errorf("takecompare: could not read the take aligner's results: %w", err)
	}
	return string(raw), nil
}

// takeDivergenceArgs is the --take-divergence argument list for req. Every path in it is one the host built itself:
// the manifest and results in its own session folder, the manuscript at the project's canonical path (threat model 4f).
func takeDivergenceArgs(req SidecarRequest, out string) []string {
	args := []string{"--manifest", req.ManifestPath, "--manuscript", req.ManuscriptPath, "--take-divergence", "--out", out}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	if req.Language != "" {
		args = append(args, "--language", req.Language)
	}
	if req.ProgressPath != "" {
		args = append(args, "--progress", req.ProgressPath)
	}
	return args
}
