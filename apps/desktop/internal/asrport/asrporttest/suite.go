// Package asrporttest is the conformance suite every speech engine row must pass (ADR 0301), and a fake engine it runs against.
// The asrport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range asrport.Engines.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { asrporttest.Run(t, entry) })
//	}
package asrporttest

import (
	"fmt"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Run fails t once per broken promise of entry.
func Run(t *testing.T, entry port.Entry[asrport.Engine]) {
	t.Helper()
	for _, p := range Problems(entry) {
		t.Error(p)
	}
}

// Problems is every way entry breaks the port's contract; empty when it conforms. It checks that:
//   - the row has a name and a label, declares at least one mode, and each mode and platform once and known to the port;
//   - New builds a non-nil engine without panicking, which calls itself by the row's name and names an asset kind;
//   - what the engine says is static: two engines from New, and two calls on one, answer the same.
func Problems(entry port.Entry[asrport.Engine]) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	if entry.Name == "" {
		report("the row has no name")
	}
	if entry.Descriptor.Label == "" {
		report("%q has no label", entry.Name)
	}
	if len(entry.Descriptor.Modes) == 0 {
		report("%q declares no mode; it must declare at least one of %v", entry.Name, asrport.Modes())
	}
	checkSet := func(what string, values, known []string) {
		for i, v := range values {
			if !slices.Contains(known, v) {
				report("%q declares the %s %q, which is not one of %v", entry.Name, what, v, known)
			}
			if slices.Contains(values[:i], v) {
				report("%q declares the %s %q twice", entry.Name, what, v)
			}
		}
	}
	checkSet("mode", entry.Descriptor.Modes, asrport.Modes())
	checkSet("platform", entry.Descriptor.Platforms, port.Platforms)

	if entry.New == nil {
		report("%q has no New", entry.Name)
		return problems
	}
	first, err := build(entry)
	if err != nil {
		report("%q: %v", entry.Name, err)
		return problems
	}
	second, err := build(entry)
	if err != nil {
		report("%q: %v", entry.Name, err)
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

func build(entry port.Entry[asrport.Engine]) (engine asrport.Engine, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("New panicked: %v", r)
		}
	}()
	if engine = entry.New(); engine == nil {
		return nil, fmt.Errorf("New returned a nil engine")
	}
	return engine, nil
}
