package main

import (
	"errors"
	"testing"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// What MeasurePickFiles, MeasureAnalyze, MeasureState and MeasureCancel send (diagnostics-delivery-and-cleanup-tools
// Phase 1): the picker's answer, the idle job, a measurement part way through, and each way one ends. The reports are
// built here rather than measured, so the files do not depend on floating point; their shape is measure.Report's own.

var contractMeasurePaths = []string{"C:/Renders/Chapter 01.wav", "C:/Renders/Chapter 02.wav", "C:/Renders/Chapter 03.mp3"}

func contractMeasured(path string) measure.FileMeasurement {
	value := func(v float64) *float64 { return &v }
	return measure.FileMeasurement{
		Report: measure.Report{
			File: path, SampleRate: 48000, Channels: 2, DurationSeconds: 1843.5,
			IntegratedLUFS: value(-19.4), RMSdBFS: value(-21.2), SamplePeakdBFS: value(-3.6), TruePeakdBTP: value(-3.1),
			NoiseFloordBFS: value(-66.8), DigitalSilentWindows: 0, FullScaleSamples: 4, ClipRunCount: 1,
			HeadRoomToneSeconds: value(0.8), TailRoomToneSeconds: value(2.5), HeadDigitalSilenceSeconds: value(0), TailDigitalSilenceSeconds: value(0),
			ClipRuns: []measure.ClipRun{{Channel: 1, StartSeconds: 612.25, DurationSeconds: 0.0000833, Samples: 4}},
		},
		Fingerprint: measure.Fingerprint{SizeBytes: 530_928_044, ModifiedAt: "2026-09-23T14:02:11.5Z", SHA256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"},
	}
}

// contractUnavailable is a render of digital silence: measured, and every level unavailable.
func contractUnavailable(path string) measure.FileMeasurement {
	return measure.FileMeasurement{
		Report:      measure.Report{File: path, SampleRate: 44100, Channels: 1, DurationSeconds: 2, DigitalSilentWindows: 4, ClipRuns: []measure.ClipRun{}},
		Fingerprint: measure.Fingerprint{SizeBytes: 176_444, ModifiedAt: "2026-09-23T14:05:00Z", SHA256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
	}
}

func contractMeasureJob() *measureJob {
	job := &measureJob{id: "measure-1", phase: "running", started: time.Now(), cancel: func() {}, message: "Measuring 3 files."}
	job.logs = []string{job.message}
	for i, path := range contractMeasurePaths {
		job.files = append(job.files, MeasureFileResult{Path: path, Name: []string{"Chapter 01.wav", "Chapter 02.wav", "Chapter 03.mp3"}[i], Status: measureFilePending})
		job.weights = append(job.weights, 1000)
		job.totalWeight += 1000
	}
	return job
}

// pinMeasureJob pins a job as the bindings answer it: judged against the built-in ACX profile, which the first contract
// file misses (a 48 kHz render) and the silent render cannot be judged against (ADR 0179).
func pinMeasureJob(t *testing.T, name string, job MeasureJob) {
	t.Helper()
	job = judgeMeasureJob(job, deliveryprofile.ACX(), "")
	job.Elapsed = 3.5
	contractfile.Check(t, name, job)
}

func TestContractMeasureBindings(t *testing.T) {
	contractfile.Check(t, "measure-pick", MeasurePickResult{Paths: contractMeasurePaths})
	contractfile.Check(t, "measure-pick-cancelled", MeasurePickResult{Paths: []string{}})
	pinMeasureJob(t, "measure-idle", NewHost().measureState())

	running := contractMeasureJob()
	running.begin(0)
	running.complete(0, contractMeasured(contractMeasurePaths[0]), nil)
	running.begin(1)
	running.progress(1, 21_000, 42_000)
	pinMeasureJob(t, "measure-running", running.snapshot())

	finished := contractMeasureJob()
	finished.complete(0, contractMeasured(contractMeasurePaths[0]), nil)
	finished.complete(1, contractUnavailable(contractMeasurePaths[1]), nil)
	finished.complete(2, measure.FileMeasurement{}, errors.New("not a RIFF/WAVE file"))
	finished.finish(false, nil)
	pinMeasureJob(t, "measure-success", finished.snapshot())

	cancelled := contractMeasureJob()
	cancelled.complete(0, contractMeasured(contractMeasurePaths[0]), nil)
	cancelled.begin(1)
	cancelled.finish(true, nil)
	pinMeasureJob(t, "measure-cancelled", cancelled.snapshot())

	broken := contractMeasureJob()
	broken.begin(0)
	broken.finish(false, errors.New("runtime error: index out of range [4] with length 4"))
	pinMeasureJob(t, "measure-error", broken.snapshot())
}
