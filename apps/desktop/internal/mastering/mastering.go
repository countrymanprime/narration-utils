// Package mastering is the built-in mastering chain (docs/prds/render-encode-master.prd.md Phase 3): a fixed EQ, then a
// limiter, then gain into the selected delivery profile's RMS window, ACX's own order. It runs only when the narrator
// asks (a caller's action, never on its own), and it writes a NEW WAV file: the source is opened read-only and never
// written, and a destination that is the source, or that already exists, is refused.
//
// The chain masters to the numbers internal/measure reports and internal/deliveryprofile judges (ADR 0320): RMS over
// every sample of every channel, silences included, and the sample peak over every channel. The written file is
// re-measured with internal/measure and judged against the profile, so the result says what the checker will say.
package mastering

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"

	"github.com/countrymanprime/narration-utils/shell/internal/deliveryprofile"
	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

const (
	// MaxGainDB bounds the gain stage: a recording that needs more than this is too quiet to master, and is brought up
	// only this far (its RMS then stays below the window, and the judgement says so).
	MaxGainDB = 30.0
	// toleranceDB is how close to the RMS target the gain is refined before the file is written.
	toleranceDB = 0.05
	// maxRefinePasses bounds the analysis passes that refine the gain once the limiter is in the chain.
	maxRefinePasses = 4
	// readFrames is how many frames each pass reads at a time.
	readFrames = 1 << 14
)

var (
	// ErrSameFile is a destination that is the source file (by path or as another name for it).
	ErrSameFile = errors.New("the mastered file would overwrite its source")
	// ErrDestinationExists is a destination that already exists: mastering never replaces a file.
	ErrDestinationExists = errors.New("the destination file already exists")
	// ErrSilent is a source with no signal to master.
	ErrSilent = errors.New("the source is silent: there is nothing to master")
)

// Request is one file to master: the WAV to read, the new WAV to write, and the delivery profile whose RMS window and
// peak limit it is mastered to.
type Request struct {
	Source      string
	Destination string
	Profile     deliveryprofile.Profile
}

// Progress is told how far the whole master has got, in a unit whose total is fixed for the run; done never goes back
// and reaches total when the master succeeds.
type Progress func(done, total int64)

// Options are what a master can be asked for beyond the request.
type Options struct {
	Progress Progress
}

// Result says what the chain did and how the written file measures.
type Result struct {
	Source      string  `json:"source"`
	Destination string  `json:"destination"`
	Profile     string  `json:"profile"`
	Targets     Targets `json:"targets"`
	// HighPassHz is the EQ's corner; GainDB the gain stage's setting. The limiter holds the peak at Targets.Ceiling.
	HighPassHz float64 `json:"highPassHz"`
	GainDB     float64 `json:"gainDb"`
	// Before measures the source, After the written file; Judgement is After against the profile's file rules.
	Before    measure.Report            `json:"before"`
	After     measure.Report            `json:"after"`
	Judgement deliveryprofile.Judgement `json:"judgement"`
}

// Master runs the chain on req.Source and writes req.Destination. It reads the source several times (measure it, find
// the gain, write) and never holds it in memory. The file appears at the destination only once it is complete; a
// failed or cancelled master leaves nothing there.
func Master(ctx context.Context, req Request, opts Options) (Result, error) {
	targets, err := TargetsFrom(req.Profile)
	if err != nil {
		return Result{}, err
	}
	source, dest, err := paths(req.Source, req.Destination)
	if err != nil {
		return Result{}, err
	}
	info, err := os.Stat(source)
	if err != nil {
		return Result{}, err
	}
	// Two measurements, one pass to find the gain before limiting, up to maxRefinePasses with the limiter, and the write.
	progress := newTracker(opts.Progress, info.Size(), 4+maxRefinePasses)
	m := &master{source: source, targets: targets, progress: progress}

	before, err := m.measure(ctx, source)
	if err != nil {
		return Result{}, err
	}
	if before.RMSdBFS == nil {
		return Result{}, ErrSilent
	}
	gain, err := m.findGain(ctx)
	if err != nil {
		return Result{}, err
	}
	after, err := m.write(ctx, dest, gain)
	if err != nil {
		return Result{}, err
	}
	progress.finish()
	after.File = dest
	before.File = source
	return Result{
		Source: source, Destination: dest, Profile: req.Profile.Key(), Targets: targets,
		HighPassHz: HighPassHz, GainDB: gain,
		Before: before, After: after, Judgement: deliveryprofile.EvaluateFile(after, req.Profile),
	}, nil
}

// paths cleans both paths and refuses a destination that is, or could be, the source.
func paths(source, dest string) (string, string, error) {
	source, err := filepath.Abs(source)
	if err != nil {
		return "", "", err
	}
	dest, err = filepath.Abs(dest)
	if err != nil {
		return "", "", err
	}
	if source == dest {
		return "", "", ErrSameFile
	}
	if err := checkDestination(source, dest); err != nil {
		return "", "", err
	}
	return source, dest, nil
}

// checkDestination refuses a destination that exists: the source under another name (a hard link, or another case
// on a case-insensitive disk), or any other file.
func checkDestination(source, dest string) error {
	destInfo, err := os.Lstat(dest)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if sourceInfo, err := os.Stat(source); err == nil && os.SameFile(sourceInfo, destInfo) {
		return ErrSameFile
	}
	if target, err := os.Stat(dest); err == nil {
		if sourceInfo, err := os.Stat(source); err == nil && os.SameFile(sourceInfo, target) {
			return ErrSameFile // a symbolic link to the source
		}
	}
	return fmt.Errorf("%s: %w", dest, ErrDestinationExists)
}

type master struct {
	source   string
	targets  Targets
	progress *tracker
	format   measure.Format
}

// measure runs internal/measure over a file, as one pass of the progress.
func (m *master) measure(ctx context.Context, path string) (measure.Report, error) {
	file, err := os.Open(path) // read-only
	if err != nil {
		return measure.Report{}, err
	}
	defer func() { _ = file.Close() }()
	pass := m.progress.pass()
	report, err := measure.AnalyzeContext(ctx, file, measure.Options{Progress: func(done, total int64) {
		if total > 0 {
			pass(done * m.progress.unit / total)
		}
	}})
	if err != nil {
		return measure.Report{}, fmt.Errorf("%s: %w", path, err)
	}
	return report, nil
}

// findGain finds the gain that brings the limited audio to the RMS target. The EQ alone gives a first estimate; each
// pass with the limiter then corrects it by the RMS it missed by. Turning the gain up lowers the limiter's threshold
// (it limits before the gain, at the ceiling less the gain), so the limited RMS rises by at most the gain step: the
// correction never overshoots and converges from below.
func (m *master) findGain(ctx context.Context) (float64, error) {
	rms, err := m.analyse(ctx, math.Inf(1), 0)
	if err != nil {
		return 0, err
	}
	gain := clampGain(m.targets.RMS - rms)
	for range maxRefinePasses {
		rms, err := m.analyse(ctx, m.threshold(gain), gain)
		if err != nil {
			return 0, err
		}
		miss := m.targets.RMS - rms
		if math.Abs(miss) <= toleranceDB || clampGain(gain+miss) == gain {
			break
		}
		gain = clampGain(gain + miss)
	}
	return gain, nil
}

// threshold is where the limiter holds the audio before a gain of gain dB, so the peak after the gain is the ceiling.
func (m *master) threshold(gain float64) float64 {
	return math.Pow(10, (m.targets.Ceiling-gain)/20)
}

func clampGain(db float64) float64 { return math.Min(MaxGainDB, db) }

// analyse runs the chain without writing and answers the RMS of what it would write, in dBFS.
func (m *master) analyse(ctx context.Context, threshold, gain float64) (float64, error) {
	var energy float64
	var samples int64
	err := m.run(ctx, threshold, gain, func(block [][]float64) error {
		for _, channel := range block {
			for _, s := range channel {
				energy += s * s
			}
			samples += int64(len(channel))
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if energy == 0 || samples == 0 {
		return 0, ErrSilent
	}
	return 10 * math.Log10(energy/float64(samples)), nil
}

// write runs the chain into a temporary file beside the destination, measures it, and moves it into place.
func (m *master) write(ctx context.Context, dest string, gain float64) (report measure.Report, err error) {
	temp, err := os.CreateTemp(filepath.Dir(dest), ".mastering-*.wav")
	if err != nil {
		return measure.Report{}, err
	}
	tempPath := temp.Name()
	defer func() {
		if temp != nil {
			_ = temp.Close()
		}
		if err != nil {
			_ = os.Remove(tempPath)
		}
	}()

	var writer *wavWriter
	err = m.run(ctx, m.threshold(gain), gain, func(block [][]float64) error {
		if writer == nil {
			w, err := newWAVWriter(temp, m.format)
			if err != nil {
				return err
			}
			writer = w
		}
		return writer.write(block)
	})
	if err != nil {
		return measure.Report{}, err
	}
	if writer == nil {
		return measure.Report{}, ErrSilent
	}
	if err := writer.close(); err != nil {
		return measure.Report{}, err
	}
	if err := temp.Close(); err != nil {
		temp = nil
		return measure.Report{}, err
	}
	temp = nil

	report, err = m.measure(ctx, tempPath)
	if err != nil {
		return measure.Report{}, err
	}
	// The destination was free when the master began; refuse rather than replace a file that has appeared since.
	if err := checkDestination(m.source, dest); err != nil {
		return measure.Report{}, err
	}
	if err := os.Rename(tempPath, dest); err != nil {
		return measure.Report{}, err
	}
	return report, nil
}

// run reads the source once, read-only, through EQ, limiter and gain, and hands every block that comes out to sink.
func (m *master) run(ctx context.Context, threshold, gain float64, sink func([][]float64) error) error {
	file, err := os.Open(m.source) // read-only: the source is never written
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	reader, err := measure.NewWAVReader(file)
	if err != nil {
		return fmt.Errorf("%s: %w", m.source, err)
	}
	m.format = reader.Format()
	chain := []Stage{NewEQStage(m.format.SampleRate, m.format.Channels)}
	if !math.IsInf(threshold, 1) {
		chain = append(chain, NewLimiterStage(m.format.SampleRate, m.format.Channels, threshold))
	}
	chain = append(chain, NewGainStage(gain))

	pass := m.progress.pass()
	frameBytes := int64(m.format.Channels * m.format.BitsPerSample / 8)
	var read int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		block, err := reader.Read(readFrames)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("%s: %w", m.source, err)
		}
		read += int64(len(block[0]))
		if err := through(chain, 0, block, sink); err != nil {
			return err
		}
		pass(read * frameBytes)
	}
	for i, stage := range chain {
		if err := through(chain, i+1, stage.Flush(), sink); err != nil {
			return err
		}
	}
	return ctx.Err()
}

// through passes block through chain[from:] and on to sink.
func through(chain []Stage, from int, block [][]float64, sink func([][]float64) error) error {
	if len(block) == 0 || len(block[0]) == 0 {
		return nil
	}
	for _, stage := range chain[from:] {
		block = stage.Process(block)
		if len(block) == 0 || len(block[0]) == 0 {
			return nil
		}
	}
	return sink(block)
}

// tracker spreads the passes of one master over one progress total: each pass is worth unit (the source's size in
// bytes), and a pass that is skipped (the gain converged early) is counted as done when the next one starts.
type tracker struct {
	report Progress
	unit   int64
	total  int64
	next   int64
	last   int64
}

func newTracker(report Progress, unit int64, passes int) *tracker {
	unit = max(1, unit)
	return &tracker{report: report, unit: unit, total: unit * int64(passes)}
}

// pass starts the next pass and answers the function that reports how far into it the master is, in bytes.
func (t *tracker) pass() func(done int64) {
	start := t.next
	t.next = min(t.total, start+t.unit)
	return func(done int64) {
		t.tell(start + min(max(done, 0), t.unit))
	}
}

// finish reports the master complete, however many refining passes it skipped.
func (t *tracker) finish() { t.tell(t.total) }

func (t *tracker) tell(done int64) {
	if t.report == nil || done < t.last {
		return
	}
	t.last = done
	t.report(done, t.total)
}
