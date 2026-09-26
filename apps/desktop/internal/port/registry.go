package port

import (
	"fmt"
	"slices"
)

// Platforms are the host's platform names, Go's GOOS values; a Descriptor may list only these.
var Platforms = []string{"windows", "darwin", "linux"}

// Descriptor is what one implementation of a provider port is and can do, as narration_common.ports.Descriptor says it in Python
// (ADR 0301). Platforms are GOOS values, and none means every platform. Modes are the roles it declares (live, batch); a port
// without roles leaves them empty.
type Descriptor struct {
	Label     string
	Platforms []string
	Modes     []string
}

// RunsOn reports whether the implementation is declared for platform.
func (d Descriptor) RunsOn(platform string) bool {
	return len(d.Platforms) == 0 || slices.Contains(d.Platforms, platform)
}

// Supports reports whether the implementation declares mode.
func (d Descriptor) Supports(mode string) bool { return slices.Contains(d.Modes, mode) }

// Entry is one registry row: the name the setting already stores, what the implementation can do, and how to make one.
type Entry[P any] struct {
	Name       string
	Descriptor Descriptor
	New        func() P
}

// Registry maps a provider port's names to its implementations, in registration order: the first row is the default. A call site
// asks it by name and gets an Entry or a *NotSupportedError; it never compares names itself. Rows are registered once, when the
// program starts, and only read after that, so a Registry is not locked. The zero value is an empty registry; Kind names what the
// rows are ("speech engine") for the refusal sentence.
type Registry[P any] struct {
	Kind string
	rows []Entry[P]
}

// Register adds e as the last row. A row that could not work (a name registered twice, no name, label or New, an unknown platform)
// is a bug in the program, so it panics.
func (r *Registry[P]) Register(e Entry[P]) {
	switch {
	case e.Name == "":
		panic(fmt.Sprintf("port: a %s needs a name", r.kind()))
	case e.Descriptor.Label == "":
		panic(fmt.Sprintf("port: %s %q needs a label", r.kind(), e.Name))
	case e.New == nil:
		panic(fmt.Sprintf("port: %s %q needs New", r.kind(), e.Name))
	}
	for _, platform := range e.Descriptor.Platforms {
		if !slices.Contains(Platforms, platform) {
			panic(fmt.Sprintf("port: %s %q declares the platform %q, which is not one of %v", r.kind(), e.Name, platform, Platforms))
		}
	}
	if _, ok := r.find(e.Name); ok {
		panic(fmt.Sprintf("port: a %s called %q is already registered", r.kind(), e.Name))
	}
	r.rows = append(r.rows, e)
}

// Lookup returns the row called name, or a *NotSupportedError whose message says there is none.
func (r *Registry[P]) Lookup(name string) (Entry[P], error) {
	if e, ok := r.find(name); ok {
		return e, nil
	}
	return Entry[P]{}, &NotSupportedError{
		Capability: name,
		Support:    Support{Level: Unsupported, Reason: ReasonUnsupported, Message: fmt.Sprintf("There is no %s called %q.", r.kind(), name)},
	}
}

// Names returns the names declared for platform, in registration order, so the default comes first.
func (r *Registry[P]) Names(platform string) []string {
	names := []string{}
	for _, e := range r.rows {
		if e.Descriptor.RunsOn(platform) {
			names = append(names, e.Name)
		}
	}
	return names
}

// Entries returns every row in registration order, so a port's conformance suite can run over each one.
func (r *Registry[P]) Entries() []Entry[P] { return slices.Clone(r.rows) }

func (r *Registry[P]) find(name string) (Entry[P], bool) {
	for _, e := range r.rows {
		if e.Name == name {
			return e, true
		}
	}
	return Entry[P]{}, false
}

func (r *Registry[P]) kind() string {
	if r.Kind == "" {
		return "provider"
	}
	return r.Kind
}
