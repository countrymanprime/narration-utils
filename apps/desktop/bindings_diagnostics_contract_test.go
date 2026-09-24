package main

import (
	"errors"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// What DiagnosticsAnalyze, DiagnosticsState and DiagnosticsCancel send (diagnostics PRD Phase 6): the idle check with
// its thresholds, a check part way through, and each way one ends. The diagnostics are built here rather than
// measured, so the files do not depend on floating point; their findings are measure.Diagnostics.Findings' own.

// contractDiagnosed is a render with one of each finding a check without transcript timing can raise: a clip region, a
// level shift and a room-tone change.
func contractDiagnosed(path string) measure.Diagnostics {
	return measure.Diagnostics{
		File: path, SourceKind: measure.SourceProcessedRender, Options: measure.DefaultDiagnosticOptions(),
		SampleRate: 48000, Channels: 2, DurationSeconds: 1843.5,
		Clipping: measure.ClipDiagnostics{RegionCount: 1, Regions: []measure.ClipRegion{
			{StartSeconds: 612.25, EndSeconds: 612.3125, Channels: []int{1}, LongestRunSamples: 9},
		}},
		LevelShifts: []measure.LevelShift{{StartSeconds: 905, EndSeconds: 906, BeforeLUFS: -19.5, AfterLUFS: -25.25, DeltaLU: -5.75}},
		Silences: []measure.SilenceRegion{
			{StartSeconds: 10, EndSeconds: 11.5}, {StartSeconds: 1200, EndSeconds: 1201},
		},
		RoomTone: []measure.RoomToneSegment{
			{StartSeconds: 0, EndSeconds: 1180.5, LeveldBFS: -68.5, Regions: 40},
			{StartSeconds: 1201.25, EndSeconds: 1843.5, LeveldBFS: -60.25, Regions: 22},
		},
		Pacing: measure.PauseProfileEvidence{
			Evidence:     measure.Evidence{Status: measure.StatusUnavailable, Reason: "no transcript timing for this audio"},
			PauseOptions: measure.DefaultPauseOptions(),
		},
	}
}

// contractQuiet is a render in which nothing crossed a threshold.
func contractQuiet(path string) measure.Diagnostics {
	return measure.Diagnostics{
		File: path, SourceKind: measure.SourceProcessedRender, Options: measure.DefaultDiagnosticOptions(),
		SampleRate: 44100, Channels: 1, DurationSeconds: 1210,
		Clipping: measure.ClipDiagnostics{Regions: []measure.ClipRegion{}},
		RoomTone: []measure.RoomToneSegment{{StartSeconds: 0, EndSeconds: 1210, LeveldBFS: -66, Regions: 31}},
		Pacing: measure.PauseProfileEvidence{
			Evidence:     measure.Evidence{Status: measure.StatusUnavailable, Reason: "no transcript timing for this audio"},
			PauseOptions: measure.DefaultPauseOptions(),
		},
	}
}

func contractDiagnosticsJob() *diagnosticsJob {
	job := &diagnosticsJob{
		id: "diagnostics-1", phase: "running", started: time.Now(), cancel: func() {}, message: "Checking 3 files.",
		sourceKind: measure.SourceProcessedRender, thresholds: measure.DefaultDiagnosticOptions(),
	}
	job.logs = []string{job.message}
	for i, path := range contractMeasurePaths {
		job.files = append(job.files, DiagnosticsFileResult{Path: path, Name: []string{"Chapter 01.wav", "Chapter 02.wav", "Chapter 03.mp3"}[i], Status: diagnosticsFilePending})
		job.weights = append(job.weights, 1000)
		job.totalWeight += 1000
	}
	return job
}

func pinDiagnosticsJob(t *testing.T, name string, job DiagnosticsJob) {
	t.Helper()
	job.Elapsed = 3.5
	contractfile.Check(t, name, job)
}

func TestContractDiagnosticsBindings(t *testing.T) {
	pinDiagnosticsJob(t, "diagnostics-idle", NewHost().diagnosticsState())

	running := contractDiagnosticsJob()
	running.begin(0)
	running.complete(0, contractDiagnosed(contractMeasurePaths[0]), nil)
	running.begin(1)
	running.progress(1, 21_000, 42_000)
	pinDiagnosticsJob(t, "diagnostics-running", running.snapshot())

	finished := contractDiagnosticsJob()
	finished.complete(0, contractDiagnosed(contractMeasurePaths[0]), nil)
	finished.complete(1, contractQuiet(contractMeasurePaths[1]), nil)
	finished.complete(2, measure.Diagnostics{}, errors.New("not a RIFF/WAVE file"))
	finished.finish(false, nil)
	pinDiagnosticsJob(t, "diagnostics-success", finished.snapshot())

	cancelled := contractDiagnosticsJob()
	cancelled.complete(0, contractDiagnosed(contractMeasurePaths[0]), nil)
	cancelled.begin(1)
	cancelled.finish(true, nil)
	pinDiagnosticsJob(t, "diagnostics-cancelled", cancelled.snapshot())

	broken := contractDiagnosticsJob()
	broken.begin(0)
	broken.finish(false, errors.New("runtime error: index out of range [4] with length 4"))
	pinDiagnosticsJob(t, "diagnostics-error", broken.snapshot())
}
