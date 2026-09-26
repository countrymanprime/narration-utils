package port

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
)

type fakeEngine struct{ name string }

func engines() *Registry[*fakeEngine] {
	r := &Registry[*fakeEngine]{Kind: "speech engine"}
	r.Register(Entry[*fakeEngine]{Name: "whisper", Descriptor: Descriptor{Label: "Whisper", Modes: []string{"live", "batch"}},
		New: func() *fakeEngine { return &fakeEngine{"whisper"} }})
	r.Register(Entry[*fakeEngine]{Name: "moonshine", Descriptor: Descriptor{Label: "Moonshine", Platforms: []string{"windows"}, Modes: []string{"live"}},
		New: func() *fakeEngine { return &fakeEngine{"moonshine"} }})
	r.Register(Entry[*fakeEngine]{Name: "parakeet", Descriptor: Descriptor{Label: "Parakeet", Platforms: []string{"darwin", "linux"}},
		New: func() *fakeEngine { return &fakeEngine{"parakeet"} }})
	return r
}

func TestLookupReturnsTheRegisteredEntry(t *testing.T) {
	entry, err := engines().Lookup("moonshine")
	if err != nil {
		t.Fatalf("Lookup(moonshine): %v", err)
	}
	if entry.Name != "moonshine" || entry.Descriptor.Label != "Moonshine" {
		t.Fatalf("Lookup(moonshine) = %+v", entry)
	}
	if got := entry.New(); got == nil || got.name != "moonshine" {
		t.Fatalf("New() = %+v, want the moonshine engine", got)
	}
}

func TestLookupRefusesAnUnknownNameWithANotSupportedError(t *testing.T) {
	_, err := engines().Lookup("vosk")
	if !errors.Is(err, ErrNotSupported) {
		t.Fatalf("Lookup(vosk) error = %v, want one matching ErrNotSupported", err)
	}
	var ns *NotSupportedError
	if !errors.As(err, &ns) {
		t.Fatalf("Lookup(vosk) error %T is not a *NotSupportedError", err)
	}
	if ns.Capability != "vosk" || ns.Support.Level != Unsupported || ns.Support.Available || ns.Support.Reason != ReasonUnsupported {
		t.Fatalf("refusal = %+v", ns)
	}
	if want := `There is no speech engine called "vosk".`; ns.Error() != want {
		t.Fatalf("message = %q, want %q", ns.Error(), want)
	}
}

func TestTheZeroRegistryIsEmptyAndStillSpeaksASentence(t *testing.T) {
	var r Registry[int]
	if names := r.Names("windows"); len(names) != 0 {
		t.Fatalf("Names = %v, want none", names)
	}
	_, err := r.Lookup("x")
	if err == nil || !strings.HasPrefix(err.Error(), "There is no ") || !strings.HasSuffix(err.Error(), `called "x".`) {
		t.Fatalf("Lookup on an empty registry = %v", err)
	}
}

func TestNamesListsThePlatformsRowsInRegistrationOrderDefaultFirst(t *testing.T) {
	r := engines()
	for platform, want := range map[string][]string{
		"windows": {"whisper", "moonshine"},
		"darwin":  {"whisper", "parakeet"},
		"linux":   {"whisper", "parakeet"},
	} {
		if got := r.Names(platform); !reflect.DeepEqual(got, want) {
			t.Errorf("Names(%q) = %v, want %v", platform, got, want)
		}
	}
	names := r.Names("windows")
	names[0] = "changed"
	if r.Names("windows")[0] != "whisper" {
		t.Error("Names hands out the registry's own slice")
	}
}

func TestEntriesAreEveryRowInOrder(t *testing.T) {
	var got []string
	for _, e := range engines().Entries() {
		got = append(got, e.Name)
	}
	if want := []string{"whisper", "moonshine", "parakeet"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Entries = %v, want %v", got, want)
	}
}

func TestDescriptorAnswersPlatformAndMode(t *testing.T) {
	d := Descriptor{Label: "Moonshine", Platforms: []string{"windows"}, Modes: []string{"live"}}
	if !d.RunsOn("windows") || d.RunsOn("darwin") {
		t.Error("RunsOn follows Platforms")
	}
	if !(Descriptor{Label: "Whisper"}).RunsOn("darwin") {
		t.Error("no Platforms means every platform")
	}
	if !d.Supports("live") || d.Supports("batch") {
		t.Error("Supports follows Modes")
	}
}

func mustPanic(t *testing.T, want string, register func()) {
	t.Helper()
	defer func() {
		t.Helper()
		got := recover()
		if got == nil {
			t.Fatalf("no panic, want one saying %q", want)
		}
		if msg, _ := got.(string); !strings.Contains(msg, want) {
			t.Fatalf("panic %v, want one saying %q", got, want)
		}
	}()
	register()
}

func TestRegisterPanicsOnARowThatIsABug(t *testing.T) {
	newEngine := func() *fakeEngine { return &fakeEngine{} }
	cases := map[string]struct {
		entry Entry[*fakeEngine]
		want  string
	}{
		"duplicate":        {Entry[*fakeEngine]{Name: "whisper", Descriptor: Descriptor{Label: "Whisper again"}, New: newEngine}, `"whisper" is already registered`},
		"empty name":       {Entry[*fakeEngine]{Descriptor: Descriptor{Label: "Nameless"}, New: newEngine}, "needs a name"},
		"no label":         {Entry[*fakeEngine]{Name: "vosk", New: newEngine}, "needs a label"},
		"no constructor":   {Entry[*fakeEngine]{Name: "vosk", Descriptor: Descriptor{Label: "Vosk"}}, "needs New"},
		"unknown platform": {Entry[*fakeEngine]{Name: "vosk", Descriptor: Descriptor{Label: "Vosk", Platforms: []string{"plan9"}}, New: newEngine}, `"plan9"`},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			r := engines()
			mustPanic(t, c.want, func() { r.Register(c.entry) })
			if len(r.Entries()) != 3 {
				t.Fatalf("a refused row was kept: %d rows", len(r.Entries()))
			}
		})
	}
}

// TestTheLevelGoldenIsCurrent writes tests/fixtures/contracts/port-levels.json (UPDATE_CONTRACTS=1) and otherwise compares with it.
// narration_common.ports reads it back, so the Python Level cannot drift from this one (ADR 0301).
func TestTheLevelGoldenIsCurrent(t *testing.T) {
	type level struct {
		Name  string `json:"name"`
		Wire  string `json:"wire"`
		Value int    `json:"value"`
	}
	names := []string{"Unsupported", "NotYetAvailable", "Experimental", "Supported"}
	levels := make([]level, 0, len(names))
	for i, name := range names {
		l := Level(i)
		levels = append(levels, level{Name: name, Wire: l.String(), Value: int(l)})
	}
	if Supported != Level(len(names)-1) {
		t.Fatalf("a level was added: name it here so the golden carries it")
	}
	contractfile.Check(t, "port-levels", struct {
		Levels []level `json:"levels"`
	}{levels})
}
