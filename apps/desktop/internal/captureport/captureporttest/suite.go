// Package captureporttest is the conformance suite every capture backend row must pass (ADR 0301), and a fake backend it runs
// against. The captureport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range captureport.Backends.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { captureporttest.Run(t, entry) })
//	}
package captureporttest

import (
	"fmt"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Run fails t once per broken promise of entry.
func Run(t *testing.T, entry port.Entry[captureport.Backend]) {
	t.Helper()
	for _, p := range Problems(entry) {
		t.Error(p)
	}
}

// Problems is every way entry breaks the port's contract; empty when it conforms. It checks, as the Python CaptureDescriptor does,
// that:
//   - the row has a name and a label, names at least one platform, each once and known to the port, and declares no modes;
//   - New builds a non-nil backend without panicking, which calls itself by the row's name;
//   - what the backend says is static: two backends from New, and two calls on one, answer the same.
func Problems(entry port.Entry[captureport.Backend]) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	if entry.Name == "" {
		report("the row has no name")
	}
	if entry.Descriptor.Label == "" {
		report("%q has no label", entry.Name)
	}
	if len(entry.Descriptor.Platforms) == 0 {
		report("%q names no platform; a capture backend opens one platform's audio API and must name it", entry.Name)
	}
	if len(entry.Descriptor.Modes) > 0 {
		report("%q declares the modes %v, but a capture backend has no modes to declare", entry.Name, entry.Descriptor.Modes)
	}
	for i, platform := range entry.Descriptor.Platforms {
		if !slices.Contains(port.Platforms, platform) {
			report("%q declares the platform %q, which is not one of %v", entry.Name, platform, port.Platforms)
		}
		if slices.Contains(entry.Descriptor.Platforms[:i], platform) {
			report("%q declares the platform %q twice", entry.Name, platform)
		}
	}

	if entry.New == nil {
		report("%q has no New", entry.Name)
		return problems
	}
	first, broken := build(entry)
	if broken != "" {
		report("%q: %s", entry.Name, broken)
		return problems
	}
	second, broken := build(entry)
	if broken != "" {
		report("%q: %s", entry.Name, broken)
		return problems
	}
	name := first.Name()
	if name != entry.Name {
		report("%q's backend calls itself %q", entry.Name, name)
	}
	if name != first.Name() || name != second.Name() {
		report("%q's backend is not static: two answers differed", entry.Name)
	}
	return problems
}

// build calls entry.New, and says how it broke when it panics or returns nil.
func build(entry port.Entry[captureport.Backend]) (backend captureport.Backend, broken string) {
	defer func() {
		if r := recover(); r != nil {
			broken = fmt.Sprintf("New panicked: %v", r)
		}
	}()
	if backend = entry.New(); backend == nil {
		return nil, "New returned a nil backend"
	}
	return backend, ""
}
