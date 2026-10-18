package teleprompter

import (
	"encoding/json"
	"math"
	"time"
)

// traceEvery is how often a running session writes one summary of what its microphone delivered.
const traceEvery = 5 * time.Second

// inputTrace counts what reached the host since the last summary: whether the microphone sends sound at all (the level events'
// loudest peak, in dB) and whether the engine heard words from it. It holds numbers only, never the words.
type inputTrace struct {
	levels, words, partials int
	peakMax                 float64
	since                   time.Time
}

// SetTrace gives the service a place to write one summary line every few seconds of a live session (event name and attributes).
// It is optional; without it nothing is summarised.
func (s *Service) SetTrace(trace func(event string, attrs ...any)) {
	s.mu.Lock()
	s.trace = trace
	s.mu.Unlock()
}

// traceLine folds one sidecar event into the running summary and, when a period has passed, writes it and starts the next.
func (s *Service) traceLine(kind string, raw json.RawMessage) {
	s.mu.Lock()
	trace, now := s.trace, s.clock()
	if trace == nil {
		s.mu.Unlock()
		return
	}
	in := &s.input
	if in.since.IsZero() {
		in.since, in.peakMax = now, math.Inf(-1)
	}
	switch kind {
	case "level":
		in.levels++
		var level struct {
			Peak float64 `json:"peak"`
		}
		if json.Unmarshal(raw, &level) == nil && level.Peak > in.peakMax {
			in.peakMax = level.Peak
		}
	case "word":
		in.words++
	case "partial":
		in.partials++
	}
	if now.Sub(in.since) < traceEvery {
		s.mu.Unlock()
		return
	}
	summary := *in
	*in = inputTrace{}
	s.mu.Unlock()
	peak := summary.peakMax
	if math.IsInf(peak, -1) {
		peak = -120
	}
	trace("teleprompter.input", "seconds", int(now.Sub(summary.since).Seconds()), "levels", summary.levels, "peak_db", math.Round(peak*10)/10, "words", summary.words, "partials", summary.partials)
}

func (s *Service) clock() time.Time {
	if s.traceNow != nil {
		return s.traceNow()
	}
	return time.Now()
}
