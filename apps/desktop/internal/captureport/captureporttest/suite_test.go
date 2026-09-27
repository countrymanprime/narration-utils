package captureporttest

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func fakeEntry(name string) port.Entry[captureport.Backend] {
	return port.Entry[captureport.Backend]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake", Platforms: []string{"linux"}},
		New:        func() captureport.Backend { return NewFake(name) },
	}
}

func TestTheFakePassesTheSuite(t *testing.T) {
	Run(t, fakeEntry("fake"))
}

type flipping struct{ calls *int }

func (f flipping) Name() string {
	*f.calls++
	if *f.calls%2 == 0 {
		return "other"
	}
	return "fake"
}

func TestTheSuiteCatchesABrokenRow(t *testing.T) {
	cases := map[string]struct {
		edit func(*port.Entry[captureport.Backend])
		want string
	}{
		"no name":          {func(e *port.Entry[captureport.Backend]) { e.Name = "" }, "has no name"},
		"no label":         {func(e *port.Entry[captureport.Backend]) { e.Descriptor.Label = "" }, "has no label"},
		"no platforms":     {func(e *port.Entry[captureport.Backend]) { e.Descriptor.Platforms = nil }, "names no platform"},
		"a mode":           {func(e *port.Entry[captureport.Backend]) { e.Descriptor.Modes = []string{"live"} }, "no modes to declare"},
		"unknown platform": {func(e *port.Entry[captureport.Backend]) { e.Descriptor.Platforms = []string{"plan9"} }, `platform "plan9"`},
		"platform twice":   {func(e *port.Entry[captureport.Backend]) { e.Descriptor.Platforms = []string{"linux", "linux"} }, `platform "linux" twice`},
		"no New":           {func(e *port.Entry[captureport.Backend]) { e.New = nil }, "has no New"},
		"nil backend":      {func(e *port.Entry[captureport.Backend]) { e.New = func() captureport.Backend { return nil } }, "nil backend"},
		"panicking New":    {func(e *port.Entry[captureport.Backend]) { e.New = func() captureport.Backend { panic("boom") } }, "panicked: boom"},
		"wrong name": {func(e *port.Entry[captureport.Backend]) {
			e.New = func() captureport.Backend { return NewFake("other") }
		}, `calls itself "other"`},
		"name changes": {func(e *port.Entry[captureport.Backend]) {
			calls := 0
			e.New = func() captureport.Backend { return flipping{&calls} }
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
