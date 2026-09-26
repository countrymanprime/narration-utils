package pronunciationporttest

import "github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"

// Fake is a test-only pronunciation source: it is what its caller says it is.
type Fake struct{ name, browserHost string }

var _ pronunciationport.Source = Fake{}

// NewFake is a source called name whose browse pages, if it has the role, are on browserHost.
func NewFake(name, browserHost string) Fake { return Fake{name: name, browserHost: browserHost} }

func (f Fake) Name() string        { return f.name }
func (f Fake) BrowserHost() string { return f.browserHost }
