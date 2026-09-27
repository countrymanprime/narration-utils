package pronunciationporttest

import (
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
)

type src = pronunciationport.Source

func fakeEntry(name string) port.Entry[src] {
	return port.Entry[src]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake", Modes: []string{pronunciationport.ModePronounce}},
		New:        func() src { return NewFake(name, "") },
	}
}

func browserEntry(name string) port.Entry[src] {
	return port.Entry[src]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake", Modes: []string{pronunciationport.ModeBrowse}},
		New:        func() src { return NewFake(name, "example.org") },
	}
}

func TestTheFakesPassTheSuite(t *testing.T) {
	Run(t, fakeEntry("fake"))
	Run(t, browserEntry("web"))
}

type flipping struct{ calls *int }

func (f flipping) Name() string { return "fake" }
func (f flipping) BrowserHost() string {
	*f.calls++
	if *f.calls%2 == 0 {
		return "b.example"
	}
	return ""
}

func TestTheSuiteCatchesABrokenRow(t *testing.T) {
	pronouncer := func() port.Entry[src] { return fakeEntry("fake") }
	browser := func() port.Entry[src] { return browserEntry("web") }
	cases := map[string]struct {
		entry func() port.Entry[src]
		edit  func(*port.Entry[src])
		want  string
	}{
		"no name":          {pronouncer, func(e *port.Entry[src]) { e.Name = "" }, "has no name"},
		"no label":         {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Label = "" }, "has no label"},
		"no modes":         {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Modes = nil }, "declares no mode"},
		"unknown mode":     {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Modes = []string{"speak"} }, `mode "speak"`},
		"mode twice":       {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Modes = []string{"pronounce", "pronounce"} }, `mode "pronounce" twice`},
		"unknown platform": {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Platforms = []string{"plan9"} }, `platform "plan9"`},
		"platform twice":   {pronouncer, func(e *port.Entry[src]) { e.Descriptor.Platforms = []string{"linux", "linux"} }, `platform "linux" twice`},
		"no New":           {pronouncer, func(e *port.Entry[src]) { e.New = nil }, "has no New"},
		"nil source":       {pronouncer, func(e *port.Entry[src]) { e.New = func() src { return nil } }, "nil source"},
		"panicking New":    {pronouncer, func(e *port.Entry[src]) { e.New = func() src { panic("boom") } }, "panicked: boom"},
		"wrong name":       {pronouncer, func(e *port.Entry[src]) { e.New = func() src { return NewFake("other", "") } }, `calls itself "other"`},
		"host without browse": {pronouncer, func(e *port.Entry[src]) { e.New = func() src { return NewFake("fake", "example.org") } },
			"does not declare browse"},
		"browse without host": {browser, func(e *port.Entry[src]) { e.New = func() src { return NewFake("web", "") } },
			"needs the browser host"},
		"host not a host": {browser, func(e *port.Entry[src]) { e.New = func() src { return NewFake("web", "https://Example.org/x") } },
			"not a lower-case host name"},
		"host changes": {pronouncer, func(e *port.Entry[src]) {
			calls := 0
			e.New = func() src { return flipping{&calls} }
		}, "not static"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entry := tc.entry()
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
