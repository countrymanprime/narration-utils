package measure

import (
	"math"
	"testing"
)

func TestShortTermLoudnessOfASteadyToneIsThreeSecondWindowsEverySecond(t *testing.T) {
	// A 997 Hz sine at -20 dBFS peak, mono: BS.1770 reads -23.0 LUFS.
	result := diagnoseBytes(t, encodeFixture(t, sine(fixtureRate, 10, 997, -20, 0)), rawInput())

	if got := len(result.ShortTermLoudness); got != 8 {
		t.Fatalf("points = %d, want 8 over 10 s", got)
	}
	for i, point := range result.ShortTermLoudness {
		if point.StartSeconds != float64(i) || point.EndSeconds != float64(i)+3 {
			t.Fatalf("point %d spans %v-%v, want %d-%d", i, point.StartSeconds, point.EndSeconds, i, i+3)
		}
		within(t, "short-term loudness", point.LUFS, -23.0, 0.1)
	}
}

func TestShortTermLoudnessNeedsThreeSeconds(t *testing.T) {
	result := diagnoseBytes(t, encodeFixture(t, sine(fixtureRate, 2.9, 997, -20, 0)), rawInput())
	if len(result.ShortTermLoudness) != 0 {
		t.Fatalf("points = %+v, want none under 3 s", result.ShortTermLoudness)
	}
}

func TestClippingCeilingIsTheNarrators(t *testing.T) {
	// Peaks at -0.5 dBFS: under full scale, over a -1 dBFS ceiling.
	raw := encodeFixture(t, sine(fixtureRate, 1, 220, -0.5, 0))

	if result := diagnoseBytes(t, raw, rawInput()); result.Clipping.RegionCount != 0 {
		t.Fatalf("clipping at full scale = %+v, want none", result.Clipping)
	}
	in := rawInput()
	in.Options.ClipCeilingdBFS = -1
	result := diagnoseBytes(t, raw, in)
	if result.Clipping.RegionCount != 1 {
		t.Fatalf("clipping at -1 dBFS = %+v, want one region over the whole tone", result.Clipping)
	}
	if got := result.Findings()[0].Evidence["ceiling_dbfs"]; got != -1.0 {
		t.Fatalf("ceiling in evidence = %v, want -1", got)
	}
}

func TestClipRegionsJoinChannelsAndAreCapped(t *testing.T) {
	const rate = 8000
	const bursts = maxReportedClipRegions + 50
	left := make([]float64, bursts*rate/10)
	right := make([]float64, len(left))
	for b := 0; b < bursts; b++ {
		at := b * rate / 10 // a burst every 100 ms
		for i := 0; i < minClipRunSamples; i++ {
			left[at+i] = 1
			right[at+i+1] = -1 // the other channel, one sample later
		}
	}
	result := diagnoseBytes(t, encodeWAV(t, 2, rate, 16, false, interleave(left, right)), rawInput())

	if result.Clipping.RegionCount != bursts || len(result.Clipping.Regions) != maxReportedClipRegions {
		t.Fatalf("regions = %d listed of %d, want %d of %d", len(result.Clipping.Regions), result.Clipping.RegionCount, maxReportedClipRegions, bursts)
	}
	first := result.Clipping.Regions[0]
	if first.StartSeconds != 0 || first.EndSeconds != 4.0/rate || len(first.Channels) != 2 || first.LongestRunSamples != minClipRunSamples {
		t.Fatalf("first region = %+v, want both channels over samples 0-4", first)
	}
	if got := len(result.Findings()); got != maxReportedClipRegions {
		t.Fatalf("findings = %d, want one per listed region", got)
	}
}

func TestSilenceMapHonoursTheMinimumLength(t *testing.T) {
	tone := sine(fixtureRate, 1, 220, -14, 0)
	raw := encodeFixture(t, concat(tone, roomTone(fixtureRate, 0.2, -65, 12), tone))

	if result := diagnoseBytes(t, raw, rawInput()); len(result.Silences) != 0 {
		t.Fatalf("silences = %+v, want none shorter than the 0.3 s minimum", result.Silences)
	}
	in := rawInput()
	in.Options.MinSilenceSeconds = 0.1
	result := diagnoseBytes(t, raw, in)
	if len(result.Silences) != 1 {
		t.Fatalf("silences = %+v, want the 0.2 s gap", result.Silences)
	}
	within(t, "gap start", &result.Silences[0].StartSeconds, 1, 1e-9)
	within(t, "gap end", &result.Silences[0].EndSeconds, 1.2, 1e-9)
	within(t, "gap level", result.Silences[0].LeveldBFS, -65, 1)
}

func TestDigitalSilenceIsMappedButIsNotRoomTone(t *testing.T) {
	tone := sine(fixtureRate, 1, 220, -14, 0)
	raw := encodeFixture(t, concat(tone, silence(fixtureRate, 1), tone, roomTone(fixtureRate, 1, -65, 13), tone))
	result := diagnoseBytes(t, raw, rawInput())

	if len(result.Silences) != 2 {
		t.Fatalf("silences = %+v, want the digital gap and the room-tone gap", result.Silences)
	}
	digital := result.Silences[0]
	if !digital.DigitalSilence || digital.LeveldBFS != nil {
		t.Fatalf("digital gap = %+v, want digital silence with no level", digital)
	}
	if len(result.RoomTone) != 1 || result.RoomTone[0].Regions != 1 || result.RoomTone[0].StartSeconds != 3 {
		t.Fatalf("room tone = %+v, want one segment from the room-tone gap only", result.RoomTone)
	}
}

func TestLevelShiftStepIsTheNarrators(t *testing.T) {
	loud, _ := narration(0, readSpec{phrases: 10, peakDB: phrasePeakDB, toneDB: fixtureToneDB, seed: 14})
	softer, _ := narration(20, readSpec{phrases: 10, peakDB: phrasePeakDB - 3, toneDB: fixtureToneDB, seed: 15})
	raw := encodeFixture(t, concat(loud, softer))

	if result := diagnoseBytes(t, raw, rawInput()); len(result.LevelShifts) != 0 {
		t.Fatalf("a 3 LU drop under the default step raised %+v", result.LevelShifts)
	}
	in := rawInput()
	in.Options.LevelShiftLU = 2
	result := diagnoseBytes(t, raw, in)
	if len(result.LevelShifts) != 1 || math.Abs(result.LevelShifts[0].DeltaLU+3) > 1 {
		t.Fatalf("level shifts at a 2 LU step = %+v, want one of about -3 LU", result.LevelShifts)
	}
	if got := result.Findings()[0].Evidence["level_shift_lu"]; got != 2.0 {
		t.Fatalf("step in evidence = %v, want 2", got)
	}
}

func TestSilenceMapJudgesATrailingPartialWindowOnItsOwnLength(t *testing.T) {
	tone := sine(fixtureRate, 1, 220, -14, 0)
	raw := encodeFixture(t, concat(tone, roomTone(fixtureRate, 0.425, -65, 16))) // 8.5 windows of silence
	result := diagnoseBytes(t, raw, rawInput())

	if len(result.Silences) != 1 {
		t.Fatalf("silences = %+v, want the trailing room tone", result.Silences)
	}
	within(t, "trailing silence end", &result.Silences[0].EndSeconds, 1.425, 1e-9)
}
