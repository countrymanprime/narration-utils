package pronunciationport_test

import (
	"errors"
	"reflect"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport/pronunciationporttest"
)

func TestEveryRegisteredSourcePassesTheSuite(t *testing.T) {
	entries := pronunciationport.Sources.Entries()
	if len(entries) == 0 {
		t.Fatal("no pronunciation source is registered")
	}
	for _, entry := range entries {
		t.Run(entry.Name, func(t *testing.T) { pronunciationporttest.Run(t, entry) })
	}
}

func TestTheFallbackOrderIsTodaysCmuThenEspeak(t *testing.T) {
	// The sidecar's build-time fallback (manuscript_guide.py's pronunciation()) tries CMU, then eSpeak, on every platform.
	for _, platform := range port.Platforms {
		if got, want := pronunciationport.FallbackOrder(platform), []string{"cmu", "espeak"}; !reflect.DeepEqual(got, want) {
			t.Errorf("FallbackOrder(%q) = %v, want %v", platform, got, want)
		}
	}
}

func TestNoSourceTakesTheBrowserRoleYet(t *testing.T) {
	// Q5: the BrowserLookup role is declared with no implementation; the web lookup belongs to benchmark recommendation 6's PRD.
	for _, platform := range port.Platforms {
		if got := pronunciationport.Names(platform, pronunciationport.ModeBrowse); len(got) != 0 {
			t.Errorf("Names(%q, browse) = %v, want none", platform, got)
		}
	}
}

func TestCheckPronounceAcceptsEachSourceTheNarratorCanChoose(t *testing.T) {
	for _, name := range []string{pronunciationport.CMU, pronunciationport.Espeak} {
		if err := pronunciationport.CheckPronounce(name); err != nil {
			t.Errorf("CheckPronounce(%q) = %v", name, err)
		}
	}
}

func TestCheckPronounceRefusesAnUnknownSourceWithANotSupportedError(t *testing.T) {
	err := pronunciationport.CheckPronounce("forvo")
	if !errors.Is(err, port.ErrNotSupported) {
		t.Fatalf("CheckPronounce(forvo) = %v, want a *port.NotSupportedError", err)
	}
	if want := `There is no pronunciation source called "forvo".`; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
}

func TestCheckPronounceRefusesABrowserOnlySource(t *testing.T) {
	sources := pronunciationport.NewRegistry()
	sources.Register(port.Entry[pronunciationport.Source]{
		Name:       "wiki",
		Descriptor: port.Descriptor{Label: "Wiktionary", Modes: []string{pronunciationport.ModeBrowse}},
		New:        func() pronunciationport.Source { return pronunciationporttest.NewFake("wiki", "en.wiktionary.org") },
	})
	err := pronunciationport.CheckPronounceIn(sources, "wiki")
	var ns *port.NotSupportedError
	if !errors.As(err, &ns) {
		t.Fatalf("CheckPronounceIn(wiki) = %v, want a *port.NotSupportedError", err)
	}
	if ns.Capability != "wiki" || ns.Support.Level != port.Unsupported {
		t.Errorf("refusal = %+v", ns)
	}
	if want := "Wiktionary cannot give a pronunciation."; err.Error() != want {
		t.Fatalf("message = %q, want %q", err.Error(), want)
	}
}

func TestANewSourceIsOneRowAndPassesTheSuiteWithNoOtherEdit(t *testing.T) {
	sources := pronunciationport.NewRegistry()
	sources.Register(port.Entry[pronunciationport.Source]{
		Name:       "festival",
		Descriptor: port.Descriptor{Label: "Festival", Platforms: []string{"linux"}, Modes: []string{pronunciationport.ModePronounce}},
		New:        func() pronunciationport.Source { return pronunciationporttest.NewFake("festival", "") },
	})
	for _, entry := range sources.Entries() {
		t.Run(entry.Name, func(t *testing.T) { pronunciationporttest.Run(t, entry) })
	}
	if got := pronunciationport.NamesIn(sources, "linux", pronunciationport.ModePronounce); !reflect.DeepEqual(got, []string{"cmu", "espeak", "festival"}) {
		t.Errorf("pronounce names on linux = %v", got)
	}
	if got := pronunciationport.NamesIn(sources, "windows", pronunciationport.ModePronounce); !reflect.DeepEqual(got, []string{"cmu", "espeak"}) {
		t.Errorf("a linux-only row must not be a source on windows: %v", got)
	}
	if err := pronunciationport.CheckPronounceIn(sources, "festival"); err != nil {
		t.Errorf("CheckPronounceIn(festival) = %v", err)
	}
	if got := pronunciationport.Sources.Names("linux"); !reflect.DeepEqual(got, []string{"cmu", "espeak"}) {
		t.Errorf("registering on a new registry changed the program's: %v", got)
	}
}
