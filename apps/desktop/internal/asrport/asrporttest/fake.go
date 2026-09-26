package asrporttest

import "github.com/countrymanprime/narration-utils/shell/internal/asrport"

// Fake is a test-only engine: it is what its caller says it is.
type Fake struct{ name, assetKind string }

var _ asrport.Engine = Fake{}

// NewFake is an engine called name whose models install from assetKind.
func NewFake(name, assetKind string) Fake { return Fake{name: name, assetKind: assetKind} }

func (f Fake) Name() string      { return f.name }
func (f Fake) AssetKind() string { return f.assetKind }
