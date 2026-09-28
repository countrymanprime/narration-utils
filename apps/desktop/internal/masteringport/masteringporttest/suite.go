// Package masteringporttest is the conformance suite every Mastering row must pass (ADR 0306), and the mock row it runs against.
// The masteringport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range masteringport.Rows.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { masteringporttest.Run(t, entry) })
//	}
//
// It works on real WAV files in a temporary directory. Its central check is the port's one judge: whatever chain a row runs, the
// After and Judgement it answers must be exactly masteringport.Judge's (internal/measure, then internal/deliveryprofile) on the file
// it wrote.
package masteringporttest

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/masteringport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// Run fails t once per broken promise of entry.
func Run(t *testing.T, entry port.Entry[masteringport.Mastering]) {
	t.Helper()
	for _, p := range Problems(entry, t.TempDir()) {
		t.Error(p)
	}
}

// Problems is every way entry breaks the Mastering port's contract, working in dir; empty when it conforms. It checks that:
//   - the row has a name, a label, known platforms and at least one known mode, each once;
//   - New builds a non-nil row without panicking, which calls itself by the row's name and declares the same capabilities on every
//     call: a level of at least NotYetAvailable, DAW capabilities the DAW port knows, and approval for every row that makes the
//     DAW render (ModeDAWRegion);
//   - a NotYetAvailable row refuses with a not_yet *port.NotSupportedError and leaves nothing at the destination;
//   - a built ModeWAV row, given the narrator's approval where it needs it, writes a new file whose After and Judgement are exactly
//     Judge's on that file (and whose Before, when set, is Judge's on the source), and leaves the source unchanged;
//   - it refuses without approval when it needs it, a destination that exists (leaving that file as it was), the source as its
//     own destination, and a cancelled context, leaving nothing new behind.
//
// A built ModeDAWRegion row needs a fake DAW this suite does not have yet; the phase that builds the first one adds it, and until
// then such a row is reported, not passed.
func Problems(entry port.Entry[masteringport.Mastering], dir string) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	descriptorProblems(entry, report)

	row, ok := built(entry, report)
	if !ok {
		return problems
	}
	caps := row.Capabilities()
	if again := row.Capabilities(); !reflect.DeepEqual(caps, again) {
		report("%q declares different capabilities on each call: %+v, then %+v", entry.Name, caps, again)
	}
	capabilityProblems(entry, caps, report)

	source := filepath.Join(dir, "source.wav")
	if err := os.WriteFile(source, ToneWAV(), 0o600); err != nil {
		report("the suite could not write its WAV: %v", err)
		return problems
	}
	unchanged := func() {
		if got, _ := os.ReadFile(source); !bytes.Equal(got, ToneWAV()) {
			report("%q changed its source WAV", entry.Name)
		}
	}
	leftNothing := func(dst, after string) {
		if _, err := os.Stat(dst); err == nil {
			report("%q left a file at the destination after %s", entry.Name, after)
		}
	}
	profile := deliveryprofile.ACX()
	request := func(dst string) masteringport.Request {
		return masteringport.Request{Source: source, Region: "Chapter 1", Destination: dst, Profile: profile, Approved: true}
	}

	if caps.Level < port.Experimental {
		dst := filepath.Join(dir, "not-yet.wav")
		_, err := row.Master(context.Background(), request(dst))
		var refusal *port.NotSupportedError
		if !errors.As(err, &refusal) || refusal.Support.Level != port.NotYetAvailable || refusal.Support.Reason != port.ReasonNotYet ||
			refusal.Error() == "" {
			report("%q is declared %v but Master answered %v, not a not_yet *port.NotSupportedError with a message", entry.Name, caps.Level, err)
		}
		leftNothing(dst, "refusing as not yet available")
		unchanged()
		return problems
	}
	if !entry.Descriptor.Supports(masteringport.ModeWAV) {
		report("%q is built, but the suite has no fake DAW to master %v with yet: add one with the row", entry.Name, entry.Descriptor.Modes)
		return problems
	}

	if caps.NeedsApproval {
		dst := filepath.Join(dir, "unapproved.wav")
		req := request(dst)
		req.Approved = false
		if _, err := row.Master(context.Background(), req); !errors.Is(err, masteringport.ErrNotApproved) {
			report("%q needs approval but, asked without it, answered %v, not ErrNotApproved", entry.Name, err)
		}
		leftNothing(dst, "a request without approval")
	}

	dst := filepath.Join(dir, "mastered.wav")
	var last int64 = -1
	req := request(dst)
	req.Progress = func(done, total int64) {
		if done < last || done > total {
			report("%q reported progress %d of %d after %d", entry.Name, done, total, last)
		}
		last = done
	}
	result, err := row.Master(context.Background(), req)
	if err != nil {
		report("%q failed to master the suite's tone: %v", entry.Name, err)
	} else {
		resultProblems(entry.Name, result, source, dst, report)
	}
	unchanged()

	existing := filepath.Join(dir, "existing.wav")
	if err := os.WriteFile(existing, []byte("keep"), 0o600); err == nil {
		if _, err := row.Master(context.Background(), request(existing)); !errors.Is(err, masteringport.ErrDestinationExists) {
			report("%q answered %v for a destination that exists, not ErrDestinationExists", entry.Name, err)
		}
		if got, _ := os.ReadFile(existing); string(got) != "keep" {
			report("%q changed a file that was already at its destination", entry.Name)
		}
	}
	if _, err := row.Master(context.Background(), request(source)); !errors.Is(err, masteringport.ErrSameFile) {
		report("%q answered %v for its source as its destination, not ErrSameFile", entry.Name, err)
	}
	unchanged()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelled := filepath.Join(dir, "cancelled.wav")
	if _, err := row.Master(ctx, request(cancelled)); err == nil {
		report("%q mastered under a cancelled context", entry.Name)
	}
	leftNothing(cancelled, "a cancelled context")
	if strays, _ := filepath.Glob(filepath.Join(dir, ".*")); len(strays) > 0 {
		report("%q left temporary files behind: %v", entry.Name, strays)
	}
	return problems
}

func descriptorProblems(entry port.Entry[masteringport.Mastering], report func(string, ...any)) {
	d := entry.Descriptor
	if entry.Name == "" {
		report("a row has no name")
	}
	if d.Label == "" {
		report("%q has no label", entry.Name)
	}
	for _, platform := range d.Platforms {
		if !slices.Contains(port.Platforms, platform) {
			report("%q declares the unknown platform %q", entry.Name, platform)
		}
	}
	if len(d.Modes) == 0 {
		report("%q declares no mode", entry.Name)
	}
	for i, mode := range d.Modes {
		if !slices.Contains(masteringport.Modes, mode) {
			report("%q declares the unknown mode %q, not one of %v", entry.Name, mode, masteringport.Modes)
		}
		if slices.Contains(d.Modes[:i], mode) {
			report("%q declares the mode %q twice", entry.Name, mode)
		}
	}
}

func capabilityProblems(entry port.Entry[masteringport.Mastering], caps masteringport.Capabilities, report func(string, ...any)) {
	if caps.Level < port.NotYetAvailable || caps.Level > port.Supported {
		report("%q declares the level %v; a registered row is NotYetAvailable, Experimental or Supported", entry.Name, caps.Level)
	}
	for _, c := range caps.Needs {
		if _, ok := dawport.SpecOf(c); !ok {
			report("%q needs the DAW capability %q, which the DAW port does not know", entry.Name, c)
		}
	}
	if entry.Descriptor.Supports(masteringport.ModeDAWRegion) && !caps.NeedsApproval {
		report("%q makes the DAW render but does not need the narrator's approval for it", entry.Name)
	}
}

// built calls entry.New, reporting a panic, a nil row, or a row that does not call itself by entry's name.
func built(entry port.Entry[masteringport.Mastering], report func(string, ...any)) (row masteringport.Mastering, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			report("%q: New panicked: %v", entry.Name, r)
			ok = false
		}
	}()
	if entry.New == nil {
		report("%q has no New", entry.Name)
		return nil, false
	}
	row = entry.New()
	if row == nil {
		report("%q: New returned nil", entry.Name)
		return nil, false
	}
	if row.Name() != entry.Name {
		report("%q: New built a row that calls itself %q", entry.Name, row.Name())
	}
	return row, true
}

// resultProblems checks a successful master against the file it wrote: the port's one judge.
func resultProblems(name string, result masteringport.Result, source, dst string, report func(string, ...any)) {
	if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
		report("%q reported success but wrote nothing at the destination", name)
		return
	}
	if result.Provider != name {
		report("%q answered the provider %q", name, result.Provider)
	}
	if !samePath(result.Destination, dst) {
		report("%q answered the destination %q, not %q", name, result.Destination, dst)
	}
	profile := deliveryprofile.ACX()
	if result.Profile != profile.Key() {
		report("%q answered the profile %q, not %q", name, result.Profile, profile.Key())
	}
	if len(result.Chain) == 0 {
		report("%q answered no chain: the narrator's report says what ran", name)
	}
	after, judgement, err := masteringport.Judge(context.Background(), result.Destination, profile)
	if err != nil {
		report("%q wrote a file internal/measure cannot read: %v", name, err)
		return
	}
	if !reflect.DeepEqual(result.After, after) {
		report("%q answered After %+v, but internal/measure reads its file as %+v", name, result.After, after)
	}
	if !reflect.DeepEqual(result.Judgement, judgement) {
		report("%q answered a judgement that is not internal/deliveryprofile's on its file", name)
	}
	if result.Before != nil {
		before, _, err := masteringport.Judge(context.Background(), source, profile)
		if err == nil {
			before.File = result.Before.File
		}
		if err != nil || !reflect.DeepEqual(*result.Before, before) || !samePath(result.Before.File, source) {
			report("%q answered Before %+v, but internal/measure reads its source as %+v", name, *result.Before, before)
		}
	}
}

func samePath(a, b string) bool {
	absA, errA := filepath.Abs(a)
	absB, errB := filepath.Abs(b)
	return errA == nil && errB == nil && absA == absB
}

// ToneWAV is two seconds of a quiet 1 kHz tone, 16-bit mono at 44.1 kHz: well under ACX's RMS window, so a real chain has work to do.
func ToneWAV() []byte {
	const rate, seconds, amplitude = 44100, 2, 0.02
	var data bytes.Buffer
	for i := range rate * seconds {
		v := int16(math.Round(amplitude * math.Sin(2*math.Pi*1000*float64(i)/rate) * 32767))
		_ = binary.Write(&data, binary.LittleEndian, v)
	}
	var file bytes.Buffer
	file.WriteString("RIFF")
	_ = binary.Write(&file, binary.LittleEndian, uint32(36+data.Len())) //nolint:gosec // G115: two seconds of 16-bit mono, far under 4 GiB
	file.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(rate), uint32(rate * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&file, binary.LittleEndian, v)
	}
	file.WriteString("data")
	_ = binary.Write(&file, binary.LittleEndian, uint32(data.Len())) //nolint:gosec // G115: as above
	file.Write(data.Bytes())
	return file.Bytes()
}
