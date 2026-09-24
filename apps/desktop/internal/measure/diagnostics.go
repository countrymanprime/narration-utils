package measure

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
)

// Diagnostics are the windowed analyzers (diagnostics PRD, phase 4): clip
// regions (clipregions.go), a short-term loudness series with the level
// shifts it shows (shortterm.go), and a silence map with the room-tone
// segments it shows (silencemap.go), plus the pause profile when transcript
// timing exists. They read the audio once, never change it, and turn what
// they find into findings (diagnosticfindings.go) for the narrator to
// review: candidates against the narrator's own thresholds, never verdicts.

// SourceKind says what the measured audio is. Room tone and level mean
// different things for each: a raw recording's room tone is the room, a
// render's may have been reduced or gated on purpose.
type SourceKind string

const (
	SourceRawRecording    SourceKind = "raw_recording"
	SourceProcessedRender SourceKind = "processed_render"
)

func (k SourceKind) validate() error {
	if k != SourceRawRecording && k != SourceProcessedRender {
		return fmt.Errorf("source kind %q is not %q or %q", k, SourceRawRecording, SourceProcessedRender)
	}
	return nil
}

// label is the source kind in words, for a finding's reason.
func (k SourceKind) label() string {
	if k == SourceProcessedRender {
		return "processed render"
	}
	return "raw recording"
}

// DiagnosticOptions are the thresholds the analyzers use. Every one is
// reported with the findings it raises, so a narrator always sees what
// "clipped", "silent" or "a shift" meant.
type DiagnosticOptions struct {
	// ClipCeilingdBFS is the level at or above which a sample counts
	// towards clipping; 0 means the format's full scale.
	ClipCeilingdBFS float64 `json:"clip_ceiling_dbfs"`
	// SilenceFloordBFS is the RMS below which a 50 ms window is silent.
	SilenceFloordBFS float64 `json:"silence_floor_dbfs"`
	// MinSilenceSeconds is the shortest silence the map keeps.
	MinSilenceSeconds float64 `json:"min_silence_seconds"`
	// LevelShiftLU is the change in short-term loudness, between the read
	// before and after a point, that counts as a level shift.
	LevelShiftLU float64 `json:"level_shift_lu"`
	// RoomToneStepDB is the change in the level of the silences that
	// starts a new room-tone segment.
	RoomToneStepDB float64 `json:"room_tone_step_db"`
	// Pauses are the pause thresholds for transcript timing; zero means
	// DefaultPauseOptions.
	Pauses PauseOptions `json:"pauses"`
}

// DefaultDiagnosticOptions are starting thresholds for a narrator who has
// set none. They are not a delivery specification (ADR 0025): each is
// shown with its findings and can be changed.
func DefaultDiagnosticOptions() DiagnosticOptions {
	return DiagnosticOptions{
		ClipCeilingdBFS:   0,
		SilenceFloordBFS:  -50,
		MinSilenceSeconds: 0.3,
		LevelShiftLU:      4,
		RoomToneStepDB:    6,
		Pauses:            DefaultPauseOptions(),
	}
}

func (o DiagnosticOptions) resolve() (DiagnosticOptions, error) {
	pauses, err := o.Pauses.resolve()
	if err != nil {
		return DiagnosticOptions{}, err
	}
	o.Pauses = pauses
	switch {
	case !finite(o.ClipCeilingdBFS) || o.ClipCeilingdBFS > 0:
		return DiagnosticOptions{}, fmt.Errorf("clip ceiling %v dBFS must be finite and at most 0", o.ClipCeilingdBFS)
	case !finite(o.SilenceFloordBFS) || o.SilenceFloordBFS >= 0:
		return DiagnosticOptions{}, fmt.Errorf("silence floor %v dBFS must be finite and below 0", o.SilenceFloordBFS)
	case !finite(o.MinSilenceSeconds) || o.MinSilenceSeconds <= 0:
		return DiagnosticOptions{}, fmt.Errorf("minimum silence %v s must be finite and above 0", o.MinSilenceSeconds)
	case !finite(o.LevelShiftLU) || o.LevelShiftLU <= 0:
		return DiagnosticOptions{}, fmt.Errorf("level-shift step %v LU must be finite and above 0", o.LevelShiftLU)
	case !finite(o.RoomToneStepDB) || o.RoomToneStepDB <= 0:
		return DiagnosticOptions{}, fmt.Errorf("room-tone step %v dB must be finite and above 0", o.RoomToneStepDB)
	}
	return o, nil
}

// DiagnosticInput is what Diagnose needs besides the audio.
type DiagnosticInput struct {
	SourceKind SourceKind
	Options    DiagnosticOptions
	// Range limits the analysis to part of the file; nil is the whole file.
	// Times in the result are then from the range start, and findings add
	// the range start back so they are timed in the source file.
	Range *Range
	// Words is the transcript of the measured audio, timed from its start.
	// Nil means there is none, so pacing is unavailable.
	Words []Word
	// Progress, when set, is told the audio bytes read so far, as for
	// AnalyzeContext (ADR 0015).
	Progress Progress
}

// Diagnostics is what the windowed analyzers found in one file.
type Diagnostics struct {
	File            string            `json:"file,omitempty"`
	SourceKind      SourceKind        `json:"source_kind"`
	Options         DiagnosticOptions `json:"options"`
	Range           *Range            `json:"range,omitempty"`
	SampleRate      int               `json:"sample_rate"`
	Channels        int               `json:"channels"`
	DurationSeconds float64           `json:"duration_seconds"`

	Clipping          ClipDiagnostics   `json:"clipping"`
	ShortTermLoudness []LoudnessPoint   `json:"short_term_loudness"`
	LevelShifts       []LevelShift      `json:"level_shifts"`
	Silences          []SilenceRegion   `json:"silences"`
	RoomTone          []RoomToneSegment `json:"room_tone"`
	// Pacing is the pause profile from transcript timing, or why there is
	// none: no transcript, or timing that does not resolve against this
	// audio. It is never guessed from the silence map.
	Pacing PauseProfileEvidence `json:"pacing"`

	// words is how many timed words Pacing was profiled from (0 when it is
	// unavailable), for the summary's speaking rate.
	words int
}

// Diagnose runs the windowed analyzers over WAV audio read from r. It
// checks ctx between blocks and returns ctx's error once it is done.
func Diagnose(ctx context.Context, r io.Reader, in DiagnosticInput) (Diagnostics, error) {
	return diagnose(ctx, r, in, -1)
}

// diagnose is Diagnose given the length of r when it is known (a file),
// which bounds the progress total of a data chunk whose size was never
// recorded.
func diagnose(ctx context.Context, r io.Reader, in DiagnosticInput, streamBytes int64) (Diagnostics, error) {
	if err := in.SourceKind.validate(); err != nil {
		return Diagnostics{}, err
	}
	opts, err := in.Options.resolve()
	if err != nil {
		return Diagnostics{}, err
	}
	if in.Range != nil {
		if err := in.Range.validate(); err != nil {
			return Diagnostics{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		return Diagnostics{}, err
	}
	reader, err := NewWAVReader(r)
	if err != nil {
		return Diagnostics{}, err
	}

	first, limit := int64(0), int64(math.MaxInt64)
	if in.Range != nil {
		first, limit = in.Range.frames(reader.Format().SampleRate)
	}
	meter := progressMeter{reader: reader, report: in.Progress, total: reader.bytesToRead(first, limit, streamBytes)}
	if err := skipFrames(ctx, reader, first, &meter); err != nil {
		return Diagnostics{}, err
	}
	meters := newDiagnosticMeters(reader.Format(), opts)
	if err := meters.readAll(ctx, reader, limit, &meter); err != nil {
		return Diagnostics{}, err
	}
	meter.finish()

	result := meters.result()
	result.SourceKind, result.Options = in.SourceKind, opts
	if in.Range != nil {
		rng := *in.Range
		result.Range = &rng
	}
	result.Pacing = diagnosticPacing(in.Words, result.DurationSeconds, opts.Pauses)
	if result.Pacing.Status == StatusMeasured {
		result.words = len(in.Words)
	}
	return result, nil
}

// DiagnoseFile runs Diagnose over the WAV file at path, opened read-only,
// and records the path. An error names what was wrong, not the path: the
// caller already has it.
func DiagnoseFile(ctx context.Context, path string, in DiagnosticInput) (Diagnostics, error) {
	file, info, err := openForReading(path)
	if err != nil {
		return Diagnostics{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	result, err := diagnose(ctx, file, in, info.Size())
	if err != nil {
		return Diagnostics{}, err
	}
	result.File = path
	return result, nil
}

// diagnosticMeters runs every windowed analyzer over the same blocks.
type diagnosticMeters struct {
	format    Format
	opts      DiagnosticOptions
	clips     *clipRegionMeter
	shortTerm *shortTermMeter
	silences  *silenceMapper
	frames    int64
}

func newDiagnosticMeters(format Format, opts DiagnosticOptions) *diagnosticMeters {
	return &diagnosticMeters{
		format:    format,
		opts:      opts,
		clips:     newClipRegionMeter(format, opts.ClipCeilingdBFS),
		shortTerm: newShortTermMeter(format.SampleRate, format.Channels),
		silences:  newSilenceMapper(format, opts.SilenceFloordBFS, opts.MinSilenceSeconds),
	}
}

// readAll feeds up to limit frames from reader to every analyzer, telling
// meter after each block.
func (m *diagnosticMeters) readAll(ctx context.Context, reader *WAVReader, limit int64, meter *progressMeter) error {
	for m.frames < limit {
		if err := ctx.Err(); err != nil {
			return err
		}
		block, err := reader.Read(int(min(readBlockFrames, limit-m.frames)))
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		m.clips.Add(block)
		m.shortTerm.Add(block)
		m.silences.Add(block)
		m.frames += int64(len(block[0]))
		meter.tick()
	}
	return nil
}

func (m *diagnosticMeters) result() Diagnostics {
	m.clips.Flush()
	m.silences.Flush()
	return Diagnostics{
		SampleRate:        m.format.SampleRate,
		Channels:          m.format.Channels,
		DurationSeconds:   float64(m.frames) / float64(m.format.SampleRate),
		Clipping:          m.clips.result(),
		ShortTermLoudness: m.shortTerm.points,
		LevelShifts:       m.shortTerm.levelShifts(m.opts.LevelShiftLU),
		Silences:          m.silences.regions(),
		RoomTone:          m.silences.roomToneSegments(m.opts.RoomToneStepDB),
	}
}

// wordTimingTolerance absorbs ASR rounding of the last word's end.
const wordTimingTolerance = 0.05

// diagnosticPacing profiles the pauses between words, or says why it
// cannot: timing that is missing, malformed or longer than the audio does
// not belong to this audio, so no figure is produced from it.
func diagnosticPacing(words []Word, duration float64, opts PauseOptions) PauseProfileEvidence {
	evidence := PauseProfileEvidence{PauseOptions: opts}
	if words == nil {
		evidence.Evidence = unavailable("no transcript timing for this audio")
		return evidence
	}
	if err := validateWords(words); err != nil {
		evidence.Evidence = unavailable("transcript timing is unresolved: " + err.Error())
		return evidence
	}
	switch {
	case len(words) < 2:
		evidence.Evidence = unavailable("fewer than two timed words, so there is no silence between words to profile")
		return evidence
	case lastEnd(words) > duration+wordTimingTolerance:
		evidence.Evidence = unavailable(fmt.Sprintf("transcript timing runs past the end of the measured audio (%.2f s), so it is not this audio's transcript", duration))
		return evidence
	}
	summary := pauseProfile(words, duration, opts)
	evidence.Evidence, evidence.PauseSummary = measured, &summary
	return evidence
}
