package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// minimalMonoWAV builds a small real RIFF/WAVE file (16-bit PCM mono, a short tone) that measure.PeaksFile can
// actually decode - coverageProject's own "media/take.wav" (bindings_workspace_test.go) is deliberately just the
// bytes "RIFF audio", enough for the tracks parser's file-exists check but not a real WAV, so a binding test that
// wants real peaks needs its own fixture.
func minimalMonoWAV(t *testing.T, seconds float64, sampleRate int) []byte {
	t.Helper()
	frames := int(math.Round(seconds * float64(sampleRate)))
	var data bytes.Buffer
	for i := 0; i < frames; i++ {
		sample := int16(math.Round(0.5 * 32767 * math.Sin(2*math.Pi*220*float64(i)/float64(sampleRate))))
		if err := binary.Write(&data, binary.LittleEndian, sample); err != nil {
			t.Fatal(err)
		}
	}
	var fmtChunk bytes.Buffer
	blockAlign := uint16(2)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(1))          // PCM
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(1))          // mono
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(sampleRate)) // sample rate
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(sampleRate)*uint32(blockAlign))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, blockAlign)
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(16)) // bits per sample

	writeChunk := func(out *bytes.Buffer, id string, payload []byte) {
		out.WriteString(id)
		_ = binary.Write(out, binary.LittleEndian, uint32(len(payload)))
		out.Write(payload)
	}
	var body bytes.Buffer
	body.WriteString("WAVE")
	writeChunk(&body, "fmt ", fmtChunk.Bytes())
	writeChunk(&body, "data", data.Bytes())

	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(body.Len()))
	out.Write(body.Bytes())
	return out.Bytes()
}

// workspacePeaksProject is coverageProject (bindings_workspace_test.go) with a real, decodable WAV in place of
// its placeholder "media/take.wav": one track, one 4-second item over 2 seconds of real audio starting 1 second
// into the source (SOFFS 1), so the played range [1, 3) exercises CachedPeaksFile's slicing.
func workspacePeaksProject(t *testing.T) string {
	t.Helper()
	project := coverageProject(t)
	wav := minimalMonoWAV(t, 4, 8000)
	if err := os.WriteFile(filepath.Join(project, "media", "take.wav"), wav, 0o600); err != nil {
		t.Fatal(err)
	}
	return project
}

func TestWorkspacePeaksAnswersEveryAnalyzedItemsWaveform(t *testing.T) {
	host := coverageHost(t, workspacePeaksProject(t), true, fakeAlignedCoverageSidecar())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	got := bindingAnswer[WorkspacePeaksView](t)(host.WorkspacePeaks("c-0001"))

	if got.ChapterID != "c-0001" || len(got.Items) != 1 {
		t.Fatalf("got = %+v", got)
	}
	item := got.Items[0]
	if item.Reason != "" || item.Peaks == nil {
		t.Fatalf("item = %+v", item)
	}
	// coverageProject's item has LENGTH 4, PLAYRATE 1, SOFFS 0 (bindings_workspace_test.go): the whole 4 s source is
	// its played range, at DefaultPeaksPerSecond (50/s).
	if item.Peaks.Buckets != 4*50 || item.Peaks.StartSeconds != 0 {
		t.Fatalf("peaks = %+v", item.Peaks)
	}
}

func TestWorkspacePeaksOfAnItemWithNoUsableSourceAnswersAReasonNotAnError(t *testing.T) {
	// coverageProject's own fixture (unmodified): its "media/take.wav" is just the placeholder bytes "RIFF audio",
	// which exists on disk (SourceAvailable) but is not a real WAV a decoder can read.
	host := coverageHost(t, coverageProject(t), true, fakeAlignedCoverageSidecar())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	got := bindingAnswer[WorkspacePeaksView](t)(host.WorkspacePeaks("c-0001"))

	if len(got.Items) != 1 {
		t.Fatalf("got = %+v", got)
	}
	if item := got.Items[0]; item.Peaks != nil || item.Reason == "" {
		t.Fatalf("item = %+v, want a Reason and no Peaks", item)
	}
}

func TestWorkspacePeaksWithNoProjectRefuses(t *testing.T) {
	host := NewHost()

	if _, err := host.WorkspacePeaks("c-0001"); err != errNoProject {
		t.Fatalf("err = %v, want errNoProject", err)
	}
}

func TestWorkspacePeaksCachesAcrossCalls(t *testing.T) {
	project := workspacePeaksProject(t)
	host := coverageHost(t, project, true, fakeAlignedCoverageSidecar())
	if _, err := host.CoverageStart("c-0001", nil); err != nil {
		t.Fatal(err)
	}
	host.services().coverage.Wait()

	first := bindingAnswer[WorkspacePeaksView](t)(host.WorkspacePeaks("c-0001"))
	second := bindingAnswer[WorkspacePeaksView](t)(host.WorkspacePeaks("c-0001"))

	if first.Items[0].Peaks == nil || second.Items[0].Peaks == nil {
		t.Fatal("expected peaks on both calls")
	}
	if first.Items[0].Peaks.Buckets != second.Items[0].Peaks.Buckets {
		t.Fatalf("first = %d buckets, second = %d buckets; the cached answer must match", first.Items[0].Peaks.Buckets, second.Items[0].Peaks.Buckets)
	}
	if _, err := os.Stat(filepath.Join(project, "narration-utils", "analysis", "cache")); err != nil {
		t.Fatalf("expected the evidence cache directory to exist after the first call: %v", err)
	}
}
