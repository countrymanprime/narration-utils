// Package latency holds the manually run harness that measures how long the Story Bible operations and the heavier Go-native calls
// take, so the interaction feedback standard (docs/architecture/interaction-feedback.md) is decided from numbers instead of guesses.
//
// The harness is a test under the "latency" build tag and is not part of the gate: it needs a Python environment or a frozen
// sidecar and takes minutes. See latency_test.go for how to run it and docs/research/interaction-latency-baseline.md for the results.
package latency
