package encodeporttest

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
)

func encoderEntry(name string) port.Entry[encodeport.Encoder] {
	return port.Entry[encodeport.Encoder]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake", Modes: []string{"mp3"}},
		New:        func() encodeport.Encoder { return NewFakeEncoder(name, "mp3") },
	}
}

func packagerEntry(name string) port.Entry[encodeport.Packager] {
	return port.Entry[encodeport.Packager]{
		Name:       name,
		Descriptor: port.Descriptor{Label: "Fake", Modes: []string{"mp3"}},
		New:        func() encodeport.Packager { return NewFakePackager(name, "mp3") },
	}
}

func TestTheFakesPassTheSuite(t *testing.T) {
	RunEncoder(t, encoderEntry("fake"))
	RunPackager(t, packagerEntry("fake"), FakeSamples(t, "mp3"))
}

// A misbehaving encoder: each field breaks one promise the suite checks.
type badEncoder struct {
	FakeEncoder
	names        func() string
	ignoreFormat bool // writes any format it is asked for
	ignoreCtx    bool // encodes under a cancelled context
	touchInput   bool // rewrites the WAV it was given
	writeNothing bool // reports success and writes nothing
	leaveOnFail  bool // leaves a partial file at dst when it fails
}

func (b badEncoder) Name() string {
	if b.names != nil {
		return b.names()
	}
	return b.FakeEncoder.Name()
}

func (b badEncoder) Encode(ctx context.Context, wav, dst string, spec encodeport.Spec) error {
	if b.leaveOnFail {
		_ = os.WriteFile(dst, []byte("partial"), 0o600)
	}
	if b.touchInput {
		_ = os.WriteFile(wav, []byte("changed"), 0o600)
	}
	if b.writeNothing {
		return nil
	}
	if b.ignoreFormat {
		spec.Format = "mp3"
	}
	if b.ignoreCtx {
		ctx = context.Background()
	}
	return b.FakeEncoder.Encode(ctx, wav, dst, spec)
}

func TestTheEncoderSuiteCatchesABrokenRow(t *testing.T) {
	type edit func(*port.Entry[encodeport.Encoder])
	with := func(b badEncoder) edit {
		return func(e *port.Entry[encodeport.Encoder]) {
			b.FakeEncoder = NewFakeEncoder(e.Name, "mp3")
			e.New = func() encodeport.Encoder { return b }
		}
	}
	cases := map[string]struct {
		edit edit
		want string
	}{
		"no name":          {func(e *port.Entry[encodeport.Encoder]) { e.Name = "" }, "has no name"},
		"no label":         {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Label = "" }, "has no label"},
		"no formats":       {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Modes = nil }, "declares no format"},
		"format twice":     {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Modes = []string{"mp3", "mp3"} }, `format "mp3" twice`},
		"odd format":       {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Modes = []string{".MP3"} }, `format ".MP3"`},
		"unknown platform": {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Platforms = []string{"plan9"} }, `platform "plan9"`},
		"no New":           {func(e *port.Entry[encodeport.Encoder]) { e.New = nil }, "has no New"},
		"nil encoder":      {func(e *port.Entry[encodeport.Encoder]) { e.New = func() encodeport.Encoder { return nil } }, "returned nil"},
		"panicking New":    {func(e *port.Entry[encodeport.Encoder]) { e.New = func() encodeport.Encoder { panic("boom") } }, "panicked: boom"},
		"wrong name":       {with(badEncoder{names: func() string { return "other" }}), `calls itself "other"`},
		"name changes": {func(e *port.Entry[encodeport.Encoder]) {
			calls := 0
			with(badEncoder{names: func() string {
				calls++
				if calls%2 == 0 {
					return "other"
				}
				return e.Name
			}})(e)
		}, "not static"},
		"a declared format fails":   {func(e *port.Entry[encodeport.Encoder]) { e.Descriptor.Modes = []string{"mp3", "flac"} }, `writing flac`},
		"an undeclared format":      {with(badEncoder{ignoreFormat: true}), "not a *port.NotSupportedError"},
		"a cancelled context":       {with(badEncoder{ignoreCtx: true}), "encoded under a cancelled context"},
		"the input rewritten":       {with(badEncoder{touchInput: true}), "changed its input"},
		"nothing written":           {with(badEncoder{writeNothing: true}), "wrote nothing"},
		"a partial file on failure": {with(badEncoder{leaveOnFail: true}), "left a file"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entry := encoderEntry("fake")
			tc.edit(&entry)
			problems := EncoderProblems(entry, t.TempDir())
			for _, p := range problems {
				if strings.Contains(p, tc.want) {
					return
				}
			}
			t.Fatalf("EncoderProblems = %q, want one containing %q", problems, tc.want)
		})
	}
}

// A misbehaving packager, as badEncoder.
type badPackager struct {
	FakePackager
	ignoreFormat bool
	ignoreCtx    bool
	inPlace      bool // packages the file it was given, rather than a copy
	missingOut   bool // returns a path it never wrote
}

func (b badPackager) Package(ctx context.Context, file string, chapters []encodeport.Chapter, tags encodeport.Tags) (string, error) {
	if b.inPlace {
		return file, os.WriteFile(file, []byte("tagged"), 0o600)
	}
	if b.missingOut {
		return filepath.Join(filepath.Dir(file), "missing.mp3"), nil
	}
	if b.ignoreFormat {
		b.formats = append(b.formats, formatOf(file))
	}
	if b.ignoreCtx {
		ctx = context.Background()
	}
	return b.FakePackager.Package(ctx, file, chapters, tags)
}

func TestThePackagerSuiteCatchesABrokenRow(t *testing.T) {
	type edit func(*port.Entry[encodeport.Packager])
	with := func(b badPackager) edit {
		return func(e *port.Entry[encodeport.Packager]) {
			b.FakePackager = NewFakePackager(e.Name, "mp3")
			e.New = func() encodeport.Packager { return b }
		}
	}
	cases := map[string]struct {
		edit edit
		want string
	}{
		"no formats":           {func(e *port.Entry[encodeport.Packager]) { e.Descriptor.Modes = nil }, "declares no format"},
		"nil packager":         {func(e *port.Entry[encodeport.Packager]) { e.New = func() encodeport.Packager { return nil } }, "returned nil"},
		"no sample":            {func(e *port.Entry[encodeport.Packager]) { e.Descriptor.Modes = []string{"mp3", "m4b"} }, "no sample m4b"},
		"an undeclared format": {with(badPackager{ignoreFormat: true}), "not a *port.NotSupportedError"},
		"a cancelled context":  {with(badPackager{ignoreCtx: true}), "packaged under a cancelled context"},
		"packaged in place":    {with(badPackager{inPlace: true}), "changed its input"},
		"a missing output":     {with(badPackager{missingOut: true}), "wrote nothing"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			entry := packagerEntry("fake")
			tc.edit(&entry)
			problems := PackagerProblems(entry, t.TempDir(), FakeSamples(t, "mp3"))
			for _, p := range problems {
				if strings.Contains(p, tc.want) {
					return
				}
			}
			t.Fatalf("PackagerProblems = %q, want one containing %q", problems, tc.want)
		})
	}
}
