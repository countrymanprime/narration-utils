package measure

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// signalCorpusEnv names a signal corpus built from the committed LibriVox
// recordings (tests/fixtures/audio/librivox-alice, `build.py signal`): real
// narration with defects put in at known times. The built WAVs are never
// committed, so the test is skipped unless the variable is set.
const signalCorpusEnv = "NARRATION_SIGNAL_CORPUS"

// How far a finding may sit from the labelled time and still be the same event.
const (
	signalEdgeToleranceSeconds  = 0.3
	signalShiftToleranceSeconds = 5.0
	signalClickToleranceSeconds = 0.1
	// ACX: noise floor at most -60 dBFS; head room tone 0.5 to 1 s, tail 1 to 5 s.
	acxNoiseFloordBFS   = -60.0
	acxMinHeadSeconds   = 0.5
	acxMaxTailSeconds   = 5.0
	roomToneRiseMinimum = 3.0
)

type signalEvent struct {
	Kind     string  `json:"kind"`
	StartS   float64 `json:"start_s"`
	EndS     float64 `json:"end_s"`
	AtS      float64 `json:"at_s"`
	FromS    float64 `json:"from_s"`
	DeltaDB  float64 `json:"delta_db"`
	RMSdBFS  float64 `json:"rms_dbfs"`
	PeakdBFS float64 `json:"peak_dbfs"`
	// KnownIssue says why the tools are known to miss this event.
	KnownIssue string `json:"known_issue"`
}

type signalCase struct {
	ID     string        `json:"id"`
	File   string        `json:"file"`
	Words  string        `json:"words"`
	Edges  signalEdges   `json:"edges"`
	Events []signalEvent `json:"events"`
}

// signalEdges is the builder's own timing of the room tone at the head and
// tail: before the first and after the last 50 ms window at or above the
// floor, the definition the edge meter documents.
type signalEdges struct {
	FloordBFS float64 `json:"floor_dbfs"`
	HeadS     float64 `json:"head_s"`
	TailS     float64 `json:"tail_s"`
}

type signalRun struct {
	diagnostics Diagnostics
	report      Report
}

// TestLibriVoxSignalCorpus runs the windowed diagnostics and the delivery
// measurement over each case and checks that every defect put in is found
// where it was put. Findings away from any labelled event are logged, not
// failed: they are the false-positive count on real narration, and the
// control case is the baseline for them.
func TestLibriVoxSignalCorpus(t *testing.T) {
	dir := os.Getenv(signalCorpusEnv)
	if dir == "" {
		t.Skipf("set %s to a built signal corpus to run this (tests/fixtures/audio/librivox-alice/README.md)", signalCorpusEnv)
	}
	var labels struct {
		Cases []signalCase `json:"cases"`
	}
	readSignalJSON(t, filepath.Join(dir, "labels.json"), &labels)
	for _, c := range labels.Cases {
		t.Run(c.ID, func(t *testing.T) {
			run := runSignalCase(t, dir, c)
			logSignalRun(t, run)
			checkEdges(t, c, run.report)
			for _, event := range c.Events {
				checkSignalEvent(t, event, run)
			}
			if len(c.Events) == 0 && run.diagnostics.Clipping.RegionCount > 0 {
				t.Errorf("an unedited reading has %d clipped regions", run.diagnostics.Clipping.RegionCount)
			}
		})
	}
}

func readSignalJSON(t *testing.T, path string, into any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
}

func runSignalCase(t *testing.T, dir string, c signalCase) signalRun {
	t.Helper()
	var words []Word
	readSignalJSON(t, filepath.Join(dir, c.Words), &words)
	path := filepath.Join(dir, c.File)
	input := DiagnosticInput{SourceKind: SourceRawRecording, Options: DefaultDiagnosticOptions(), Words: words}
	diagnostics, err := DiagnoseFile(context.Background(), path, input)
	if err != nil {
		t.Fatalf("diagnose %s: %v", c.File, err)
	}
	report, err := AnalyzeFile(path)
	if err != nil {
		t.Fatalf("analyze %s: %v", c.File, err)
	}
	return signalRun{diagnostics, report}
}

func logSignalRun(t *testing.T, run signalRun) {
	t.Helper()
	d, r := run.diagnostics, run.report
	clicks := 0
	for _, candidate := range d.Cleanup.Candidates {
		if candidate.Class == CleanupClick {
			clicks++
		}
	}
	t.Logf("noise floor %s dBFS, RMS %s dBFS, head %s s, tail %s s, digital-silent windows %d",
		fmtPtr(r.NoiseFloordBFS), fmtPtr(r.RMSdBFS), fmtPtr(r.HeadRoomToneSeconds), fmtPtr(r.TailRoomToneSeconds), r.DigitalSilentWindows)
	t.Logf("clipped regions %d, level shifts %d, silences %d, room-tone segments %d, click candidates %d (the control case is the false-positive baseline)",
		d.Clipping.RegionCount, len(d.LevelShifts), len(d.Silences), len(d.RoomTone), clicks)
	for _, shift := range d.LevelShifts {
		t.Logf("  level shift %.1f-%.1f s: %+.1f LU", shift.StartSeconds, shift.EndSeconds, shift.DeltaLU)
	}
	if d.Pacing.PauseSummary != nil {
		for _, pause := range d.Pacing.LongPauses {
			t.Logf("  long pause at %.1f s for %.1f s", pause.StartSeconds, pause.DurationSeconds)
		}
	}
}

func fmtPtr(v *float64) string {
	if v == nil {
		return "n/a"
	}
	return fmt.Sprintf("%.2f", *v)
}

// checkEdges compares the measured head and tail room tone with the
// builder's reference. Room tone at or above the edge floor is not room tone
// to the meter (ADR 0158), so a file whose noise floor is that loud has no
// measurable edges and is only logged.
func checkEdges(t *testing.T, c signalCase, r Report) {
	t.Helper()
	if r.NoiseFloordBFS != nil && *r.NoiseFloordBFS >= c.Edges.FloordBFS {
		t.Logf("noise floor %.1f dBFS is at or above the %.0f dBFS edge floor: head and tail read %s s and %s s",
			*r.NoiseFloordBFS, c.Edges.FloordBFS, fmtPtr(r.HeadRoomToneSeconds), fmtPtr(r.TailRoomToneSeconds))
		return
	}
	checkEdge(t, "head", r.HeadRoomToneSeconds, c.Edges.HeadS)
	checkEdge(t, "tail", r.TailRoomToneSeconds, c.Edges.TailS)
	if c.Edges.HeadS < acxMinHeadSeconds && (r.HeadRoomToneSeconds == nil || *r.HeadRoomToneSeconds >= acxMinHeadSeconds) {
		t.Errorf("a %.2f s head is under ACX's %.1f s, but the measurement reads %s s", c.Edges.HeadS, acxMinHeadSeconds, fmtPtr(r.HeadRoomToneSeconds))
	}
	if c.Edges.TailS > acxMaxTailSeconds && (r.TailRoomToneSeconds == nil || *r.TailRoomToneSeconds <= acxMaxTailSeconds) {
		t.Errorf("a %.2f s tail is over ACX's %.1f s, but the measurement reads %s s", c.Edges.TailS, acxMaxTailSeconds, fmtPtr(r.TailRoomToneSeconds))
	}
}

func checkEdge(t *testing.T, name string, measured *float64, want float64) {
	t.Helper()
	if measured == nil || math.Abs(*measured-want) > signalEdgeToleranceSeconds {
		t.Errorf("%s room tone reads %s s, the reference is %.2f s", name, fmtPtr(measured), want)
	}
}

// checkSignalEvent fails when an event is missed, unless it is a known
// issue: then it logs the miss, and fails once the event is found, so the
// recipe's note is removed rather than left stale.
func checkSignalEvent(t *testing.T, event signalEvent, run signalRun) {
	t.Helper()
	missed := missedSignalEvent(event, run)
	switch {
	case missed != "" && event.KnownIssue == "":
		t.Error(missed)
	case missed != "":
		t.Logf("known issue: %s (%s)", missed, event.KnownIssue)
	case event.KnownIssue != "":
		t.Errorf("a %s at %.2f s is now found; remove its knownIssue from recipes/signal.json: %s", event.Kind, event.AtS, event.KnownIssue)
	}
}

// missedSignalEvent says how the event was missed, or "" when it was found.
func missedSignalEvent(event signalEvent, run signalRun) string {
	d, r := run.diagnostics, run.report
	switch event.Kind {
	case "clipping":
		if !anyClipOverlaps(d.Clipping.Regions, event.StartS, event.EndS) {
			return fmt.Sprintf("clipping put in at %.2f-%.2f s was not found", event.StartS, event.EndS)
		}
	case "level_shift":
		if !anyShiftNear(d.LevelShifts, event.AtS, event.DeltaDB) {
			return fmt.Sprintf("a %+.0f dB level change at %.2f s was not found", event.DeltaDB, event.AtS)
		}
	case "click":
		if !anyClickNear(d.Cleanup.Candidates, event.AtS) {
			return fmt.Sprintf("a click at %.2f s (%.0f dBFS peak) was not a click candidate", event.AtS, event.PeakdBFS)
		}
	case "dead_air":
		if !anySilenceCovers(d.Silences, event.StartS, event.EndS) {
			return fmt.Sprintf("dead air at %.2f-%.2f s was not a silence region", event.StartS, event.EndS)
		}
	case "digital_silence":
		// A dropout inside a pause joins the room tone around it in one
		// silence region, which is then not wholly digital; the delivery
		// measurement counts its exact-zero windows.
		if !anySilenceCovers(d.Silences, event.StartS, event.EndS) || r.DigitalSilentWindows == 0 {
			return fmt.Sprintf("a dropout at %.2f-%.2f s was not a silence region with digital-silent windows (%d)", event.StartS, event.EndS, r.DigitalSilentWindows)
		}
	case "hiss":
		return missedHiss(event, d, r)
	default:
		return fmt.Sprintf("unknown event kind %q", event.Kind)
	}
	return ""
}

func anyClipOverlaps(regions []ClipRegion, start, end float64) bool {
	for _, region := range regions {
		if region.StartSeconds <= end && region.EndSeconds >= start {
			return true
		}
	}
	return false
}

func anyShiftNear(shifts []LevelShift, at, deltaDB float64) bool {
	for _, shift := range shifts {
		near := shift.StartSeconds-signalShiftToleranceSeconds <= at && at <= shift.EndSeconds+signalShiftToleranceSeconds
		if near && math.Signbit(shift.DeltaLU) == math.Signbit(deltaDB) {
			return true
		}
	}
	return false
}

func anyClickNear(candidates []CleanupCandidate, at float64) bool {
	for _, candidate := range candidates {
		near := candidate.StartSeconds-signalClickToleranceSeconds <= at && at <= candidate.EndSeconds+signalClickToleranceSeconds
		if candidate.Class == CleanupClick && near {
			return true
		}
	}
	return false
}

func anySilenceCovers(silences []SilenceRegion, start, end float64) bool {
	for _, silence := range silences {
		if silence.StartSeconds <= start+signalEdgeToleranceSeconds && silence.EndSeconds >= end-signalEdgeToleranceSeconds {
			return true
		}
	}
	return false
}

func missedHiss(event signalEvent, d Diagnostics, r Report) string {
	if event.FromS == 0 {
		if r.NoiseFloordBFS == nil || *r.NoiseFloordBFS <= acxNoiseFloordBFS {
			return fmt.Sprintf("hiss at %.0f dBFS RMS over the whole file, but the noise floor reads %s dBFS (ACX limit %.0f)", event.RMSdBFS, fmtPtr(r.NoiseFloordBFS), acxNoiseFloordBFS)
		}
		return ""
	}
	for i := 1; i < len(d.RoomTone); i++ {
		before, after := d.RoomTone[i-1], d.RoomTone[i]
		if math.Abs(after.StartSeconds-event.FromS) <= signalShiftToleranceSeconds*2 && after.LeveldBFS-before.LeveldBFS >= roomToneRiseMinimum {
			return ""
		}
	}
	return fmt.Sprintf("room tone raised by hiss from %.2f s was not a new, louder room-tone segment", event.FromS)
}
