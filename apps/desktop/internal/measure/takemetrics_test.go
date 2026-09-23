package measure

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/tracks"
)

const takeRate = 8000

// takeSource writes a 6 s mono WAV: 1 s of -60 dBFS RMS room tone, 4 s of a
// -18 dBFS peak read, 1 s of room tone again.
func takeSource(t *testing.T) string {
	t.Helper()
	roomPeak := -60 + 20*math.Log10(math.Sqrt2)
	mono := concat(
		sine(takeRate, 1, 1000, roomPeak, 0),
		fadeInOut(sine(takeRate, 4, 997, -18, 0), 80),
		sine(takeRate, 1, 1000, roomPeak, 0),
	)
	path := filepath.Join(t.TempDir(), "read.wav")
	if err := os.WriteFile(path, encodeWAV(t, 1, takeRate, 16, false, mono), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// wavTake is an item with one WAV take playing [0.5, 5.5) of its source:
// half a second of room tone either side of the read.
func wavTake(path string) tracks.Item {
	return tracks.Item{
		Length: 5,
		Takes: []tracks.Take{{
			GUID: "{TAKE-A}", SourceKind: "WAVE", SourceFile: path,
			SourceAvailable: true, Supported: true, SOFFS: 0.5, PlayRate: 1,
		}},
	}
}

func lufs(v float64) *float64 { return &v }

// takeWords are take-relative word timings: gaps of 0.1, 1.0 and 0.1 s.
func takeWords() []Word {
	return []Word{
		{Text: "It", StartSeconds: 0.5, EndSeconds: 1.0},
		{Text: "was", StartSeconds: 1.1, EndSeconds: 1.6},
		{Text: "a", StartSeconds: 2.6, EndSeconds: 3.0},
		{Text: "night", StartSeconds: 3.1, EndSeconds: 4.5},
	}
}

func fullInput(path string) TakeInput {
	return TakeInput{
		Item:  wavTake(path),
		Words: takeWords(),
		Neighbors: []NeighborLevel{
			{ItemGUID: "{N1}", IntegratedLUFS: lufs(-20)},
			{ItemGUID: "{N2}", IntegratedLUFS: lufs(-22)},
			{ItemGUID: "{N3}"},
			{ItemGUID: "{N4}", IntegratedLUFS: lufs(-30)},
		},
		Pauses: PauseOptions{MinPauseSeconds: 0.3, LongPauseSeconds: 0.8},
	}
}

func measureTake(t *testing.T, in TakeInput) TakeMetrics {
	t.Helper()
	metrics, err := MeasureTake(in)
	if err != nil {
		t.Fatalf("MeasureTake: %v", err)
	}
	return metrics
}

func wantMeasured(t *testing.T, name string, e Evidence) {
	t.Helper()
	if e.Status != StatusMeasured || e.Reason != "" {
		t.Fatalf("%s = %+v, want measured with no reason", name, e)
	}
}

func wantUnavailable(t *testing.T, name string, e Evidence, reasonPart string) {
	t.Helper()
	if e.Status != StatusUnavailable || !strings.Contains(e.Reason, reasonPart) {
		t.Fatalf("%s = %+v, want unavailable mentioning %q", name, e, reasonPart)
	}
}

func TestMeasureTakeReportsEveryCategoryForAWAVTakeWithATranscript(t *testing.T) {
	metrics := measureTake(t, fullInput(takeSource(t)))

	if metrics.TakeGUID != "{TAKE-A}" || metrics.Source == nil || metrics.Source.Range != (Range{StartSeconds: 0.5, LengthSeconds: 5}) {
		t.Fatalf("identity/source = %q %+v", metrics.TakeGUID, metrics.Source)
	}
	if metrics.Audio == nil || math.Abs(metrics.Audio.DurationSeconds-5) > 1e-9 {
		t.Fatalf("audio report = %+v, want 5 s measured", metrics.Audio)
	}

	wantMeasured(t, "clipping", metrics.Clipping.Evidence)
	if metrics.Clipping.ClipRunCount == nil || *metrics.Clipping.ClipRunCount != 0 || len(metrics.Clipping.ClipRuns) != 0 {
		t.Fatalf("clipping = %+v, want none", metrics.Clipping)
	}

	wantMeasured(t, "noise", metrics.Noise.Evidence)
	within(t, "noise floor", metrics.Noise.NoiseFloordBFS, -60, 0.1)

	wantMeasured(t, "level consistency", metrics.LevelConsistency.Evidence)
	level := metrics.LevelConsistency
	// A mono -18 dBFS peak sine reads about -21 LUFS; the 400 ms blocks that
	// straddle the read and the room tone pass the relative gate and pull
	// it slightly lower. The figure must be the stored measurement itself.
	within(t, "take LUFS", level.IntegratedLUFS, -21, 0.5)
	if level.IntegratedLUFS != metrics.Audio.IntegratedLUFS {
		t.Fatal("level evidence must reuse the audio report's own loudness, so it reproduces from it")
	}
	within(t, "neighbour median", level.NeighborMedianLUFS, -22, 0)
	within(t, "delta", level.DeltaLU, *level.IntegratedLUFS+22, 1e-12)
	if level.NeighborsMeasured != 3 || level.NeighborsUnavailable != 1 {
		t.Fatalf("neighbours = %d measured / %d unavailable, want 3 / 1", level.NeighborsMeasured, level.NeighborsUnavailable)
	}

	wantMeasured(t, "duration", metrics.Duration.Evidence)
	duration := metrics.Duration
	if duration.ItemSeconds == nil || *duration.ItemSeconds != 5 || duration.SourceSeconds == nil || *duration.SourceSeconds != 5 {
		t.Fatalf("duration = %+v", duration)
	}
	within(t, "audio seconds", duration.AudioSeconds, 5, 1e-9)
	within(t, "speech seconds", duration.SpeechSeconds, 4, 1e-9)
	within(t, "words per minute", duration.WordsPerMinute, 60, 1e-9)

	wantMeasured(t, "pause profile", metrics.PauseProfile.Evidence)
	pauses := metrics.PauseProfile
	if pauses.Count != 1 || math.Abs(pauses.LongestSeconds-1) > 1e-9 || math.Abs(pauses.TotalSeconds-1) > 1e-9 {
		t.Fatalf("pauses = %+v, want the single 1 s gap", pauses)
	}
	if len(pauses.LongPauses) != 1 || math.Abs(pauses.LongPauses[0].StartSeconds-1.6) > 1e-9 {
		t.Fatalf("long pauses = %+v, want the gap at 1.6 s", pauses.LongPauses)
	}
	within(t, "leading", &pauses.LeadingSeconds, 0.5, 1e-9)
	within(t, "trailing", pauses.TrailingSeconds, 0.5, 1e-9)
	if pauses.MinPauseSeconds != 0.3 || pauses.LongPauseSeconds != 0.8 {
		t.Fatalf("thresholds = %v / %v, want the ones used, shown with the evidence", pauses.MinPauseSeconds, pauses.LongPauseSeconds)
	}

	if !reflect.DeepEqual(metrics.Coverage, Coverage{Measured: 5, Total: 5, Unavailable: []string{}}) {
		t.Fatalf("coverage = %+v, want 5/5", metrics.Coverage)
	}
}

func TestMeasureTakeWithoutATranscriptLowersCoverageAndPenalisesNothing(t *testing.T) {
	path := takeSource(t)
	with := measureTake(t, fullInput(path))
	withoutInput := fullInput(path)
	withoutInput.Words = nil
	without := measureTake(t, withoutInput)

	wantUnavailable(t, "pause profile", without.PauseProfile.Evidence, "no transcript")
	if !reflect.DeepEqual(without.Coverage, Coverage{Measured: 4, Total: 5, Unavailable: []string{CategoryPauseProfile}}) {
		t.Fatalf("coverage = %+v, want 4/5 with pause_profile unavailable", without.Coverage)
	}
	if without.Duration.SpeechSeconds != nil || without.Duration.WordsPerMinute != nil {
		t.Fatalf("duration = %+v, want no speech figures without words", without.Duration)
	}
	for name, pair := range map[string][2]any{
		"audio":             {with.Audio, without.Audio},
		"clipping":          {with.Clipping, without.Clipping},
		"noise":             {with.Noise, without.Noise},
		"level consistency": {with.LevelConsistency, without.LevelConsistency},
	} {
		if !reflect.DeepEqual(pair[0], pair[1]) {
			t.Fatalf("%s changed when the transcript went missing:\n%+v\n%+v", name, pair[0], pair[1])
		}
	}
}

func TestMeasureTakeOfAnMP3SourceIsUnavailableNotGuessed(t *testing.T) {
	item := tracks.Item{Length: 3, Takes: []tracks.Take{{
		GUID: "{MP3}", SourceKind: "MP3", SourceFile: filepath.Join(t.TempDir(), "read.mp3"),
		SourceAvailable: true, Supported: true, PlayRate: 1,
	}}}
	metrics := measureTake(t, TakeInput{Item: item, Words: takeWords()[:2]})

	if metrics.Audio != nil {
		t.Fatalf("audio = %+v, want none for an MP3", metrics.Audio)
	}
	for name, e := range map[string]Evidence{
		"clipping": metrics.Clipping.Evidence, "noise": metrics.Noise.Evidence, "level consistency": metrics.LevelConsistency.Evidence,
	} {
		wantUnavailable(t, name, e, "only WAV")
	}
	if metrics.Noise.NoiseFloordBFS != nil || metrics.Clipping.ClipRuns != nil || metrics.Clipping.ClipRunCount != nil {
		t.Fatalf("an unavailable category must carry no numbers: %+v %+v", metrics.Noise, metrics.Clipping)
	}
	wantMeasured(t, "duration", metrics.Duration.Evidence)
	if metrics.Duration.ItemSeconds == nil || *metrics.Duration.ItemSeconds != 3 || metrics.Duration.AudioSeconds != nil {
		t.Fatalf("duration = %+v, want the project's 3 s and no audio figure", metrics.Duration)
	}
	wantMeasured(t, "pause profile", metrics.PauseProfile.Evidence)
	want := Coverage{Measured: 2, Total: 5, Unavailable: []string{CategoryClipping, CategoryNoise, CategoryLevelConsistency}}
	if !reflect.DeepEqual(metrics.Coverage, want) {
		t.Fatalf("coverage = %+v, want %+v", metrics.Coverage, want)
	}
}

func TestMeasureTakeExplainsEachReasonAudioCannotBeMeasured(t *testing.T) {
	path := takeSource(t)
	corrupt := filepath.Join(t.TempDir(), "corrupt.wav")
	if err := os.WriteFile(corrupt, []byte("RIFF....WAVEjunk"), 0o600); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		edit   func(*tracks.Take)
		reason string
	}{
		{"missing source file", func(tk *tracks.Take) { tk.SourceAvailable = false }, "not available"},
		{"file vanished after parsing", func(tk *tracks.Take) { tk.SourceFile = filepath.Join(t.TempDir(), "gone.wav") }, "could not be read"},
		{"corrupt WAV", func(tk *tracks.Take) { tk.SourceFile = corrupt }, "could not be read"},
		{"range outside the audio", func(tk *tracks.Take) { tk.SOFFS = 100 }, "outside its source audio"},
		{"stretch markers", func(tk *tracks.Take) { tk.StretchMarkerCount = 2 }, "stretch markers"},
		{"no source kind", func(tk *tracks.Take) { tk.SourceKind = "" }, "only WAV"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := wavTake(path)
			tt.edit(&item.Takes[0])
			metrics := measureTake(t, TakeInput{Item: item})

			wantUnavailable(t, "clipping", metrics.Clipping.Evidence, tt.reason)
			wantUnavailable(t, "noise", metrics.Noise.Evidence, tt.reason)
			wantUnavailable(t, "level consistency", metrics.LevelConsistency.Evidence, tt.reason)
			wantMeasured(t, "duration from the project", metrics.Duration.Evidence)
			if metrics.Audio != nil {
				t.Fatalf("audio = %+v, want none", metrics.Audio)
			}
		})
	}
}

func TestMeasureTakeLevelConsistencyNeedsBothSides(t *testing.T) {
	path := takeSource(t)

	noNeighbours := fullInput(path)
	noNeighbours.Neighbors = []NeighborLevel{{ItemGUID: "{MP3 neighbour}"}}
	metrics := measureTake(t, noNeighbours)
	wantUnavailable(t, "level consistency", metrics.LevelConsistency.Evidence, "no neighbouring item")
	within(t, "take LUFS still shown", metrics.LevelConsistency.IntegratedLUFS, -21, 0.5)
	if metrics.LevelConsistency.DeltaLU != nil || metrics.LevelConsistency.NeighborsUnavailable != 1 {
		t.Fatalf("level = %+v, want no delta and 1 unavailable neighbour", metrics.LevelConsistency)
	}

	short := fullInput(path)
	short.Item.Length = 0.3
	short.Words = nil
	metrics = measureTake(t, short)
	wantUnavailable(t, "level consistency", metrics.LevelConsistency.Evidence, "integrated loudness")
	wantUnavailable(t, "noise", metrics.Noise.Evidence, "500 ms")
	wantMeasured(t, "clipping of a short take", metrics.Clipping.Evidence)
}

func TestMeasureTakeOfAnItemWithNoLengthHasNoDuration(t *testing.T) {
	item := wavTake(takeSource(t))
	item.Length = 0
	metrics := measureTake(t, TakeInput{Item: item})
	wantUnavailable(t, "duration", metrics.Duration.Evidence, "no usable length")
	wantUnavailable(t, "clipping", metrics.Clipping.Evidence, "length")
	if metrics.Duration.ItemSeconds != nil || metrics.Source != nil {
		t.Fatalf("duration = %+v, source = %+v; want neither", metrics.Duration, metrics.Source)
	}
}

func TestMeasureTakeWithTooFewWordsHasNoPauseProfile(t *testing.T) {
	in := fullInput(takeSource(t))
	in.Words = takeWords()[:1]
	metrics := measureTake(t, in)
	wantUnavailable(t, "pause profile", metrics.PauseProfile.Evidence, "fewer than two")
	within(t, "one word still has a speech span", metrics.Duration.SpeechSeconds, 0.5, 1e-9)

	in.Words = []Word{}
	metrics = measureTake(t, in)
	wantUnavailable(t, "pause profile of an empty transcript", metrics.PauseProfile.Evidence, "fewer than two")
	if metrics.Duration.SpeechSeconds != nil {
		t.Fatalf("speech = %v, want none with no words", *metrics.Duration.SpeechSeconds)
	}
}

func TestMeasureTakeIsReproducibleAndHasNoCompositeScore(t *testing.T) {
	in := fullInput(takeSource(t))
	first, err := json.Marshal(measureTake(t, in))
	if err != nil {
		t.Fatal(err)
	}
	second, err := json.Marshal(measureTake(t, in))
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("same inputs gave different output:\n%s\n%s", first, second)
	}
	for _, banned := range []string{"score", "rank", "grade", "best"} {
		if strings.Contains(strings.ToLower(string(first)), `"`+banned) {
			t.Fatalf("take metrics JSON has a %q field; per-category evidence only (Q9): %s", banned, first)
		}
	}
}

func TestMeasureTakeRejectsCallerErrors(t *testing.T) {
	path := takeSource(t)
	tests := map[string]TakeInput{
		"take index past the end":    {Item: wavTake(path), TakeIndex: 1},
		"negative take index":        {Item: wavTake(path), TakeIndex: -1},
		"word ends before it starts": {Item: wavTake(path), Words: []Word{{StartSeconds: 1, EndSeconds: 0.5}}},
		"words out of order": {Item: wavTake(path), Words: []Word{
			{StartSeconds: 1, EndSeconds: 1.2}, {StartSeconds: 0.5, EndSeconds: 0.7},
		}},
		"negative word time":       {Item: wavTake(path), Words: []Word{{StartSeconds: -1, EndSeconds: 0.5}}},
		"NaN word time":            {Item: wavTake(path), Words: []Word{{StartSeconds: math.NaN(), EndSeconds: 0.5}}},
		"negative pause threshold": {Item: wavTake(path), Pauses: PauseOptions{MinPauseSeconds: -1, LongPauseSeconds: 2}},
		"long below min":           {Item: wavTake(path), Pauses: PauseOptions{MinPauseSeconds: 1, LongPauseSeconds: 0.5}},
	}
	for name, in := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := MeasureTake(in); err == nil {
				t.Fatal("MeasureTake = nil error, want the caller's mistake reported")
			}
		})
	}
}

func TestMeasureTakeUsesTheDefaultPauseThresholdsWhenNoneAreGiven(t *testing.T) {
	in := fullInput(takeSource(t))
	in.Pauses = PauseOptions{}
	metrics := measureTake(t, in)
	defaults := DefaultPauseOptions()
	if metrics.PauseProfile.MinPauseSeconds != defaults.MinPauseSeconds || metrics.PauseProfile.LongPauseSeconds != defaults.LongPauseSeconds {
		t.Fatalf("thresholds = %+v, want the defaults %+v", metrics.PauseProfile, defaults)
	}
	if len(metrics.PauseProfile.LongPauses) != 0 {
		t.Fatalf("long pauses = %+v, want none under the %v s default", metrics.PauseProfile.LongPauses, defaults.LongPauseSeconds)
	}
}

func TestTakeSourceRangeFollowsTheTakeAwareItemModel(t *testing.T) {
	base := tracks.Take{SourceKind: "WAVE", SourceFile: "a.wav", PlayRate: 1}
	tests := []struct {
		name   string
		length float64
		take   func(tracks.Take) tracks.Take
		want   Range
	}{
		{"plain offset", 2, func(tk tracks.Take) tracks.Take { tk.SOFFS = 0.5; return tk }, Range{0.5, 2}},
		{"faster playrate consumes more source", 2, func(tk tracks.Take) tracks.Take { tk.PlayRate = 1.25; return tk }, Range{0, 2.5}},
		{"unrecorded playrate is REAPER's 1", 2, func(tk tracks.Take) tracks.Take { tk.PlayRate = 0; return tk }, Range{0, 2}},
		{"section adds its start", 1, func(tk tracks.Take) tracks.Take {
			tk.SOFFS = 0.25
			tk.Section = &tracks.SectionOffsets{StartPos: 0.5, Length: 1.5}
			return tk
		}, Range{0.75, 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := tracks.Item{Length: tt.length, Takes: []tracks.Take{tt.take(base)}}
			got, err := TakeSourceRange(item, 0)
			if err != nil {
				t.Fatalf("TakeSourceRange: %v", err)
			}
			if got.File != "a.wav" || got.Kind != "WAVE" || math.Abs(got.Range.StartSeconds-tt.want.StartSeconds) > 1e-12 || math.Abs(got.Range.LengthSeconds-tt.want.LengthSeconds) > 1e-12 {
				t.Fatalf("range = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestTakeSourceRangeRefusesWhatItCannotDeriveExactly(t *testing.T) {
	base := tracks.Take{SourceKind: "WAVE", SourceFile: "a.wav", PlayRate: 1}
	tests := []struct {
		name   string
		length float64
		edit   func(*tracks.Take)
		reason string
	}{
		{"stretch markers", 2, func(tk *tracks.Take) { tk.StretchMarkerCount = 1 }, "stretch markers"},
		{"negative offset", 2, func(tk *tracks.Take) { tk.SOFFS = -0.5 }, "before its source"},
		{"negative playrate", 2, func(tk *tracks.Take) { tk.PlayRate = -1 }, "playrate"},
		{"infinite playrate", 2, func(tk *tracks.Take) { tk.PlayRate = math.Inf(1) }, "playrate"},
		{"no item length", 0, func(*tracks.Take) {}, "length"},
		{"section loops", 2, func(tk *tracks.Take) { tk.Section = &tracks.SectionOffsets{StartPos: 0, Length: 1} }, "loops"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			take := base
			tt.edit(&take)
			_, err := TakeSourceRange(tracks.Item{Length: tt.length, Takes: []tracks.Take{take}}, 0)
			if err == nil || !strings.Contains(err.Error(), tt.reason) {
				t.Fatalf("error = %v, want one mentioning %q", err, tt.reason)
			}
		})
	}
	if _, err := TakeSourceRange(tracks.Item{Length: 1}, 0); err == nil {
		t.Fatal("an item with no takes has no take 0")
	}
}

// TestMeasureTakeOnTheReaperSavedFixture runs the engine over a project
// REAPER itself wrote (tracks' saved-cases.rpp, 3 s 8 kHz mono sources).
func TestMeasureTakeOnTheReaperSavedFixture(t *testing.T) {
	project, err := tracks.Parse(filepath.Join("..", "tracks", "testdata", "reaper", "saved-cases.rpp"))
	if err != nil {
		t.Fatal(err)
	}
	items := map[string]tracks.Item{}
	for _, track := range project.Tracks {
		for _, item := range track.Items {
			items[track.Name] = item
		}
	}

	multi := items["Multi-take"]
	for index := range multi.Takes {
		metrics := measureTake(t, TakeInput{Item: multi, TakeIndex: index})
		wantMeasured(t, "multi-take clipping", metrics.Clipping.Evidence)
		within(t, "multi-take audio", metrics.Duration.AudioSeconds, 3, 1e-9)
	}

	section := measureTake(t, TakeInput{Item: items["Section"]})
	if section.Source == nil || section.Source.Range != (Range{StartSeconds: 0.5, LengthSeconds: 1.5}) {
		t.Fatalf("section source = %+v, want [0.5, +1.5)", section.Source)
	}
	within(t, "section audio", section.Duration.AudioSeconds, 1.5, 1e-9)

	stretched := measureTake(t, TakeInput{Item: items["Rate and stretch"]})
	wantUnavailable(t, "stretched clipping", stretched.Clipping.Evidence, "stretch markers")
	within(t, "stretched item seconds from the project", stretched.Duration.ItemSeconds, 2.4, 0)
}
