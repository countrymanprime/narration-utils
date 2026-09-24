package measure

import (
	"math"
	"math/bits"
)

const (
	// clipMergeSeconds joins clip runs this close together, in any channel,
	// into one region: an overdriven passage clips at every crest, and the
	// narrator needs one place to listen, not one per crest.
	clipMergeSeconds = 0.05

	// maxReportedClipRegions caps the regions listed (and so the findings
	// raised). RegionCount still counts every region.
	maxReportedClipRegions = 200
)

// ClipRegion is a stretch of audio holding clip runs (minClipRunSamples or
// more consecutive samples at or above the ceiling in one channel), timed
// from the start of the measured audio. EndSeconds is just past the last
// clipped sample.
type ClipRegion struct {
	StartSeconds      float64 `json:"start_seconds"`
	EndSeconds        float64 `json:"end_seconds"`
	Channels          []int   `json:"channels"`
	LongestRunSamples int     `json:"longest_run_samples"`
}

// ClipDiagnostics lists the first maxReportedClipRegions regions in time
// order and counts them all. Zero is a measurement, never null.
type ClipDiagnostics struct {
	RegionCount int          `json:"region_count"`
	Regions     []ClipRegion `json:"regions"`
}

// clipSpan is a region in frames; channels is a bit per channel.
type clipSpan struct {
	start, end int64
	channels   uint64
	longest    int
}

// clipRegionMeter finds clip runs per channel, like clipMeter, but against
// the narrator's ceiling, and merges them into regions as they close.
type clipRegionMeter struct {
	rate        int
	level       float64
	mergeFrames int64

	frame     int64
	runStart  []int64
	runLength []int
	spans     []clipSpan // sorted by start, more than mergeFrames apart
}

func newClipRegionMeter(format Format, ceilingdBFS float64) *clipRegionMeter {
	level := fullScaleLevel(format)
	if ceilingdBFS < 0 {
		level = min(level, math.Pow(10, ceilingdBFS/20))
	}
	return &clipRegionMeter{
		rate:        format.SampleRate,
		level:       level,
		mergeFrames: int64(math.Round(clipMergeSeconds * float64(format.SampleRate))),
		runStart:    make([]int64, format.Channels),
		runLength:   make([]int, format.Channels),
	}
}

func (m *clipRegionMeter) Add(block [][]float64) {
	for i := range block[0] {
		for c := range block {
			if math.Abs(block[c][i]) >= m.level {
				if m.runLength[c] == 0 {
					m.runStart[c] = m.frame
				}
				m.runLength[c]++
				continue
			}
			m.closeRun(c)
		}
		m.frame++
	}
}

// Flush closes any run still open at the end of the audio.
func (m *clipRegionMeter) Flush() {
	for c := range m.runLength {
		m.closeRun(c)
	}
}

// closeRun turns a finished run into a region. A run closes at its end,
// which is at or after the end of every span already kept, but it may
// start before them (a long run in one channel while the other clipped
// briefly), so it absorbs every kept span it comes within mergeFrames of.
// Those form a suffix of the sorted list, so the list stays sorted and
// memory stays bounded by the audio's length over clipMergeSeconds.
func (m *clipRegionMeter) closeRun(channel int) {
	length := m.runLength[channel]
	m.runLength[channel] = 0
	if length < minClipRunSamples {
		return
	}
	span := clipSpan{start: m.runStart[channel], end: m.runStart[channel] + int64(length), channels: 1 << channel, longest: length}
	for len(m.spans) > 0 {
		last := m.spans[len(m.spans)-1]
		if span.start > last.end+m.mergeFrames {
			break
		}
		span = clipSpan{
			start:    min(span.start, last.start),
			end:      max(span.end, last.end),
			channels: span.channels | last.channels,
			longest:  max(span.longest, last.longest),
		}
		m.spans = m.spans[:len(m.spans)-1]
	}
	m.spans = append(m.spans, span)
}

func (m *clipRegionMeter) result() ClipDiagnostics {
	listed := m.spans[:min(len(m.spans), maxReportedClipRegions)]
	regions := make([]ClipRegion, len(listed))
	for i, span := range listed {
		regions[i] = ClipRegion{
			StartSeconds:      float64(span.start) / float64(m.rate),
			EndSeconds:        float64(span.end) / float64(m.rate),
			Channels:          channelList(span.channels),
			LongestRunSamples: span.longest,
		}
	}
	return ClipDiagnostics{RegionCount: len(m.spans), Regions: regions}
}

// channelList expands a channel bit set into ascending channel indexes.
func channelList(set uint64) []int {
	channels := make([]int, 0, bits.OnesCount64(set))
	for set != 0 {
		channel := bits.TrailingZeros64(set)
		channels = append(channels, channel)
		set &^= 1 << channel
	}
	return channels
}
