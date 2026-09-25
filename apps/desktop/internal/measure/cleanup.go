package measure

import (
	"fmt"
	"math"
	"slices"

	"github.com/countrymanprime/narration-utils/shell/internal/findings"
)

// The silence cleanup analyzer (diagnostics PRD, Phase 9): candidates for cutting from a read, each classed as
// silence (dead air past a hold at either side), a breath or a click, with a confidence and a split-plus-trim action
// that only runs once the narrator approves it. Silences are the silence map's regions (silencemap.go), so cleanup and
// the diagnostics agree on what is silent. Breaths and clicks come from 10 ms windows read in the same pass: a breath
// is a quiet, noise-like stretch (many zero crossings) well below the read's speech level and of breath length; a
// click is a burst of at most three windows standing high above the silence on both sides of it. The classes are
// heuristics: a soft consonant can look like a breath, and a long pause may be meant. Nothing here is a verdict,
// which is why every candidate waits for review.

const (
	// cleanupWindowSeconds is the resolution of the breath and click detectors.
	cleanupWindowSeconds = 0.01
	// maxClickWindows is the longest burst read as a click.
	maxClickWindows = 3
	// clickFlankWindows is how much silence a click must have on each side.
	clickFlankWindows = 5
	// breathZeroCrossings is the zero-crossing rate at or above which a quiet stretch is noise-like (breath), not a
	// voiced sound; confidentBreathZeroCrossings is where a breath is read with more confidence.
	breathZeroCrossings          = 0.2
	confidentBreathZeroCrossings = 0.3
	// speechPercentile is the percentile of the windows above the silence floor taken as the read's speech level.
	speechPercentile = 0.9
	// minSpeechWindows is how many windows above the floor a read needs before its speech level is trusted.
	minSpeechWindows = 50
	// longPauseSeconds is the silence past which a pause may well be meant (a scene break, a beat).
	longPauseSeconds = 2.0
	// marginalFloorDB is how close to the silence floor a silence's level must sit to be a marginal call.
	marginalFloorDB = 3.0
)

// CleanupOptions are the narrator's cleanup thresholds (the silence floor and minimum silence are DiagnosticOptions'):
// the hold kept at each side of a cut silence, the breath lengths, how far below the speech level a breath sits, and
// how far above the silence around it a click stands.
type CleanupOptions struct {
	PadSeconds          float64 `json:"pad_seconds"`
	MinBreathSeconds    float64 `json:"min_breath_seconds"`
	MaxBreathSeconds    float64 `json:"max_breath_seconds"`
	BreathBelowSpeechDB float64 `json:"breath_below_speech_db"`
	ClickAboveSilenceDB float64 `json:"click_above_silence_db"`
}

// DefaultCleanupOptions are starting values for a narrator who has set none; each is reported with the candidates it
// raised, and none is a delivery rule.
func DefaultCleanupOptions() CleanupOptions {
	return CleanupOptions{PadSeconds: 0.15, MinBreathSeconds: 0.12, MaxBreathSeconds: 0.9, BreathBelowSpeechDB: 12, ClickAboveSilenceDB: 30}
}

func (o CleanupOptions) resolve() (CleanupOptions, error) {
	if o == (CleanupOptions{}) {
		return DefaultCleanupOptions(), nil
	}
	switch {
	case !finite(o.PadSeconds) || o.PadSeconds < 0 || o.PadSeconds > 2:
		return CleanupOptions{}, fmt.Errorf("hold %v s must be from 0 to 2", o.PadSeconds)
	case !finite(o.MinBreathSeconds) || o.MinBreathSeconds <= 0:
		return CleanupOptions{}, fmt.Errorf("minimum breath %v s must be above 0", o.MinBreathSeconds)
	case !finite(o.MaxBreathSeconds) || o.MaxBreathSeconds < o.MinBreathSeconds || o.MaxBreathSeconds > 5:
		return CleanupOptions{}, fmt.Errorf("maximum breath %v s must be from the minimum to 5 s", o.MaxBreathSeconds)
	case !finite(o.BreathBelowSpeechDB) || o.BreathBelowSpeechDB <= 0:
		return CleanupOptions{}, fmt.Errorf("breath level %v dB below speech must be above 0", o.BreathBelowSpeechDB)
	case !finite(o.ClickAboveSilenceDB) || o.ClickAboveSilenceDB <= 0:
		return CleanupOptions{}, fmt.Errorf("click height %v dB above the silence must be above 0", o.ClickAboveSilenceDB)
	}
	return o, nil
}

// CleanupClass is what a candidate is taken to be.
type CleanupClass string

const (
	CleanupSilence CleanupClass = "silence"
	CleanupBreath  CleanupClass = "breath"
	CleanupClick   CleanupClass = "click"
)

// CleanupCandidate is one stretch that could be cut. Start and End bound what was found; CutStart and CutEnd what the
// split-plus-trim would remove (a silence keeps the hold at each side). LeveldBFS is the RMS of the stretch (nil for
// digital silence), PeakdBFS the loudest sample of a click, ZeroCrossing a breath's zero-crossing rate. Why says what
// made it this class and what makes it uncertain.
type CleanupCandidate struct {
	Class        CleanupClass `json:"class"`
	StartSeconds float64      `json:"start_seconds"`
	EndSeconds   float64      `json:"end_seconds"`
	CutStart     float64      `json:"cut_start_seconds"`
	CutEnd       float64      `json:"cut_end_seconds"`
	LeveldBFS    *float64     `json:"level_dbfs"`
	PeakdBFS     *float64     `json:"peak_dbfs,omitempty"`
	ZeroCrossing *float64     `json:"zero_crossing_rate,omitempty"`
	Confidence   float64      `json:"confidence"`
	Why          string       `json:"why"`
}

// CleanupDiagnostics is what the cleanup analyzer found: the candidates in time order, the thresholds, and the speech
// level breaths were judged against (nil when the read had too little above the floor to set one, and then no breath
// is looked for).
type CleanupDiagnostics struct {
	Options         CleanupOptions     `json:"options"`
	SpeechLeveldBFS *float64           `json:"speech_level_dbfs"`
	Candidates      []CleanupCandidate `json:"candidates"`
}

// cleanupWindow is one 10 ms window: its mean square over every channel, its loudest sample and the zero-crossing
// rate of its channel mix.
type cleanupWindow struct {
	meanSquare float64
	peak       float32
	crossings  float32
}

// cleanupMeter collects the 10 ms windows; the classes are decided once the read's speech level is known.
type cleanupMeter struct {
	rate, channels int
	windowFrames   int
	floorEnergy    float64

	filled    int
	energy    float64
	peak      float64
	crossings int
	lastSign  int
	windows   []cleanupWindow
}

func newCleanupMeter(format Format, floordBFS float64) *cleanupMeter {
	return &cleanupMeter{
		rate:         format.SampleRate,
		channels:     format.Channels,
		windowFrames: max(1, int(math.Round(cleanupWindowSeconds*float64(format.SampleRate)))),
		floorEnergy:  math.Pow(10, floordBFS/10),
	}
}

func (m *cleanupMeter) Add(block [][]float64) {
	for i := range block[0] {
		mix := 0.0
		for c := range block {
			s := block[c][i]
			m.energy += s * s
			m.peak = max(m.peak, math.Abs(s))
			mix += s
		}
		sign := 0
		switch {
		case mix > 0:
			sign = 1
		case mix < 0:
			sign = -1
		}
		if sign != 0 {
			if m.lastSign != 0 && sign != m.lastSign && m.filled > 0 {
				m.crossings++
			}
			m.lastSign = sign
		}
		m.filled++
		if m.filled == m.windowFrames {
			m.closeWindow()
		}
	}
}

// Flush closes a trailing partial window on its own length.
func (m *cleanupMeter) Flush() {
	if m.filled > 0 {
		m.closeWindow()
	}
}

func (m *cleanupMeter) closeWindow() {
	crossings := float32(0)
	if m.filled > 1 {
		crossings = float32(m.crossings) / float32(m.filled-1)
	}
	m.windows = append(m.windows, cleanupWindow{
		meanSquare: m.energy / float64(m.filled*m.channels),
		peak:       float32(m.peak),
		crossings:  crossings,
	})
	m.filled, m.energy, m.peak, m.crossings = 0, 0, 0, 0
}

func (m *cleanupMeter) seconds(window int) float64 {
	return float64(window*m.windowFrames) / float64(m.rate)
}

// end is the time a window ends, the last one at the end of the audio.
func (m *cleanupMeter) end(window int, duration float64) float64 {
	return min(m.seconds(window+1), duration)
}

func (m *cleanupMeter) silent(i int) bool {
	return i >= 0 && i < len(m.windows) && m.windows[i].meanSquare < m.floorEnergy
}

// speechLevel is the 90th percentile of the windows above the floor, in dBFS, or nil when too few are.
func (m *cleanupMeter) speechLevel() *float64 {
	levels := []float64{}
	for _, w := range m.windows {
		if w.meanSquare >= m.floorEnergy {
			levels = append(levels, w.meanSquare)
		}
	}
	if len(levels) < minSpeechWindows {
		return nil
	}
	slices.Sort(levels)
	return energyToDB(levels[int(math.Floor(speechPercentile*float64(len(levels)-1)))])
}

// result classes the read: the silence map's silences, then clicks and breaths from the windows, in time order.
func (m *cleanupMeter) result(silences []SilenceRegion, floordBFS, duration float64, opts CleanupOptions) CleanupDiagnostics {
	out := CleanupDiagnostics{Options: opts, SpeechLeveldBFS: m.speechLevel(), Candidates: []CleanupCandidate{}}
	for _, region := range silences {
		if candidate, ok := silenceCandidate(region, floordBFS, opts); ok {
			out.Candidates = append(out.Candidates, candidate)
		}
	}
	out.Candidates = append(out.Candidates, m.clicks(duration, opts)...)
	if out.SpeechLeveldBFS != nil {
		out.Candidates = append(out.Candidates, m.breaths(*out.SpeechLeveldBFS, duration, opts)...)
	}
	slices.SortStableFunc(out.Candidates, func(a, b CleanupCandidate) int {
		switch {
		case a.StartSeconds < b.StartSeconds:
			return -1
		case a.StartSeconds > b.StartSeconds:
			return 1
		}
		return 0
	})
	return out
}

// silenceCandidate offers the middle of a silence for cutting, keeping the hold at each side; a silence with nothing
// left once the holds are kept is not a candidate. A silence that runs long enough to be a meant pause, or whose level
// sits close to the floor, is a marginal call with less confidence; digital silence (a gate or an edit) is dead air.
func silenceCandidate(region SilenceRegion, floordBFS float64, opts CleanupOptions) (CleanupCandidate, bool) {
	cutStart, cutEnd := region.StartSeconds+opts.PadSeconds, region.EndSeconds-opts.PadSeconds
	if cutEnd-cutStart < cleanupWindowSeconds {
		return CleanupCandidate{}, false
	}
	length := region.EndSeconds - region.StartSeconds
	candidate := CleanupCandidate{
		Class: CleanupSilence, StartSeconds: region.StartSeconds, EndSeconds: region.EndSeconds,
		CutStart: cutStart, CutEnd: cutEnd, LeveldBFS: region.LeveldBFS,
		Confidence: 0.6, Why: fmt.Sprintf("%.2f s below the silence floor", length),
	}
	switch {
	case region.DigitalSilence:
		candidate.Confidence, candidate.Why = 0.8, candidate.Why+", all digital silence (a gate or an edit)"
	case length >= longPauseSeconds:
		candidate.Confidence, candidate.Why = 0.3, candidate.Why+"; a pause this long may be meant (a scene break or a beat)"
	case region.LeveldBFS != nil && *region.LeveldBFS > floordBFS-marginalFloorDB:
		candidate.Confidence = 0.3
		candidate.Why += fmt.Sprintf("; its level is within %.0f dB of the floor, so it is a marginal call", marginalFloorDB)
	}
	return candidate, true
}

// clicks finds bursts of at most maxClickWindows windows above the floor with at least clickFlankWindows silent
// windows on each side, whose peak stands ClickAboveSilenceDB or more above the silence around them. A plosive or a
// word's onset has speech beside it, so it has no silent flank and is never a click.
func (m *cleanupMeter) clicks(duration float64, opts CleanupOptions) []CleanupCandidate {
	out := []CleanupCandidate{}
	for i := 0; i < len(m.windows); i++ {
		if m.silent(i) || !m.silent(i-1) {
			continue
		}
		end := i
		for end < len(m.windows) && !m.silent(end) && end-i <= maxClickWindows {
			end++
		}
		candidate, ok := m.click(i, end, duration, opts)
		if ok {
			out = append(out, candidate)
		}
		i = end
	}
	return out
}

// click judges the burst of windows [first, end) as a click.
func (m *cleanupMeter) click(first, end int, duration float64, opts CleanupOptions) (CleanupCandidate, bool) {
	if end-first > maxClickWindows {
		return CleanupCandidate{}, false
	}
	var around float64
	for k := 1; k <= clickFlankWindows; k++ {
		if !m.silent(first-k) || !m.silent(end-1+k) {
			return CleanupCandidate{}, false
		}
		around += m.windows[first-k].meanSquare + m.windows[end-1+k].meanSquare
	}
	var peak, energy float64
	for k := first; k < end; k++ {
		peak = max(peak, float64(m.windows[k].peak))
		energy += m.windows[k].meanSquare
	}
	peakdB := ampToDB(peak)
	if silence := energyToDB(around / (2 * clickFlankWindows)); peakdB == nil || (silence != nil && *peakdB-*silence < opts.ClickAboveSilenceDB) {
		return CleanupCandidate{}, false
	}
	start, stop := m.seconds(first), m.end(end-1, duration)
	return CleanupCandidate{
		Class: CleanupClick, StartSeconds: start, EndSeconds: stop,
		CutStart: max(0, start-cleanupWindowSeconds/2), CutEnd: min(duration, stop+cleanupWindowSeconds/2),
		LeveldBFS: energyToDB(energy / float64(end-first)), PeakdBFS: peakdB, Confidence: 0.6,
		Why: fmt.Sprintf("a burst of %.0f ms with silence on both sides", (stop-start)*1000),
	}, true
}

// breaths finds runs of windows above the floor but BreathBelowSpeechDB or more below the speech level, of breath
// length, whose zero-crossing rate says noise rather than a voiced sound. A soft fricative ("s", "f") is noise-like
// too, so a breath is never more than a middling call.
func (m *cleanupMeter) breaths(speechdBFS, duration float64, opts CleanupOptions) []CleanupCandidate {
	ceiling := math.Pow(10, (speechdBFS-opts.BreathBelowSpeechDB)/10)
	quiet := func(i int) bool {
		w := m.windows[i].meanSquare
		return w >= m.floorEnergy && w < ceiling
	}
	out := []CleanupCandidate{}
	for i := 0; i < len(m.windows); {
		if !quiet(i) {
			i++
			continue
		}
		end := i
		var energy, crossings float64
		for end < len(m.windows) && quiet(end) {
			energy += m.windows[end].meanSquare
			crossings += float64(m.windows[end].crossings)
			end++
		}
		start, stop := m.seconds(i), m.end(end-1, duration)
		windows := float64(end - i)
		rate := crossings / windows
		if length := stop - start; length >= opts.MinBreathSeconds && length <= opts.MaxBreathSeconds && rate >= breathZeroCrossings {
			confidence, why := 0.35, "quiet and noise-like, of breath length; a soft consonant looks the same"
			if rate >= confidentBreathZeroCrossings {
				confidence, why = 0.5, "quiet and strongly noise-like, of breath length"
			}
			level := energyToDB(energy / windows)
			out = append(out, CleanupCandidate{
				Class: CleanupBreath, StartSeconds: start, EndSeconds: stop, CutStart: start, CutEnd: stop,
				LeveldBFS: level, ZeroCrossing: &rate, Confidence: confidence,
				Why: fmt.Sprintf("%s, %.0f dB below the speech level", why, speechdBFS-*level),
			})
		}
		i = end
	}
	return out
}

// kindCleanup is the kind of a silence_cleanup finding, in evidence["kind"].
const kindCleanup = "silence_cleanup"

// CleanupFindings turns the cleanup candidates into silence_cleanup findings: information for review, each with its
// class, level, confidence, the thresholds that raised it and a split-plus-trim action that needs confirmation. They
// are apart from Findings, so a caller lists them only where the narrator asked for cleanup.
func (d Diagnostics) CleanupFindings() []findings.Finding {
	out := []findings.Finding{}
	offset := 0.0
	if d.Range != nil {
		offset = d.Range.StartSeconds
	}
	for _, candidate := range d.Cleanup.Candidates {
		evidence := d.evidence(kindCleanup)
		evidence["class"] = candidate.Class
		evidence["duration_seconds"] = candidate.EndSeconds - candidate.StartSeconds
		evidence["level_dbfs"] = candidate.LeveldBFS
		if candidate.PeakdBFS != nil {
			evidence["peak_dbfs"] = *candidate.PeakdBFS
		}
		if candidate.ZeroCrossing != nil {
			evidence["zero_crossing_rate"] = *candidate.ZeroCrossing
		}
		if d.Cleanup.SpeechLeveldBFS != nil {
			evidence["speech_level_dbfs"] = *d.Cleanup.SpeechLeveldBFS
		}
		evidence["silence_floor_dbfs"] = d.Options.SilenceFloordBFS
		evidence["min_silence_seconds"] = d.Options.MinSilenceSeconds
		evidence["pad_seconds"] = d.Cleanup.Options.PadSeconds
		evidence["min_breath_seconds"] = d.Cleanup.Options.MinBreathSeconds
		evidence["max_breath_seconds"] = d.Cleanup.Options.MaxBreathSeconds
		evidence["breath_below_speech_db"] = d.Cleanup.Options.BreathBelowSpeechDB
		evidence["click_above_silence_db"] = d.Cleanup.Options.ClickAboveSilenceDB
		confidence := candidate.Confidence
		reason := fmt.Sprintf("a %s candidate: %s, in a %s; it is cut only once you approve it", candidate.Class, candidate.Why, d.SourceKind.label())
		finding := d.newFinding(kindCleanup+"_"+string(candidate.Class), findings.CategorySilenceCleanup, findings.SeverityInfo,
			candidate.StartSeconds, candidate.EndSeconds, &confidence, reason, evidence)
		finding.SuggestedAction = &findings.SuggestedAction{
			Kind: "split_and_trim",
			Parameters: map[string]any{
				"class": candidate.Class, "cut_start_seconds": offset + candidate.CutStart, "cut_end_seconds": offset + candidate.CutEnd,
			},
			RequiresConfirmation: true,
		}
		out = append(out, finding)
	}
	return out
}
