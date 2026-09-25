package measure

import "testing"

func TestAnalyzeTimesTheRoomToneAtEachEdge(t *testing.T) {
	const rate = 44100
	for _, head := range []float64{0.3, 0.7, 1.2, 6} {
		mono := concat(roomTone(rate, head, -65, 7), sine(rate, 2, 440, -12, 0), roomTone(rate, 1.5, -65, 7))
		report := analyzeBytes(t, encodeWAV(t, 1, rate, 24, false, mono))

		within(t, "head room tone", report.HeadRoomToneSeconds, head, silenceWindowSeconds)
		within(t, "tail room tone", report.TailRoomToneSeconds, 1.5, silenceWindowSeconds)
		within(t, "head digital silence", report.HeadDigitalSilenceSeconds, 0, 1e-9)
		within(t, "tail digital silence", report.TailDigitalSilenceSeconds, 0, 1e-9)
	}
}

func TestAnalyzeCountsDigitalSilenceAtTheEdges(t *testing.T) {
	const rate = 44100
	// Half a second of exact zeros, then room tone, speech, and a gated (all-zero) tail.
	mono := concat(silence(rate, 0.5), roomTone(rate, 0.5, -65, 7), sine(rate, 1, 440, -12, 0), silence(rate, 2))
	report := analyzeBytes(t, encodeWAV(t, 1, rate, 16, false, mono))

	within(t, "head room tone", report.HeadRoomToneSeconds, 1, silenceWindowSeconds)
	within(t, "head digital silence", report.HeadDigitalSilenceSeconds, 0.5, silenceWindowSeconds)
	within(t, "tail room tone", report.TailRoomToneSeconds, 2, silenceWindowSeconds)
	within(t, "tail digital silence", report.TailDigitalSilenceSeconds, 2, silenceWindowSeconds)
}

func TestAnalyzeEdgesOfAudioWithNoSpeechAreNotMeasurable(t *testing.T) {
	const rate = 44100
	for name, mono := range map[string][]float64{
		"room tone only":  roomTone(rate, 3, -65, 7),
		"digital silence": silence(rate, 3),
	} {
		report := analyzeBytes(t, encodeWAV(t, 1, rate, 16, false, mono))
		for label, value := range map[string]*float64{
			"head": report.HeadRoomToneSeconds, "tail": report.TailRoomToneSeconds,
			"head zeros": report.HeadDigitalSilenceSeconds, "tail zeros": report.TailDigitalSilenceSeconds,
		} {
			if value != nil {
				t.Errorf("%s: %s = %v, want null (no speech to measure from)", name, label, *value)
			}
		}
	}
}

func TestAnalyzeSpeechFromTheFirstSampleHasNoHeadRoomTone(t *testing.T) {
	const rate = 44100
	mono := concat(sine(rate, 1, 440, -12, 0), roomTone(rate, 1, -65, 7))
	report := analyzeBytes(t, encodeWAV(t, 2, rate, 32, true, stereo(mono)))

	within(t, "head room tone", report.HeadRoomToneSeconds, 0, 1e-9)
	within(t, "tail room tone", report.TailRoomToneSeconds, 1, silenceWindowSeconds)
}
