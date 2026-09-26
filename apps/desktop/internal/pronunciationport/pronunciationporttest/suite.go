// Package pronunciationporttest is the conformance suite every pronunciation source row must pass (ADR 0301), and a fake source it
// runs against. The pronunciationport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range pronunciationport.Sources.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { pronunciationporttest.Run(t, entry) })
//	}
package pronunciationporttest

import (
	"fmt"
	"regexp"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
)

// host is a lower-case host name with at least one dot and no scheme, port or path, as PronunciationDescriptor checks it in Python.
var host = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)

// Run fails t once per broken promise of entry.
func Run(t *testing.T, entry port.Entry[pronunciationport.Source]) {
	t.Helper()
	for _, p := range Problems(entry) {
		t.Error(p)
	}
}

// Problems is every way entry breaks the port's contract; empty when it conforms. It checks that:
//   - the row has a name and a label, declares at least one role, and each role and platform once and known to the port;
//   - New builds a non-nil source without panicking, which calls itself by the row's name;
//   - a source names a browser host exactly when it declares browse, and that host is a lower-case host name;
//   - what the source says is static: two sources from New, and two calls on one, answer the same.
func Problems(entry port.Entry[pronunciationport.Source]) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	if entry.Name == "" {
		report("the row has no name")
	}
	if entry.Descriptor.Label == "" {
		report("%q has no label", entry.Name)
	}
	if len(entry.Descriptor.Modes) == 0 {
		report("%q declares no mode; it must declare at least one of %v", entry.Name, pronunciationport.Modes())
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
	checkSet("mode", entry.Descriptor.Modes, pronunciationport.Modes())
	checkSet("platform", entry.Descriptor.Platforms, port.Platforms)

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
		report("%q's source calls itself %q", entry.Name, first.Name())
	}
	browserHost := first.BrowserHost()
	browses := entry.Descriptor.Supports(pronunciationport.ModeBrowse)
	switch {
	case browses && browserHost == "":
		report("%q declares browse, so it needs the browser host its pages are on", entry.Name)
	case !browses && browserHost != "":
		report("%q has the browser host %q but does not declare browse", entry.Name, browserHost)
	case browserHost != "" && !host.MatchString(browserHost):
		report("%q: %q is not a lower-case host name", entry.Name, browserHost)
	}
	if first.Name() != second.Name() || browserHost != second.BrowserHost() || browserHost != first.BrowserHost() {
		report("%q's source is not static: two answers differed", entry.Name)
	}
	return problems
}

// build calls entry.New, and says how it broke when it panics or returns nil.
func build(entry port.Entry[pronunciationport.Source]) (source pronunciationport.Source, broken string) {
	defer func() {
		if r := recover(); r != nil {
			broken = fmt.Sprintf("New panicked: %v", r)
		}
	}()
	if source = entry.New(); source == nil {
		return nil, "New returned a nil source"
	}
	return source, ""
}
