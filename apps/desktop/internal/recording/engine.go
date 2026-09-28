// Package recording is the built-in recorder's host side (native-recording-suite PRD Phase 2, docs/adr/0455): the Booth's
// "Built-in recorder" picks an input device, meters it, records a take into the project's Recordings folder and lists the
// takes for playback. It records through Engine, a port over one capture port row (internal/captureport): the sidecar
// adapter (sidecar.go) runs that row in the teleprompter sidecar (`live_asr.py --record`, ADR 0357), and a test or the UI's
// mock stands in for it without hardware (D67). Nothing here knows about WASAPI: the row does.
//
// The rules the files keep (Q5, answered by D86):
//
//   - A take is written to "Take NNN.partial.wav" and, once the engine says it finished, moved to "Take NNN.wav" by a
//     hard link and the partial's removal, so the finished name only ever appears with a finished file and never replaces
//     one (os.Rename would, on Windows). A take whose engine died leaves its partial, which the list shows as unfinished:
//     the writer patches the header every second, so it plays up to the last second written.
//   - The service never overwrites, edits or deletes a take. The one file it removes is a partial the engine reported
//     holding no audio at all (0 frames), which is a header and nothing else.
//   - It reads and writes only the project's Recordings folder, and opens only the local device the narrator chose.
//     It sends nothing anywhere (D72).
package recording

import (
	"context"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
)

// Device is one input device the engine can open, by the name that opens it.
type Device struct {
	Name string `json:"name"`
}

// Level is one level report from the engine: dBFS, about ten a second while it meters or records.
type Level struct {
	Peak float64 `json:"peak"`
	RMS  float64 `json:"rms"`
}

// Result is what the engine reports when a take ends: the file it wrote and how the capture went.
type Result struct {
	SampleRate    int     `json:"sampleRate"`
	Channels      int     `json:"channels"`
	Bits          int     `json:"bits"`
	Frames        int64   `json:"frames"`
	Seconds       float64 `json:"seconds"`
	Overflows     int     `json:"overflows"`
	DroppedBlocks int     `json:"droppedBlocks"`
	DroppedFrames int64   `json:"droppedFrames"`
	Clipped       int64   `json:"clipped"`
	LatencyMs     float64 `json:"latencyMs"`
	// Error says why the take ended on its own (the device or the disk failed); the audio before it is kept.
	Error *string `json:"error"`
}

// Dropouts counts the blocks the engine lost or the recorder dropped.
func (r Result) Dropouts() int { return r.Overflows + r.DroppedBlocks }

// Events are the engine's reports for one run. Either may be nil. They are called from the engine's own goroutine.
type Events struct {
	Level func(Level)
	// Recorded is called at most once, when a take finishes, before its Run is Done.
	Recorded func(Result)
}

// Run is one running meter or take.
type Run interface {
	// Stop asks the run to end cleanly and returns at once; a take then finishes its file.
	Stop()
	// Kill ends it at once.
	Kill()
	// Done is closed once it has ended and released the device.
	Done() <-chan struct{}
	// Failure is why it ended by itself without finishing ("" when it was stopped, or finished): valid after Done.
	Failure() string
}

// Engine is the recorder's port: one capture row's devices, meter and take.
type Engine interface {
	// Backend is the capture port row it records through: its name and how far it is supported.
	Backend() captureport.Backend
	// Devices lists the input devices. A listing problem is the message, never the error: the error is a setup problem.
	Devices(ctx context.Context) ([]Device, string, error)
	// Meter reports device's level until stopped, writing nothing.
	Meter(device string, events Events) (Run, error)
	// Record records device into path, which must not exist yet, until stopped or until the device fails.
	Record(device, path string, events Events) (Run, error)
}
