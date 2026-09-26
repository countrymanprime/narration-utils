package ttsporttest

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
)

func fakeEntry(name string) port.Entry[ttsport.Engine] {
	return port.Entry[ttsport.Engine]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake"},
		New:        func() ttsport.Engine { return NewFake(name, "fake") },
	}
}

func TestTheFakePassesTheSuite(t *testing.T) {
	Run(t, fakeEntry("fake"))
}

type flipping struct{ calls *int }

func (f flipping) Name() string { return "fake" }
func (f flipping) AssetKind() string {
	*f.calls++
	if *f.calls%2 == 0 {
		return "b"
	}
	return "a"
}

func TestTheSuiteCatchesABrokenRow(t *testing.T) {
	cases := map[string]struct {
		edit func(*port.Entry[ttsport.Engine])
		want string
	}{
		"no name":          {func(e *port.Entry[ttsport.Engine]) { e.Name = "" }, "has no name"},
		"no label":         {func(e *port.Entry[ttsport.Engine]) { e.Descriptor.Label = "" }, "has no label"},
		"a mode":           {func(e *port.Entry[ttsport.Engine]) { e.Descriptor.Modes = []string{"live"} }, "declares the mode"},
		"unknown platform": {func(e *port.Entry[ttsport.Engine]) { e.Descriptor.Platforms = []string{"plan9"} }, `platform "plan9"`},
		"platform twice":   {func(e *port.Entry[ttsport.Engine]) { e.Descriptor.Platforms = []string{"linux", "linux"} }, `platform "linux" twice`},
		"no New":           {func(e *port.Entry[ttsport.Engine]) { e.New = nil }, "has no New"},
		"nil engine":       {func(e *port.Entry[ttsport.Engine]) { e.New = func() ttsport.Engine { return nil } }, "nil engine"},
		"panicking New":    {func(e *port.Entry[ttsport.Engine]) { e.New = func() ttsport.Engine { panic("boom") } }, "panicked: boom"},
		"wrong name":       {func(e *port.Entry[ttsport.Engine]) { e.New = func() ttsport.Engine { return NewFake("other", "fake") } }, `calls itself "other"`},
		"no asset kind":    {func(e *port.Entry[ttsport.Engine]) { e.New = func() ttsport.Engine { return NewFake("fake", "") } }, "no asset kind"},
		"asset kind changes": {func(e *port.Entry[ttsport.Engine]) {
			calls := 0
			e.New = func() ttsport.Engine { return flipping{&calls} }
		}, "not static"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entry := fakeEntry("fake")
			tc.edit(&entry)
			problems := Problems(entry)
			for _, p := range problems {
				if strings.Contains(p, tc.want) {
					return
				}
			}
			t.Fatalf("Problems = %q, want one containing %q", problems, tc.want)
		})
	}
}
