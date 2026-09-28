package captureporttest

import (
	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Fake is a test-only capture backend: it is what its caller says it is, and Supported.
type Fake struct{ name string }

var _ captureport.Backend = Fake{}

// NewFake is a backend called name.
func NewFake(name string) Fake { return Fake{name: name} }

func (f Fake) Name() string { return f.name }

func (f Fake) Level() port.Level { return port.Supported }
