package masteringporttest

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func TestTheMockRowPassesTheSuite(t *testing.T) {
	for _, needsApproval := range []bool{false, true} {
		Run(t, NewFake("fake", needsApproval).Entry())
	}
}

// broken is a row whose Master and Capabilities a test replaces, to show the suite fires.
type broken struct {
	Fake
	caps   *masteringport.Capabilities
	master func(context.Context, masteringport.Request) (masteringport.Result, error)
}

func (b broken) Capabilities() masteringport.Capabilities {
	if b.caps != nil {
		return *b.caps
	}
	return b.Fake.Capabilities()
}

func (b broken) Master(ctx context.Context, req masteringport.Request) (masteringport.Result, error) {
	if b.master != nil {
		return b.master(ctx, req)
	}
	return b.Fake.Master(ctx, req)
}

func entryOf(row masteringport.Mastering, modes ...string) port.Entry[masteringport.Mastering] {
	if len(modes) == 0 {
		modes = []string{masteringport.ModeWAV}
	}
	return port.Entry[masteringport.Mastering]{
		Name: row.Name(), Descriptor: port.Descriptor{Label: "Broken", Modes: modes}, New: func() masteringport.Mastering { return row },
	}
}

func expectProblem(t *testing.T, entry port.Entry[masteringport.Mastering], want string) {
	t.Helper()
	problems := Problems(entry, t.TempDir())
	for _, p := range problems {
		if strings.Contains(p, want) {
			return
		}
	}
	t.Errorf("Problems = %q, want one containing %q", problems, want)
}

func TestTheSuiteFailsARowThatJudgesItsOwnFile(t *testing.T) {
	// The port's one judge: a row may not report levels of its own, even flattering ones.
	fake := NewFake("proud", false)
	row := broken{Fake: fake, master: func(ctx context.Context, req masteringport.Request) (masteringport.Result, error) {
		result, err := fake.Master(ctx, req)
		peak := -6.0
		result.After.SamplePeakdBFS = &peak
		return result, err
	}}
	expectProblem(t, entryOf(row), "but internal/measure reads its file as")
}

func TestTheSuiteFailsARowThatOverwrites(t *testing.T) {
	fake := NewFake("careless", false)
	row := broken{Fake: fake, master: func(ctx context.Context, req masteringport.Request) (masteringport.Result, error) {
		if req.Destination != req.Source {
			_ = os.Remove(req.Destination)
		}
		return fake.Master(ctx, req)
	}}
	expectProblem(t, entryOf(row), "for a destination that exists, not ErrDestinationExists")
}

func TestTheSuiteFailsARenderingRowThatNeedsNoApproval(t *testing.T) {
	caps := masteringport.Capabilities{Level: port.NotYetAvailable, Needs: []dawport.Capability{dawport.CapRenderWithFX}}
	row := broken{Fake: NewFake("eager", false), caps: &caps,
		master: func(context.Context, masteringport.Request) (masteringport.Result, error) {
			return masteringport.Result{}, masteringport.NotYetAvailable("eager", "Eager")
		}}
	expectProblem(t, entryOf(row, masteringport.ModeDAWRegion), "does not need the narrator's approval")
}

func TestTheSuiteFailsANotYetRowThatRuns(t *testing.T) {
	caps := masteringport.Capabilities{Level: port.NotYetAvailable}
	expectProblem(t, entryOf(broken{Fake: NewFake("early", false), caps: &caps}), "not a not_yet *port.NotSupportedError")
}

func TestTheSuiteFailsAnUnknownModeOrCapability(t *testing.T) {
	caps := masteringport.Capabilities{Level: port.Supported, Needs: []dawport.Capability{"teleport"}}
	entry := entryOf(broken{Fake: NewFake("odd", false), caps: &caps}, "mp3")
	expectProblem(t, entry, `the unknown mode "mp3"`)
	expectProblem(t, entry, `the DAW capability "teleport"`)
}

func TestTheSuiteReportsABuiltDAWRowItCannotYetExercise(t *testing.T) {
	caps := masteringport.Capabilities{Level: port.Experimental, NeedsApproval: true}
	expectProblem(t, entryOf(broken{Fake: NewFake("daw-ish", true), caps: &caps}, masteringport.ModeDAWRegion), "no fake DAW")
}
