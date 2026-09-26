// Package captureport is the microphone capture port on the Go side (ADR 0301): which capture backend the teleprompter sidecar
// lists and opens input devices through on each platform. The backends themselves run in Python (narration_common.ports.capture);
// a row here is what the host knows about one without starting it. A backend opens one platform's own audio API, so every row names
// its platforms and none declares modes. The captureporttest suite runs over every row.
//
// Rows are data, not build tags: the dshow row is compiled on every platform and declares "windows", as the sidecar's devices.py
// imports and runs everywhere and only fails, with a sentence, where dshow is missing. So the host can say on any platform which
// platforms have a backend.
//
// Nothing calls this yet except the provider capabilities binding (provider-ports P14); teleprompterinput.go's deviceLister stays
// the test seam for the device list.
package captureport

import (
	"fmt"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// DShow is the DirectShow backend (FFmpeg's dshow through PyAV), as the sidecar's registry names it.
const DShow = "dshow"

// Backend is what the host knows about one capture backend.
type Backend interface {
	// Name is the registry row's name.
	Name() string
}

type backend struct{ name string }

func (b backend) Name() string { return b.name }

// NewRegistry is a registry holding the built-in rows, dshow first. A test registers a fake on its own copy.
func NewRegistry() *port.Registry[Backend] {
	r := &port.Registry[Backend]{Kind: "capture backend"}
	r.Register(port.Entry[Backend]{
		Name:       DShow,
		Descriptor: port.Descriptor{Label: "DirectShow", Platforms: []string{"windows"}},
		New:        func() Backend { return backend{DShow} },
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
