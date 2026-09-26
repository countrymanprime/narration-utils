package proofing

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
	"github.com/countrymanprime/narration-utils/shell/internal/stages"
)

var attestedAt = time.Date(2026, 9, 26, 11, 0, 0, 0, time.UTC)

// renderFixture is a compare fixture (a chapter track over two audio files) plus
// a rendered chapter file and the render store.
type renderFixture struct {
	*compareFixture
	store  *RenderStore
	render string
}

func newRenderFixture(t *testing.T) *renderFixture {
	t.Helper()
	f := &renderFixture{compareFixture: newCompareFixture(t)}
	f.store = NewRenderStore(f.dir)
	f.render = writeAudio(t, f.dir, "chapter-one.wav", "RIFF\x24\x00\x00\x00WAVEfmt the rendered chapter")
	return f
}

func (f *renderFixture) attest(t *testing.T, path string) RenderAssociation {
	t.Helper()
	association, err := Attest(f.store, proofingChapter(), f.savedView(), path, attestedAt)
	if err != nil {
		t.Fatalf("Attest() = %v", err)
	}
	return association
}

func (f *renderFixture) evaluate(t *testing.T) RenderStatus {
	t.Helper()
	status, err := EvaluateRender(f.store, proofingChapter(), f.savedView())
	if err != nil {
		t.Fatalf("EvaluateRender() = %v", err)
	}
	if status.State != RenderCurrent && (status.Cause == "" || status.Reason == "") {
		t.Fatalf("a render that is not current names its cause and action: %+v", status)
	}
	return status
}

func level(v float64) *float64 { return &v }

func wavReport(path string) measure.Report {
	return measure.Report{File: path, SampleRate: 44100, Channels: 1, DurationSeconds: 15, RMSdBFS: level(-20), SamplePeakdBFS: level(-4), NoiseFloordBFS: level(-65)}
}

func TestRenderStoreRoundTripAndReset(t *testing.T) {
	f := newRenderFixture(t)
	if _, ok, err := f.store.Get(testDocument, testChapter); ok || err != nil {
		t.Fatalf("an empty store has no association: %v %v", ok, err)
	}
	attested := f.attest(t, f.render)
	got, ok, err := f.store.Get(testDocument, testChapter)
	if err != nil || !ok || got.Path != f.render || got.Format != FormatWAV || got.ItemsFingerprint == "" || got.Render.Key == "" || !got.AttestedAt.Equal(attestedAt) || got.TrackGUID != testTrack {
		t.Fatalf("Get() = %+v %v %v, attested %+v", got, ok, err, attested)
	}
	if _, ok, _ := f.store.Get("another-import", testChapter); ok {
		t.Fatal("an association belongs to its documentId")
	}
	if _, err := os.Stat(filepath.Join(Dir(f.dir), "renders.json.tmp")); !os.IsNotExist(err) {
		t.Fatal("the write must be temp-file-then-rename, leaving no temp file")
	}
	if err := f.store.Clear(testDocument, testChapter); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := f.store.Get(testDocument, testChapter); ok {
		t.Fatal("Clear removes the association")
	}
}

// TestRenderStoreSurfacesACorruptFile: a corrupt renders.json is an error, not
// an empty store, and is not overwritten by the next association.
func TestRenderStoreSurfacesACorruptFile(t *testing.T) {
	f := newRenderFixture(t)
	if err := os.MkdirAll(Dir(f.dir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(RendersFile(f.dir), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.store.Get(testDocument, testChapter); !errors.Is(err, ErrRendersUnreadable) {
		t.Fatalf("Get() error = %v, want ErrRendersUnreadable", err)
	}
	if _, err := Attest(f.store, proofingChapter(), f.savedView(), f.render, attestedAt); !errors.Is(err, ErrRendersUnreadable) {
		t.Fatalf("Attest() error = %v, want ErrRendersUnreadable", err)
	}
	if bytes, _ := os.ReadFile(RendersFile(f.dir)); string(bytes) != "{not json" {
		t.Fatal("a corrupt file must not be overwritten")
	}
	if _, err := EvaluateRender(f.store, proofingChapter(), f.savedView()); !errors.Is(err, ErrRendersUnreadable) {
		t.Fatalf("EvaluateRender() error = %v, want ErrRendersUnreadable", err)
	}
}

func TestAttestRefusesWhatItCannotTie(t *testing.T) {
	f := newRenderFixture(t)
	if _, err := Attest(f.store, proofingChapter(), f.savedView(), filepath.Join(f.dir, "missing.wav"), attestedAt); err == nil {
		t.Fatal("a missing file cannot be chosen")
	}
	if err := f.mapping.Clear(testDocument, testTrack); err != nil {
		t.Fatal(err)
	}
	if _, err := Attest(f.store, proofingChapter(), f.savedView(), f.render, attestedAt); err == nil {
		t.Fatal("a render cannot be tied to a chapter with no confirmed track")
	}
}

// TestEvaluateRender is Phase 4's success signal: replacing the file or editing
// the chapter's items after attestation makes it stale; a non-WAV file is
// unsupported, not zero; no association asks for one.
func TestEvaluateRender(t *testing.T) {
	cases := []struct {
		name      string
		setup     func(t *testing.T, f *renderFixture)
		want      RenderState
		wantCause stages.UnknownCause
	}{
		{"no association", func(*testing.T, *renderFixture) {}, RenderNone, stages.CauseNeverAnalyzed},
		{"attested and unchanged", func(t *testing.T, f *renderFixture) { f.attest(t, f.render) }, RenderCurrent, ""},
		{"render replaced", func(t *testing.T, f *renderFixture) {
			f.attest(t, f.render)
			writeAudio(t, f.dir, "chapter-one.wav", "RIFF\x24\x00\x00\x00WAVEfmt a different render, longer")
		}, RenderStale, stages.CauseStale},
		{"render deleted", func(t *testing.T, f *renderFixture) {
			f.attest(t, f.render)
			if err := os.Remove(f.render); err != nil {
				t.Fatal(err)
			}
		}, RenderMissing, stages.CauseMeasurementUnavailable},
		{"an item trimmed after attestation", func(t *testing.T, f *renderFixture) {
			f.attest(t, f.render)
			f.project.Tracks[0].Items[0].Length = 9
		}, RenderStale, stages.CauseStale},
		{"a source re-recorded after attestation", func(t *testing.T, f *renderFixture) {
			f.attest(t, f.render)
			writeAudio(t, f.dir, "take-a.wav", "a new take")
		}, RenderStale, stages.CauseStale},
		{"mp3 render", func(t *testing.T, f *renderFixture) {
			f.attest(t, writeAudio(t, f.dir, "chapter-one.mp3", "ID3\x04\x00 an mp3"))
		}, RenderUnsupported, stages.CauseMeasurementUnavailable},
		{"chapter unlinked after attestation", func(t *testing.T, f *renderFixture) {
			f.attest(t, f.render)
			if err := f.mapping.Clear(testDocument, testTrack); err != nil {
				t.Fatal(err)
			}
		}, RenderStale, stages.CauseUnmappedTrack},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newRenderFixture(t)
			tc.setup(t, f)
			status := f.evaluate(t)
			if status.State != tc.want || status.Cause != tc.wantCause {
				t.Fatalf("status = %+v, want %s/%q", status, tc.want, tc.wantCause)
			}
		})
	}
}

// TestRenderMeasurementIsKeyedByTheRender: a measurement is a ledger record
// keyed by the render's fingerprint; it counts only for the render it
// measured, and a failed measurement of the current render is reported.
func TestRenderMeasurementIsKeyedByTheRender(t *testing.T) {
	f := newRenderFixture(t)
	association := f.attest(t, f.render)
	if status := f.evaluate(t); status.Measurement != nil || status.MeasurementFailed {
		t.Fatalf("nothing measured yet: %+v", status)
	}

	recorded, err := RecordRenderMeasurements(f.ledger, f.store, testDocument, f.dir, f.render, wavReport(f.render), "sha", nil, attestedAt, attestedAt.Add(time.Minute))
	if err != nil || len(recorded) != 1 {
		t.Fatalf("RecordRenderMeasurements() = %v, %v", recorded, err)
	}
	status := f.evaluate(t)
	if status.Measurement == nil || *status.Measurement.Report.RMSdBFS != -20 || status.Measurement.RecordID != recorded[0].ID || len(status.RecordIDs) != 1 {
		t.Fatalf("status = %+v", status)
	}
	var payload RenderMeasurementPayload
	if err := json.Unmarshal(recorded[0].Payload, &payload); err != nil || payload.RenderKey != association.Render.Key || payload.SHA256 != "sha" {
		t.Fatalf("payload = %+v, %v", payload, err)
	}

	other := writeAudio(t, f.dir, "somewhere-else.wav", "RIFF....WAVE unrelated")
	if recorded, err := RecordRenderMeasurements(f.ledger, f.store, testDocument, f.dir, other, wavReport(other), "", nil, attestedAt, attestedAt); err != nil || len(recorded) != 0 {
		t.Fatalf("a file that is no chapter's render records nothing: %v %v", recorded, err)
	}

	if _, err := RecordRenderMeasurements(f.ledger, f.store, testDocument, f.dir, f.render, measure.Report{}, "", errors.New("the file changed"), attestedAt.Add(2*time.Minute), attestedAt.Add(3*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if status := f.evaluate(t); !status.MeasurementFailed || status.Measurement != nil {
		t.Fatalf("the latest measurement of this render failed: %+v", status)
	}

	writeAudio(t, f.dir, "chapter-one.wav", "RIFF\x24\x00\x00\x00WAVEfmt re-rendered")
	f.attest(t, f.render)
	if status := f.evaluate(t); status.State != RenderCurrent || status.Measurement != nil || status.MeasurementFailed {
		t.Fatalf("a new render's status must not reuse the old render's measurement: %+v", status)
	}
}

func TestSniffFormat(t *testing.T) {
	dir := t.TempDir()
	cases := map[string]string{
		"a.wav":  "RIFF\x00\x00\x00\x00WAVEfmt ",
		"b.mp3":  "ID3\x03\x00",
		"c.bin":  "\xff\xfb\x90\x00 frame",
		"d.wav":  "not really a wav",
		"e.flac": "fLaC",
	}
	want := map[string]string{"a.wav": FormatWAV, "b.mp3": FormatMP3, "c.bin": FormatMP3, "d.wav": FormatOther, "e.flac": FormatOther}
	for name, content := range cases {
		path := writeAudio(t, dir, name, content)
		if got := sniffFormat(path); got != want[name] {
			t.Errorf("sniffFormat(%s) = %q, want %q", name, got, want[name])
		}
	}
}
