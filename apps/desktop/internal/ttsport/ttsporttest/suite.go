// Package ttsporttest is the conformance suite every voice engine row must pass (ADR 0301), and a fake engine it runs against. The
// ttsport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range ttsport.Engines.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { ttsporttest.Run(t, entry) })
//	}
package ttsporttest

import (
	"fmt"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
)

// Run fails t once per broken promise of entry.
func Run(t *testing.T, entry port.Entry[ttsport.Engine]) {
	t.Helper()
	for _, p := range Problems(entry) {
		t.Error(p)
	}
}

// Problems is every way entry breaks the port's contract; empty when it conforms. It checks that:
//   - the row has a name and a label, declares no mode (a voice engine has one job, as TtsDescriptor says in Python), and each
//     platform once and known to the port;
//   - New builds a non-nil engine without panicking, which calls itself by the row's name and names an asset kind;
//   - what the engine says is static: two engines from New, and two calls on one, answer the same.
func Problems(entry port.Entry[ttsport.Engine]) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	if entry.Name == "" {
		report("the row has no name")
	}
	if entry.Descriptor.Label == "" {
		report("%q has no label", entry.Name)
	}
	for _, mode := range entry.Descriptor.Modes {
		report("%q declares the mode %q; a voice engine has no modes", entry.Name, mode)
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
	if first.Name() != entry.Name {
		report("%q's engine calls itself %q", entry.Name, first.Name())
	}
	kind := first.AssetKind()
	if kind == "" {
		report("%q's engine names no asset kind", entry.Name)
	}
	if first.Name() != second.Name() || kind != second.AssetKind() || kind != first.AssetKind() {
		report("%q's engine is not static: two answers differed", entry.Name)
	}
	return problems
}

// build calls entry.New, and says how it broke when it panics or returns nil.
func build(entry port.Entry[ttsport.Engine]) (engine ttsport.Engine, broken string) {
	defer func() {
		if r := recover(); r != nil {
			broken = fmt.Sprintf("New panicked: %v", r)
		}
	}()
	if engine = entry.New(); engine == nil {
		return nil, "New returned a nil engine"
	}
	return engine, ""
}
