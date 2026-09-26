package runlog

import "context"

type contextKey struct{}

// WithRun returns a context carrying run. internal/process's Supervisor.Start, Run and StartStream read it back with
// FromContext, so a sidecar launch several layers below the code that called Begin can log to the same run — and set
// NARRATION_RUN_ID and NARRATION_LOG_LEVEL in the child's environment — without run threaded through every signature
// in between (ctx is already every one of those functions' first parameter).
func WithRun(ctx context.Context, run *Run) context.Context {
	return context.WithValue(ctx, contextKey{}, run)
}

// FromContext returns the run ctx carries, or nil when none was attached. Like every other path into this package, a
// nil Run is safe: every method on it is a no-op.
func FromContext(ctx context.Context) *Run {
	run, _ := ctx.Value(contextKey{}).(*Run)
	return run
}
