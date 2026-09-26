// Package encodeporttest is the conformance suite every Encoder and Packager row must pass (ADR 0301), and fakes it runs against.
// The encodeport test runs it over every registered row, so a new row cannot skip it:
//
//	for _, entry := range encodeport.Encoders.Entries() {
//		t.Run(entry.Name, func(t *testing.T) { encodeporttest.RunEncoder(t, entry) })
//	}
//
// Both registries are empty today, so the suite is the port's contract ahead of its first implementation. It checks behaviour on
// real files in a temporary directory; a real encoder that needs a binary or a library CI lacks runs it against a fake of that
// dependency, as the ASR ports do with their models.
package encodeporttest

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

// undeclared is a format the suite asks for to see it refused; no row declares it.
const undeclared = "notaformat"

var formatName = regexp.MustCompile(`^[a-z0-9]+$`)

// RunEncoder fails t once per broken promise of entry.
func RunEncoder(t *testing.T, entry port.Entry[encodeport.Encoder]) {
	t.Helper()
	for _, p := range EncoderProblems(entry, t.TempDir()) {
		t.Error(p)
	}
}

// RunPackager fails t once per broken promise of entry. samples maps each format the row declares to a file of that format for it
// to package; the suite works on copies, so they are never changed.
func RunPackager(t *testing.T, entry port.Entry[encodeport.Packager], samples map[string]string) {
	t.Helper()
	for _, p := range PackagerProblems(entry, t.TempDir(), samples) {
		t.Error(p)
	}
}

// EncoderProblems is every way entry breaks the Encoder port's contract, working in dir; empty when it conforms. It checks that:
//   - the row has a name and a label, known platforms, and declares at least one format, each once and a lower-case extension;
//   - New builds a non-nil encoder without panicking, which calls itself by the row's name, always;
//   - each declared format is written to dst, which is not empty, and the WAV is left unchanged;
//   - an undeclared format is refused with a *port.NotSupportedError, and a cancelled context with an error, leaving nothing at dst.
func EncoderProblems(entry port.Entry[encodeport.Encoder], dir string) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	descriptorProblems(entry.Name, entry.Descriptor, report)

	encoder, ok := built(entry, report)
	if !ok {
		return problems
	}
	wav := filepath.Join(dir, "input.wav")
	if err := os.WriteFile(wav, silentWAV(), 0o600); err != nil {
		report("the suite could not write its WAV: %v", err)
		return problems
	}
	unchanged := func() {
		if got, _ := os.ReadFile(wav); !bytes.Equal(got, silentWAV()) {
			report("%q changed its input WAV", entry.Name)
		}
	}
	leftNothing := func(dst, after string) {
		if _, err := os.Stat(dst); err == nil {
			report("%q left a file at dst after %s", entry.Name, after)
		}
	}

	for _, format := range entry.Descriptor.Modes {
		dst := filepath.Join(dir, "output."+format)
		if err := encoder.Encode(context.Background(), wav, dst, encodeport.Spec{Format: format}); err != nil {
			report("%q failed writing %s: %v", entry.Name, format, err)
			continue
		}
		if info, err := os.Stat(dst); err != nil || info.Size() == 0 {
			report("%q reported success writing %s but wrote nothing at dst", entry.Name, format)
		}
		unchanged()
	}

	dst := filepath.Join(dir, "refused."+undeclared)
	refused(entry.Name, encoder.Encode(context.Background(), wav, dst, encodeport.Spec{Format: undeclared}), report)
	leftNothing(dst, "refusing a format")

	if len(entry.Descriptor.Modes) > 0 {
		format := entry.Descriptor.Modes[0]
		dst := filepath.Join(dir, "cancelled."+format)
		if encoder.Encode(cancelled(), wav, dst, encodeport.Spec{Format: format}) == nil {
			report("%q encoded under a cancelled context", entry.Name)
		}
		leftNothing(dst, "a cancelled context")
	}
	unchanged()
	return problems
}

// PackagerProblems is every way entry breaks the Packager port's contract, working in dir on copies of samples; empty when it
// conforms. It checks the row and New as EncoderProblems does, and that:
//   - each declared format, given its sample, is packaged into a new, non-empty file, and the sample's copy is left unchanged;
//   - an undeclared format is refused with a *port.NotSupportedError, and a cancelled context with an error, leaving no file behind.
func PackagerProblems(entry port.Entry[encodeport.Packager], dir string, samples map[string]string) []string {
	var problems []string
	report := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	descriptorProblems(entry.Name, entry.Descriptor, report)

	packager, ok := built(entry, report)
	if !ok {
		return problems
	}
	chapters := []encodeport.Chapter{
		{Title: "Opening Credits", Start: 0, End: 5 * time.Second},
		{Title: "Chapter One", Start: 5 * time.Second, End: 65 * time.Second},
	}
	tags := encodeport.Tags{"title": "Conformance", "narrator": "Suite"}

	// input copies the sample for format into dir, as name, and returns the copy's path and bytes.
	input := func(format, name string) (string, []byte, bool) {
		sample, ok := samples[format]
		if !ok {
			report("%q declares %s, but the suite was given no sample %s file", entry.Name, format, format)
			return "", nil, false
		}
		body, err := os.ReadFile(sample)
		if err != nil {
			report("the suite could not read the sample %s: %v", sample, err)
			return "", nil, false
		}
		path := filepath.Join(dir, name+"."+format)
		if err := os.WriteFile(path, body, 0o600); err != nil { //nolint:gosec // G703: path is the suite's own copy under its temporary directory
			report("the suite could not copy the sample %s: %v", sample, err)
			return "", nil, false
		}
		return path, body, true
	}

	for _, format := range entry.Descriptor.Modes {
		file, body, ok := input(format, "input")
		if !ok {
			continue
		}
		out, err := packager.Package(context.Background(), file, chapters, tags)
		if err != nil {
			report("%q failed packaging %s: %v", entry.Name, format, err)
			continue
		}
		if got, _ := os.ReadFile(file); out == file || !bytes.Equal(got, body) {
			report("%q changed its input %s rather than writing a copy", entry.Name, format)
		}
		if info, err := os.Stat(out); err != nil || info.Size() == 0 {
			report("%q reported success packaging %s but wrote nothing at %q", entry.Name, format, out)
		}
	}

	refusal := filepath.Join(dir, "refused."+undeclared)
	if err := os.WriteFile(refusal, []byte("not a delivery file"), 0o600); err != nil {
		report("the suite could not write its refusal file: %v", err)
		return problems
	}
	before := count(dir)
	_, err := packager.Package(context.Background(), refusal, chapters, tags)
	refused(entry.Name, err, report)
	if count(dir) != before {
		report("%q left a file behind after refusing a format", entry.Name)
	}

	if len(entry.Descriptor.Modes) > 0 {
		if file, _, ok := input(entry.Descriptor.Modes[0], "cancelled"); ok {
			before := count(dir)
			if _, err := packager.Package(cancelled(), file, chapters, tags); err == nil {
				report("%q packaged under a cancelled context", entry.Name)
			}
			if count(dir) != before {
				report("%q left a file behind after a cancelled context", entry.Name)
			}
		}
	}
	return problems
}

// descriptorProblems reports what is wrong with a row's name and descriptor, which both ports share.
func descriptorProblems(name string, d port.Descriptor, report func(string, ...any)) {
	if name == "" {
		report("the row has no name")
	}
	if d.Label == "" {
		report("%q has no label", name)
	}
	for _, platform := range d.Platforms {
		if !slices.Contains(port.Platforms, platform) {
			report("%q declares the platform %q, which is not one of %v", name, platform, port.Platforms)
		}
	}
	if len(d.Modes) == 0 {
		report("%q declares no format; its Descriptor.Modes are the formats it handles", name)
	}
	for i, format := range d.Modes {
		if !formatName.MatchString(format) {
			report("%q declares the format %q; a format is a lower-case file extension without the dot", name, format)
		}
		if slices.Contains(d.Modes[:i], format) {
			report("%q declares the format %q twice", name, format)
		}
	}
}

// named is what both ports' implementations have in common.
type named interface{ Name() string }

// built calls entry.New twice and reports how it broke: a panic, nil, a name other than the row's, or a name that changes.
func built[P named](entry port.Entry[P], report func(string, ...any)) (P, bool) {
	var zero P
	if entry.New == nil {
		report("%q has no New", entry.Name)
		return zero, false
	}
	first, broken := build(entry)
	if broken != "" {
		report("%q: %s", entry.Name, broken)
		return zero, false
	}
	second, broken := build(entry)
	if broken != "" {
		report("%q: %s", entry.Name, broken)
		return zero, false
	}
	name := first.Name()
	if name != entry.Name {
		report("%q's implementation calls itself %q", entry.Name, name)
	}
	if name != first.Name() || name != second.Name() {
		report("%q's implementation is not static: two answers differed", entry.Name)
	}
	return first, true
}

func build[P named](entry port.Entry[P]) (impl P, broken string) {
	defer func() {
		if r := recover(); r != nil {
			broken = fmt.Sprintf("New panicked: %v", r)
		}
	}()
	impl = entry.New()
	if any(impl) == nil {
		return impl, "New returned nil"
	}
	return impl, ""
}

// refused reports err unless it is the refusal of the undeclared format.
func refused(name string, err error, report func(string, ...any)) {
	var refusal *port.NotSupportedError
	if !errors.As(err, &refusal) {
		report("asked for %s, %q returned %v, not a *port.NotSupportedError", undeclared, name, err)
		return
	}
	if refusal.Support.Message == "" {
		report("%q refused %s without a message", name, undeclared)
	}
}

func cancelled() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

func count(dir string) int {
	entries, _ := os.ReadDir(dir)
	return len(entries)
}

// silentWAV is a tenth of a second of 16-bit mono silence at 16 kHz: a valid RIFF WAVE an encoder can read.
func silentWAV() []byte {
	const rate, samples = 16000, 1600
	data := samples * 2
	var b bytes.Buffer
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+data))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(rate), uint32(rate * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(data))
	b.Write(make([]byte, data))
	return b.Bytes()
}
