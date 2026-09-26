// Package pronunciationport is the pronunciation port on the Go side (ADR 0301): which sources the guide sidecar can ask for a
// name's pronunciation, on which platforms, and in which roles. The sources themselves run in Python
// (narration_common.ports.pronunciation); a row here is what the host knows about one without starting it. The host checks the
// narrator's chosen source here before it starts the sidecar, and never compares source names itself. The pronunciationporttest
// suite runs over every row.
package pronunciationport

import (
	"fmt"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Source names, as the sidecar's --source flag spells them.
const (
	CMU    = "cmu"
	Espeak = "espeak"
)

// Roles a source declares in its Descriptor's Modes, as the Python port names them: pronounce gives a name's pronunciation; browse
// (the BrowserLookup role, Q5) gives a page about the name on the source's one browser host, for the narrator's browser, and is
// never fetched by the app. No source takes browse yet.
const (
	ModePronounce = "pronounce"
	ModeBrowse    = "browse"
)

// Modes is every role a row may declare.
func Modes() []string { return []string{ModePronounce, ModeBrowse} }

// Source is what the host knows about one pronunciation source.
type Source interface {
	// Name is the registry row's name.
	Name() string
	// BrowserHost is the one lower-case host a browse source's pages are on; empty for a source without that role.
	BrowserHost() string
}

type source struct{ name string }

func (s source) Name() string        { return s.name }
func (s source) BrowserHost() string { return "" }

// NewRegistry is a registry holding the built-in rows in the build-time fallback's order, CMU first as the default. A test registers
// a fake on its own copy.
func NewRegistry() *port.Registry[Source] {
	r := &port.Registry[Source]{Kind: "pronunciation source"}
	// CMU is quick and good for familiar names; eSpeak covers the names CMU has no entry for.
	r.Register(port.Entry[Source]{
		Name:       CMU,
		Descriptor: port.Descriptor{Label: "CMU dictionary", Modes: []string{ModePronounce}},
		New:        func() Source { return source{CMU} },
	})
	r.Register(port.Entry[Source]{
		Name:       Espeak,
		Descriptor: port.Descriptor{Label: "eSpeak NG", Modes: []string{ModePronounce}},
		New:        func() Source { return source{Espeak} },
	})
	return r
}

// Sources is the program's registry.
var Sources = NewRegistry()

// Names are the sources in Sources declared for platform (a GOOS value) and role, default first.
func Names(platform, mode string) []string { return NamesIn(Sources, platform, mode) }

// NamesIn is Names over registry r.
func NamesIn(r *port.Registry[Source], platform, mode string) []string {
	names := []string{}
	for _, e := range r.Entries() {
		if e.Descriptor.RunsOn(platform) && e.Descriptor.Supports(mode) {
			names = append(names, e.Name)
		}
	}
	return names
}

// FallbackOrder is the order the build-time fallback tries the sources in on platform: every source that gives a pronunciation, in
// registration order, never a browser lookup.
func FallbackOrder(platform string) []string { return Names(platform, ModePronounce) }

// CheckPronounce refuses, with a *port.NotSupportedError, a source the narrator cannot ask for a pronunciation: one that is not
// registered, or one that does not declare the pronounce role.
func CheckPronounce(name string) error { return CheckPronounceIn(Sources, name) }

// CheckPronounceIn is CheckPronounce over registry r.
func CheckPronounceIn(r *port.Registry[Source], name string) error {
	entry, err := r.Lookup(name)
	if err != nil {
		return err
	}
	if !slices.Contains(entry.Descriptor.Modes, ModePronounce) {
		return &port.NotSupportedError{
			Capability: name,
			Support: port.Support{
				Level:   port.Unsupported,
				Reason:  port.ReasonUnsupported,
				Message: fmt.Sprintf("%s cannot give a pronunciation.", entry.Descriptor.Label),
			},
		}
	}
	return nil
}
