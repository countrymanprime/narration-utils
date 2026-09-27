package encodeporttest

import (
	"context"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/encodeport"
)

// FakeEncoder is a test-only encoder: it "encodes" by copying the WAV behind a one-line header naming the format.
type FakeEncoder struct {
	name    string
	formats []string
}

var _ encodeport.Encoder = FakeEncoder{}

// NewFakeEncoder is an encoder called name that writes formats.
func NewFakeEncoder(name string, formats ...string) FakeEncoder {
	return FakeEncoder{name: name, formats: formats}
}

func (f FakeEncoder) Name() string { return f.name }

func (f FakeEncoder) Encode(ctx context.Context, wav, dst string, spec encodeport.Spec) error {
	if !slices.Contains(f.formats, spec.Format) {
		return encodeport.FormatNotSupported("encoder", f.name, spec.Format)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	audio, err := os.ReadFile(wav)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, append([]byte("fake "+spec.Format+"\n"), audio...), 0o600) //nolint:gosec // G703: a test-only fake; dst is the path its test chose, under t.TempDir
}

// FakePackager is a test-only packager: it copies the file beside itself and appends a line per chapter and tag.
type FakePackager struct {
	name    string
	formats []string
}

var _ encodeport.Packager = FakePackager{}

// NewFakePackager is a packager called name that packages files of formats.
func NewFakePackager(name string, formats ...string) FakePackager {
	return FakePackager{name: name, formats: formats}
}

func (f FakePackager) Name() string { return f.name }

func (f FakePackager) Package(ctx context.Context, file string, chapters []encodeport.Chapter, tags encodeport.Tags) (string, error) {
	format := formatOf(file)
	if !slices.Contains(f.formats, format) {
		return "", encodeport.FormatNotSupported("packager", f.name, format)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.Write(body)
	for _, c := range chapters {
		fmt.Fprintf(&b, "\nchapter %s %s-%s", c.Title, c.Start, c.End)
	}
	for _, key := range slices.Sorted(maps.Keys(tags)) {
		fmt.Fprintf(&b, "\ntag %s=%s", key, tags[key])
	}
	out := strings.TrimSuffix(file, filepath.Ext(file)) + ".packaged." + format
	return out, os.WriteFile(out, []byte(b.String()), 0o600)
}

// FakeSamples writes one sample file per format into a temporary directory, for RunPackager over a fake packager, and returns
// them by format.
func FakeSamples(t testing.TB, formats ...string) map[string]string {
	t.Helper()
	dir := t.TempDir()
	samples := map[string]string{}
	for _, format := range formats {
		path := filepath.Join(dir, "sample."+format)
		if err := os.WriteFile(path, []byte("fake "+format+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		samples[format] = path
	}
	return samples
}

// formatOf is a file's format: its extension, lower case, without the dot.
func formatOf(file string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(file), "."))
}
