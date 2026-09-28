// Package captureport is the microphone capture port on the Go side (ADR 0301): which capture backend the teleprompter sidecar
// lists and opens input devices through on each platform. The backends themselves run in Python (narration_common.ports.capture);
// a row here is what the host knows about one without starting it. A backend opens one platform's own audio API, so every row names
// its platforms and none declares modes. The captureporttest suite runs over every row.
//
// Rows are data, not build tags: the dshow row is compiled on every platform and declares "windows", as the sidecar's devices.py
// imports and runs everywhere and only fails, with a sentence, where dshow is missing. So the host can say on any platform which
// platforms have a backend.
//
// Each row also says how far it is supported (Level): dshow is Supported; wasapi, the built-in recorder's engine
// (native-recording-suite P1, docs/adr/0357), is Experimental until the owner's check with a real microphone (#510).
//
// Its callers are the provider capabilities binding (provider-ports P14), the packaged app's smoke test and the Booth's
// "Built-in recorder" (native-recording-suite P2, docs/adr/0455), whose internal/recording engine records through the wasapi
// row by its name; teleprompterinput.go's deviceLister stays the test seam for the teleprompter's device list.
package captureport

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// The backends, as the sidecar's registry names them.
const (
	// DShow is the DirectShow backend (FFmpeg's dshow through PyAV), the teleprompter's microphone.
	DShow = "dshow"
	// WASAPI is WASAPI in shared mode through PortAudio (sounddevice), which also records a take to a WAV file at the
	// device's own rate: the built-in recorder's engine (docs/adr/0357).
	WASAPI = "wasapi"
)

// Backend is what the host knows about one capture backend.
type Backend interface {
	// Name is the registry row's name.
	Name() string
	// Level is how far the row is supported: Supported, or Experimental while it waits for the owner's verification.
	Level() port.Level
}

type backend struct {
	name  string
	level port.Level
}

func (b backend) Name() string      { return b.name }
func (b backend) Level() port.Level { return b.level }

// NewRegistry is a registry holding the built-in rows, dshow and then wasapi: Windows is the only supported platform
// (docs/adr/0412), and dshow, registered first, stays its default. A test registers a fake on its own copy.
func NewRegistry() *port.Registry[Backend] {
	r := &port.Registry[Backend]{Kind: "capture backend"}
	r.Register(port.Entry[Backend]{
		Name:       DShow,
		Descriptor: port.Descriptor{Label: "DirectShow", Platforms: []string{"windows"}},
		New:        func() Backend { return backend{DShow, port.Supported} },
	})
	r.Register(port.Entry[Backend]{
		Name:       WASAPI,
		Descriptor: port.Descriptor{Label: "WASAPI", Platforms: []string{"windows"}},
		New:        func() Backend { return backend{WASAPI, port.Experimental} },
	})
	return r
}

// Backends is the program's registry.
var Backends = NewRegistry()

// For is the backend in Backends for platform (a GOOS value): the first row declared for it, which is the default.
func For(platform string) (port.Entry[Backend], error) { return ForIn(Backends, platform) }

// ForIn is For over registry r. A platform no row declares gets a *port.NotSupportedError.
func ForIn(r *port.Registry[Backend], platform string) (port.Entry[Backend], error) {
	for _, e := range r.Entries() {
		if e.Descriptor.RunsOn(platform) {
			return e, nil
		}
	}
	return port.Entry[Backend]{}, &port.NotSupportedError{
		Capability: "capture",
		Support: port.Support{
			Level:   port.Unsupported,
			Reason:  port.ReasonUnsupported,
			Message: fmt.Sprintf("There is no capture backend for %s.", platform),
		},
	}
}
