package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/evidence"
)

// editingProject writes a project folder with one saved .rpp (one track, one item), a manuscript and a confirmed
// chapter-track link, the same shape coverageProject builds, but with a real, decodable WAV (a half-second of quiet
// tone: no silence gap, so a scan of it finds no empty-space candidates - a clean-pass fixture). unmapped controls
// whether the chapter-track link is confirmed at all (Q9's own "unmapped" refusal).
func editingProject(t *testing.T, unmapped bool) string {
	t.Helper()
	project := t.TempDir()
	write := func(relative, content string) {
		path := filepath.Join(project, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	wavPath := filepath.Join(project, filepath.FromSlash("media/take.wav"))
	if err := os.MkdirAll(filepath.Dir(wavPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wavPath, encodeTestWAV(44100, toneSamplesForTest(44100, 0.5, 440, -18)), 0o600); err != nil {
		t.Fatal(err)
	}
	write("book.rpp", `<REAPER_PROJECT 0.1 "7.80/win64" 1789970042 0
  <TRACK {TRACK-1}
    NAME "Chapter One"
    TRACKID {TRACK-1}
    <ITEM
      POSITION 0
      LENGTH 0.5
      IGUID {ITEM-1}
      SOFFS 0
      PLAYRATE 1 1 0 -1 0 0.0025
      <SOURCE WAVE
        FILE "media/take.wav"
      >
    >
  >
>
`)
	write("narration-utils/manuscript/manuscript.json", `{"schemaVersion":1,"documentId":"doc-1","chapters":[{"id":"c-0001","title":"Chapter One","contentKind":"narration"}],"paragraphs":[{"id":"p-000001","chapterId":"c-0001","index":0,"text":"Alice."}]}`)
	if !unmapped {
		if _, err := evidence.NewMappingStore(project).Confirm("doc-1", "{TRACK-1}", "c-0001", "Chapter One"); err != nil {
			t.Fatal(err)
		}
	}
	return project
}

// editingHost attaches an editingProject to a fresh host.
func editingHost(t *testing.T, unmapped bool) *Host {
	t.Helper()
	host := NewHost()
	next := host.config
	next.projectFolder = editingProject(t, unmapped)
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	return host
}

func TestEditingBindingsBeforeAProjectIsOpenFail(t *testing.T) {
	host := NewHost()
	if _, err := host.EditingStart("doc-1", "c-0001", "Chapter One"); err == nil {
		t.Fatal("a start with no project must fail")
	}
	state := decodeAnswer(t)(host.EditingState())
	if state["phase"] != "idle" {
		t.Fatalf("state with no project = %v", state)
	}
	if _, err := host.EditingCancel(); err != nil {
		t.Fatalf("cancel with no project must be a harmless no-op: %v", err)
	}
	candidates := decodeAnswerList(t)(host.EditingCandidates("c-0001"))
	if len(candidates) != 0 {
		t.Fatalf("candidates with no project = %v", candidates)
	}
	contractfile.Check(t, "editing-state-idle", state)
}

func TestEditingStartRefusesAnUnmappedChapter(t *testing.T) {
	host := editingHost(t, true)
	refused := decodeAnswer(t)(host.EditingStart("doc-1", "c-0001", "Chapter One"))
	if refused["status"] != "refused" || refused["reason"] != "unmapped" {
		t.Fatalf("start on an unmapped chapter = %v", refused)
	}
	contractfile.Check(t, "editing-start-refused-unmapped", refused)
}

func TestEditingStartRunsToCompletionWithNoCandidates(t *testing.T) {
	host := editingHost(t, false)
	started := decodeAnswer(t)(host.EditingStart("doc-1", "c-0001", "Chapter One"))
	if started["status"] != "started" {
		t.Fatalf("start = %v", started)
	}
	host.services().editing.Wait()

	state := decodeAnswer(t)(host.EditingState())
	if state["phase"] != "complete" || state["chapterId"] != "c-0001" {
		t.Fatalf("state after a clean scan = %v", state)
	}

	candidates := decodeAnswerList(t)(host.EditingCandidates("c-0001"))
	if len(candidates) != 0 {
		t.Fatalf("a scan of a silence-free tone must find no empty-space candidates: %v", candidates)
	}
	contractfile.Check(t, "editing-candidates-empty", candidates)
}

func TestEditingCancelWithNothingRunningIsANoOp(t *testing.T) {
	host := editingHost(t, false)
	if _, err := host.EditingCancel(); err != nil {
		t.Fatal(err)
	}
	if state := decodeAnswer(t)(host.EditingState()); state["phase"] != "idle" {
		t.Fatalf("cancelling nothing must not start or change anything: %v", state)
	}
}

func decodeAnswerList(t *testing.T) func(string, error) []any {
	t.Helper()
	return func(payload string, err error) []any {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		var decoded []any
		if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
			t.Fatal(err)
		}
		return decoded
	}
}

// encodeTestWAV, chunkForTest and toneSamplesForTest are a minimal RIFF/WAVE PCM16 encoder, mirroring
// apps/desktop/internal/editing's own test-only encodeWAV16/toneSamples (not exported from that package, so a test
// helper here is its own copy rather than a shared one).
func encodeTestWAV(rate int, samples []float64) []byte {
	var data bytes.Buffer
	for _, s := range samples {
		clamped := math.Max(-1, math.Min(1, s))
		_ = binary.Write(&data, binary.LittleEndian, int16(math.Round(clamped*32767)))
	}
	var fmtChunk bytes.Buffer
	const channels, bits = 1, 16
	blockAlign := channels * bits / 8
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(1))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(channels))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(rate))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint32(rate*blockAlign))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(blockAlign))
	_ = binary.Write(&fmtChunk, binary.LittleEndian, uint16(bits))
	fmtBytes := chunkForTest("fmt ", fmtChunk.Bytes())
	dataBytes := chunkForTest("data", data.Bytes())
	body := append([]byte("WAVE"), fmtBytes...)
	body = append(body, dataBytes...)
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(body)))
	out.Write(body)
	return out.Bytes()
}

func chunkForTest(id string, payload []byte) []byte {
	var out bytes.Buffer
	out.WriteString(id)
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(payload)))
	out.Write(payload)
	if len(payload)%2 == 1 {
		out.WriteByte(0)
	}
	return out.Bytes()
}

func toneSamplesForTest(rate int, seconds, freq, peakDB float64) []float64 {
	n := int(math.Round(seconds * float64(rate)))
	amp := math.Pow(10, peakDB/20)
	out := make([]float64, n)
	for i := range out {
		out[i] = amp * math.Sin(2*math.Pi*freq*float64(i)/float64(rate))
	}
	return out
}
