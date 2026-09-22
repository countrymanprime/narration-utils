package main

import (
	"bufio"
	"encoding/json"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/guide"
	"github.com/countrymanprime/narration-utils/shell/internal/importer"
	"github.com/countrymanprime/narration-utils/shell/internal/process"
	"github.com/countrymanprime/narration-utils/shell/internal/settings"
)

// fakeGuideCountEnv turns this test binary into a Story Bible sidecar that only records how it was called: one JSON line of arguments per
// process it is started as, in the file the variable names. It answers a create the way the real one does.
const fakeGuideCountEnv = "SHELL_FAKE_GUIDE_COUNT"

func runFakeGuideCount(path string) int {
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return 2
	}
	defer func() { _ = file.Close() }()
	line, _ := json.Marshal(os.Args[1:])
	_, _ = file.Write(append(line, '\n'))
	if len(os.Args) > 1 && os.Args[1] == "create" {
		_, _ = os.Stdout.WriteString("CREATED|entity-1|0\n")
	}
	return 0
}

// countingGuide returns a Story Bible service whose sidecar is the recording fake, and a function that reads back every call it received.
func countingGuide(t *testing.T) (*guide.Service, func() [][]string) {
	t.Helper()
	log := filepath.Join(t.TempDir(), "calls.jsonl")
	t.Setenv(fakeGuideCountEnv, log)
	project := t.TempDir()
	sidecars := process.NewSupervisor()
	t.Cleanup(func() { _ = sidecars.Close() })
	service := guide.New(project, os.Args[0], "", settings.New(t.TempDir(), project), sidecars)
	return service, func() [][]string {
		file, err := os.Open(log)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = file.Close() }()
		var calls [][]string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			var args []string
			if err := json.Unmarshal(scanner.Bytes(), &args); err != nil {
				t.Fatal(err)
			}
			calls = append(calls, args)
		}
		return calls
	}
}

// pairs reads the --field and --value arguments of one edit call back into a map.
func pairs(t *testing.T, args []string) map[string]string {
	t.Helper()
	fields, values := []string{}, []string{}
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--field" && i+1 < len(args):
			fields = append(fields, args[i+1])
		case strings.HasPrefix(args[i], "--value="):
			values = append(values, strings.TrimPrefix(args[i], "--value="))
		}
	}
	if len(fields) != len(values) {
		t.Fatalf("fields %v and values %v do not pair up", fields, values)
	}
	out := map[string]string{}
	for i := range fields {
		out[fields[i]] = values[i]
	}
	return out
}

func TestASaveOfFourFieldsIsOneSidecarProcess(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	values := map[string]string{"canonical_name": "Alice", "description": "A child.", "personality": "Curious.", "context": "Oxford."}
	if _, err := host.GuideEdit("entity-1", values); err != nil {
		t.Fatal(err)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("a Save of four fields started %d sidecar processes, want 1: %v", len(got), got)
	}
	if got[0][0] != "edit" || !slices.Contains(got[0], "entity-1") {
		t.Fatalf("call = %v", got[0])
	}
	for field, value := range values {
		if pairs(t, got[0])[field] != value {
			t.Fatalf("field %s = %q in %v", field, pairs(t, got[0])[field], got[0])
		}
	}
	if slices.Contains(got[0], "--manuscript") {
		t.Fatalf("only an alias edit reads the manuscript: %v", got[0])
	}
}

func TestAnEditIsTheSameCommandEveryTimeAndOnlyAnAliasEditReadsTheManuscript(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	for i := 0; i < 3; i++ {
		if _, err := host.GuideEdit("entity-1", map[string]string{"context": "C", "aliases": "Al;Ally", "description": "D"}); err != nil {
			t.Fatal(err)
		}
	}
	got := calls()
	if len(got) != 3 {
		t.Fatalf("calls = %d", len(got))
	}
	for _, call := range got[1:] {
		if !slices.Equal(call, got[0]) {
			t.Fatalf("the same edit produced different commands:\n%v\n%v", got[0], call)
		}
	}
	if !slices.Contains(got[0], "--manuscript") {
		t.Fatalf("an alias edit needs the manuscript: %v", got[0])
	}
	fields := []string{}
	for i, arg := range got[0] {
		if arg == "--field" {
			fields = append(fields, got[0][i+1])
		}
	}
	if !slices.Equal(fields, []string{"aliases", "context", "description"}) {
		t.Fatalf("fields are sent in name order, got %v", fields)
	}
}

// A value that starts with a dash ("-brave") is a value, not an option: argparse only takes it in the --name=value form, so a note the
// narrator typed that way must not fail the whole Save (or make a seeded character be skipped).
func TestAValueThatLooksLikeAnOptionIsSentAsAValue(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	if _, err := host.GuideEdit("entity-1", map[string]string{"personality": "-brave", "description": "--not-a-flag"}); err != nil {
		t.Fatal(err)
	}
	got := calls()
	if len(got) != 1 {
		t.Fatalf("calls = %v", got)
	}
	if want := (map[string]string{"personality": "-brave", "description": "--not-a-flag"}); !maps.Equal(pairs(t, got[0]), want) {
		t.Fatalf("pairs = %v in %v", pairs(t, got[0]), got[0])
	}
	if slices.Contains(got[0], "-brave") || slices.Contains(got[0], "--not-a-flag") {
		t.Fatalf("a bare option-looking value would be read as a flag: %v", got[0])
	}
}

func TestAnEmptyEditStartsNoProcess(t *testing.T) {
	service, calls := countingGuide(t)
	host := &Host{guide: service}
	if _, err := host.GuideEdit("entity-1", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	if got := calls(); len(got) != 0 {
		t.Fatalf("an empty edit started %d processes", len(got))
	}
}

func TestSeedingACharacterIsOneProcessNotTwo(t *testing.T) {
	service, calls := countingGuide(t)
	candidates := []importer.CharacterCandidate{
		{ID: "a", Name: "Juno", Description: "The narrator's friend."},
		{ID: "b", Name: "Zeph"},
		{ID: "c", Name: "Unchecked", Description: "Not chosen."},
	}
	var last string
	seedCharacterCandidates(service, candidates, []string{"a", "b"}, func(_ int, message string) { last = message })
	got := calls()
	if len(got) != 2 {
		t.Fatalf("two checked characters started %d processes, want 2: %v", len(got), got)
	}
	for _, call := range got {
		if call[0] != "create" {
			t.Fatalf("seeding must only create: %v", call)
		}
	}
	if !slices.Contains(got[0], "--description=The narrator's friend.") || slices.ContainsFunc(got[1], func(arg string) bool { return strings.HasPrefix(arg, "--description") }) {
		t.Fatalf("only a candidate with a description carries one: %v %v", got[0], got[1])
	}
	if last != "Added 2 Story Bible characters" {
		t.Fatalf("last report = %q", last)
	}
}
