package main

import (
	"errors"
	"path/filepath"
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

	pinMeasureJob(t, "measure-mp3", contractMP3Job())

	broken := contractMeasureJob()
	broken.begin(0)
	broken.finish(false, errors.New("runtime error: index out of range [4] with length 4"))
	pinMeasureJob(t, "measure-error", broken.snapshot())
}

// contractMP3Job is a finished measurement of two MP3s read for their container (delivery profiles PRD Phase 6): a
// 192 kbps CBR file that meets ACX's format, and a VBR one that does not; neither has a level, since neither is decoded.
func contractMP3Job() MeasureJob {
	paths := []string{"C:/Renders/Chapter 01.mp3", "C:/Renders/Chapter 02.mp3"}
	job := &measureJob{id: "measure-2", phase: "running", started: time.Now(), cancel: func() {}, message: "Measuring 2 files."}
	job.logs = []string{job.message}
	for _, path := range paths {
		job.files = append(job.files, MeasureFileResult{Path: path, Name: filepath.Base(path), Status: measureFilePending})
		job.weights = append(job.weights, 1000)
		job.totalWeight += 1000
	}
	infos := []measure.MP3Info{
		{Version: "MPEG-1", Layer: 3, BitrateKbps: 192, AverageBitrateKbps: 192, CBR: true, VBRTag: "Info", SampleRate: 44100,
			ChannelMode: "mono", Frames: 70_000, DurationSeconds: 1828.5714285714287, ID3v2Bytes: 4096},
		{Version: "MPEG-1", Layer: 3, AverageBitrateKbps: 176.3, VBRTag: "Xing", SampleRate: 44100, ChannelMode: "mono",
			Frames: 40_000, DurationSeconds: 1044.8979591836735, LostBytes: 417},
	}
	for i, info := range infos {
		report := measure.Report{File: paths[i], SampleRate: info.SampleRate, Channels: info.Channels(), DurationSeconds: info.DurationSeconds, ClipRuns: []measure.ClipRun{}, MP3: &info}
		job.complete(i, measure.FileMeasurement{Report: report, Fingerprint: measure.Fingerprint{SizeBytes: 43_900_000 + int64(i), ModifiedAt: "2026-09-25T09:00:00Z", SHA256: "b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c"}}, nil)
	}
	job.finish(false, nil)
	return job.snapshot()
}
