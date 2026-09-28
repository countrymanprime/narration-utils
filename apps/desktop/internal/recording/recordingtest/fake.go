// Package recordingtest is a fake recording.Engine for tests (D67): no sidecar and no device. A take writes a real 24-bit
// PCM WAV of silence at 48 kHz mono to the path it is given, the way the sidecar's writer does (refusing a path that
// exists), and reports the Result the test scripted.
package recordingtest

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"sync"

	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/recording"
)

// Backend is a capture row stand-in: wasapi, Experimental.
type Backend struct{}

func (Backend) Name() string      { return captureport.WASAPI }
func (Backend) Level() port.Level { return port.Experimental }

// Fake is a scripted engine. Set its fields before use.
type Fake struct {
	mu sync.Mutex
	// DeviceList and DeviceMessage are what Devices answers.
	DeviceList    []recording.Device
	DeviceMessage string
	// Frames is how many frames a take writes when stopped (default 48000, one second).
	// +checklocks:mu
	Frames int64
	// FailWith ends a take by itself right after it starts, with this sentence as the result's error; the frames are
	// still written.
	// +checklocks:mu
	FailWith string
	// CrashWith ends a take with no result at all (the engine died), with this failure; it writes Frames first.
	// +checklocks:mu
	CrashWith string
	// OpenError refuses to start.
	// +checklocks:mu
	OpenError error
	// Levels are reported once each when a run starts.
	// +checklocks:mu
	Levels []recording.Level
	// Runs are the runs started, in order.
	// +checklocks:mu
	Runs []*FakeRun
}

// FakeRun is one run of a Fake.
type FakeRun struct {
	Kind    string // "meter" or "take"
	Device  string
	Path    string
	fake    *Fake
	events  recording.Events
	once    sync.Once
	done    chan struct{}
	failure string
	Killed  bool
}

func (f *Fake) Backend() captureport.Backend { return Backend{} }

func (f *Fake) Devices(context.Context) ([]recording.Device, string, error) {
	return f.DeviceList, f.DeviceMessage, nil
}

func (f *Fake) Meter(device string, events recording.Events) (recording.Run, error) {
	return f.start("meter", device, "", events)
}

func (f *Fake) Record(device, path string, events recording.Events) (recording.Run, error) {
	return f.start("take", device, path, events)
}

func (f *Fake) start(kind, device, path string, events recording.Events) (recording.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.OpenError != nil {
		return nil, f.OpenError
	}
	if path != "" {
		if _, err := os.Lstat(path); err == nil {
			return nil, errors.New("a take is already saved there")
		}
		if err := WriteWav(path, 0); err != nil {
			return nil, err
		}
	}
	run := &FakeRun{Kind: kind, Device: device, Path: path, fake: f, events: events, done: make(chan struct{})}
	f.Runs = append(f.Runs, run)
	for _, level := range f.Levels {
		if events.Level != nil {
			events.Level(level)
		}
	}
	switch {
	case kind == "take" && f.FailWith != "":
		failure := f.FailWith
		go run.end(&failure, "")
	case kind == "take" && f.CrashWith != "":
		go run.end(nil, f.CrashWith)
	}
	return run, nil
}

// Last is the most recent run, or nil.
func (f *Fake) Last() *FakeRun {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.Runs) == 0 {
		return nil
	}
	return f.Runs[len(f.Runs)-1]
}

func (f *Fake) frames() int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Frames == 0 {
		return 48000
	}
	return f.Frames
}

// end finishes the run: a take writes its frames and, unless crashed, reports its result.
func (r *FakeRun) end(resultError *string, crash string) {
	r.once.Do(func() {
		if r.Kind == "take" {
			frames := r.fake.frames()
			if frames < 0 {
				frames = 0
			}
			_ = os.Remove(r.Path)
			_ = WriteWav(r.Path, frames)
			if crash == "" && r.events.Recorded != nil {
				r.events.Recorded(recording.Result{
					SampleRate: 48000, Channels: 1, Bits: 24, Frames: frames, Seconds: float64(frames) / 48000,
					LatencyMs: 10, Error: resultError,
				})
			}
		}
		r.failure = crash
		close(r.done)
	})
}

func (r *FakeRun) Stop()                 { go r.end(nil, "") }
func (r *FakeRun) Kill()                 { r.Killed = true; go r.end(nil, "") }
func (r *FakeRun) Done() <-chan struct{} { return r.done }
func (r *FakeRun) Failure() string       { <-r.done; return r.failure }

// WriteWav writes a 24-bit PCM mono 48 kHz WAV of frames silent frames to path, refusing a path that exists.
func WriteWav(path string, frames int64) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	frames = min(max(frames, 0), 1<<20) // a test's take: never near the RIFF limit
	data := uint32(frames * 3)          //nolint:gosec // bounded just above
	header := make([]byte, 44)
	copy(header[0:], "RIFF")
	binary.LittleEndian.PutUint32(header[4:], 36+data)
	copy(header[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(header[16:], 16)
	binary.LittleEndian.PutUint16(header[20:], 1)
	binary.LittleEndian.PutUint16(header[22:], 1)
	binary.LittleEndian.PutUint32(header[24:], 48000)
	binary.LittleEndian.PutUint32(header[28:], 48000*3)
	binary.LittleEndian.PutUint16(header[32:], 3)
	binary.LittleEndian.PutUint16(header[34:], 24)
	copy(header[36:], "data")
	binary.LittleEndian.PutUint32(header[40:], data)
	if _, err := file.Write(append(header, make([]byte, data)...)); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}
