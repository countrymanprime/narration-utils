// Package asrport is the speech recognition port on the Go side (ADR 0301): which engines the host can hand the sidecars, on which
// platforms, in which modes, and which asset kind their models install from. The engines themselves run in Python
// (narration_common.ports.asr); a row here is what the host knows about one without starting it. Call sites ask the registry by the
// name the setting stores and never compare names themselves. The asrporttest suite runs over every row.
package asrport

import (
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Engine names, as the sidecars' --engine flag and the Teleprompter.engine setting spell them.
const (
	Whisper   = "whisper"
	Moonshine = "moonshine"
)

// Modes an engine declares in its Descriptor: live transcribes the microphone as the narrator reads (the teleprompter), batch a
// finished recording (transcript compare).
const (
	ModeLive  = "live"
	ModeBatch = "batch"
)

// Modes is every mode a row may declare.
func Modes() []string { return []string{ModeLive, ModeBatch} }

// Engine is what the host knows about one speech engine.
type Engine interface {
	// Name is the registry row's name.
	Name() string
	// AssetKind is the asset catalog kind its models install from (assetRegistry's install kind).
	AssetKind() string
}

type engine struct{ name, assetKind string }

func (e engine) Name() string      { return e.name }
func (e engine) AssetKind() string { return e.assetKind }

// NewRegistry is a registry holding the built-in rows, Whisper first as the default. A test registers a fake on its own copy.
func NewRegistry() *port.Registry[Engine] {
	r := &port.Registry[Engine]{Kind: "speech engine"}
	r.Register(port.Entry[Engine]{
		Name:       Whisper,
		Descriptor: port.Descriptor{Label: "Whisper", Modes: []string{ModeLive, ModeBatch}},
		New:        func() Engine { return engine{Whisper, "whisper"} },
	})
	// Moonshine ships only in the Windows sidecar (ADR 0107), and only the live sidecar loads it.
	r.Register(port.Entry[Engine]{
		Name:       Moonshine,
		Descriptor: port.Descriptor{Label: "Moonshine", Platforms: []string{"windows"}, Modes: []string{ModeLive}},
		New:        func() Engine { return engine{Moonshine, "moonshine"} },
	})
	return r
}

// Engines is the program's registry.
var Engines = NewRegistry()

// Names are the engines in Engines declared for platform (a GOOS value) and mode, default first.
func Names(platform, mode string) []string { return NamesIn(Engines, platform, mode) }

// NamesIn is Names over registry r.
func NamesIn(r *port.Registry[Engine], platform, mode string) []string {
	names := []string{}
	for _, e := range r.Entries() {
		if e.Descriptor.RunsOn(platform) && e.Descriptor.Supports(mode) {
			names = append(names, e.Name)
		}
	}
	return names
}

// Supports reports whether engine is one of Names(platform, mode).
func Supports(platform, mode, engine string) bool {
	return slices.Contains(Names(platform, mode), engine)
}
