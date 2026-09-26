package ttsporttest

import "github.com/countrymanprime/narration-utils/shell/internal/ttsport"

// Fake is a test-only voice engine: it is what its caller says it is.
type Fake struct{ name, assetKind string }

var _ ttsport.Engine = Fake{}

// NewFake is an engine called name whose voices install from assetKind.
func NewFake(name, assetKind string) Fake { return Fake{name: name, assetKind: assetKind} }

func (f Fake) Name() string      { return f.name }
func (f Fake) AssetKind() string { return f.assetKind }
