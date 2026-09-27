// Package ttsport is the text to speech port on the Go side (ADR 0301): which voice engines the host can hand the guide sidecar, on
// which platforms, and which asset kind their voices install from. The engines themselves run in Python (narration_common.ports.tts);
// a row here is what the host knows about one without starting it. The Piper.tts_provider setting's choices come from the registry,
// and call sites ask it by the name the setting stores rather than comparing names. The ttsporttest suite runs over every row.
package ttsport

import "github.com/countrymanprime/narration-utils/shell/internal/port"

// Piper is the one voice engine today, as the Piper.tts_provider setting spells it.
const Piper = "piper"

// Engine is what the host knows about one voice engine. A voice engine has one job, so its row declares no modes.
type Engine interface {
	// Name is the registry row's name.
	Name() string
	// AssetKind is the asset catalog kind its voices install from (assetRegistry's install kind).
	AssetKind() string
}

type engine struct{ name, assetKind string }

func (e engine) Name() string      { return e.name }
func (e engine) AssetKind() string { return e.assetKind }

// NewRegistry is a registry holding the built-in rows, Piper first as the default. A test registers a fake on its own copy.
func NewRegistry() *port.Registry[Engine] {
	r := &port.Registry[Engine]{Kind: "voice engine"}
	r.Register(port.Entry[Engine]{
		Name:       Piper,
		Descriptor: port.Descriptor{Label: "Piper"},
		New:        func() Engine { return engine{Piper, "tts"} },
	})
	return r
}

// Engines is the program's registry.
var Engines = NewRegistry()

// Names are the engines in Engines declared for platform (a GOOS value), default first.
func Names(platform string) []string { return Engines.Names(platform) }

// Default is the engine used when no scope sets one: the first row registered.
func Default() string { return Engines.Entries()[0].Name }
