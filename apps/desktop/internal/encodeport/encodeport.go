// Package encodeport declares the Encoder and Packager ports on the Go side (ADR 0301): turning a rendered WAV into a delivery
// format, and writing chapters and tags into a delivery file. Render goes through REAPER today and nothing encodes, so both
// registries are empty; the render-encode-master PRD adds the first rows (internal/chaptertags is the likely first Packager). The
// encodeporttest suites run over every row, so that first row cannot skip them.
//
// A row's Descriptor.Modes are the formats it handles, as lower-case file extensions without the dot ("mp3", "m4b"): the formats an
// Encoder writes, or the formats of file a Packager packages. Asked for any other, an implementation refuses with
// FormatNotSupported.
package encodeport

import (
	"context"
	"fmt"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Spec is what an Encoder is asked to write. A zero field other than Format leaves the choice to the encoder (its default
// bitrate, the source's sample rate and channels).
type Spec struct {
	Format       string // one of the row's Descriptor.Modes
	BitrateKbps  int
	SampleRateHz int
	Channels     int
}

// Chapter is one chapter's place on the delivery file's timeline, as chaptertags.TimedChapter lays it out.
type Chapter struct {
	Title string
	Start time.Duration
	End   time.Duration
}

// Tags are the delivery file's metadata (title, author, narrator, ...), keyed by lower-case name; a Packager writes the ones its
// format can hold.
type Tags map[string]string

// Encoder writes a delivery file from a rendered WAV.
type Encoder interface {
	// Name is the registry row's name.
	Name() string
	// Encode writes wav, encoded as spec says, to dst. It never changes wav, and on failure (including a cancelled ctx) it leaves
	// nothing at dst.
	Encode(ctx context.Context, wav, dst string, spec Spec) error
}

// Packager writes chapters and tags into a delivery file.
type Packager interface {
	// Name is the registry row's name.
	Name() string
	// Package writes chapters and tags into a new copy of file, beside it, and returns the copy's path. file itself is never
	// changed, as chaptertags.Embed already promises. Its format is its extension.
	Package(ctx context.Context, file string, chapters []Chapter, tags Tags) (string, error)
}

// NewEncoders is an empty encoder registry. A test registers a fake on its own copy.
func NewEncoders() *port.Registry[Encoder] { return &port.Registry[Encoder]{Kind: "encoder"} }

// NewPackagers is an empty packager registry. A test registers a fake on its own copy.
func NewPackagers() *port.Registry[Packager] { return &port.Registry[Packager]{Kind: "packager"} }

// Encoders and Packagers are the program's registries, empty until an implementation lands.
var (
	Encoders  = NewEncoders()
	Packagers = NewPackagers()
)

// FormatNotSupported is the refusal of the kind ("encoder", "packager") called name when asked for a format its row does not
// declare.
func FormatNotSupported(kind, name, format string) error {
	return &port.NotSupportedError{
		Capability: format,
		Support: port.Support{
			Level:   port.Unsupported,
			Reason:  port.ReasonUnsupported,
			Message: fmt.Sprintf("The %s %q cannot write %s files.", kind, name, format),
		},
	}
}
