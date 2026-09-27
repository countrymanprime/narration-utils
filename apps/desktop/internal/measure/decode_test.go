package measure

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
)

// fakeDecoder is a test-only Decoder: it writes wav to dst, or answers err instead.
type fakeDecoder struct {
	wav []byte
	err error
}

func (f fakeDecoder) DecodeToWAV(ctx context.Context, _, dst string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if f.err != nil {
		return f.err
	}
	return os.WriteFile(dst, f.wav, 0o600)
}

func mp3Fixture(t *testing.T) string {
	t.Helper()
	return writeTemp(t, "chapter.mp3", mp3Frames(t, 80, 11, 3)) // 192 kbps mono, MPEG-1, plenty of frames
}

func TestMeasureFileDecodesAnMP3sLevelsWhenADecoderIsGiven(t *testing.T) {
	wav := encodeWAV(t, 1, 44100, 16, false, longMono(44100))
	path := mp3Fixture(t)

	got, err := MeasureFile(context.Background(), path, Options{Decoder: fakeDecoder{wav: wav}})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Report.MP3LevelsDecoded {
		t.Fatal("MP3LevelsDecoded = false, want true once a Decoder measured the file")
	}
	if got.Report.MP3 == nil {
		t.Fatal("MP3 container info was dropped once levels were decoded, want it kept")
	}
	if got.Report.RMSdBFS == nil || got.Report.SamplePeakdBFS == nil {
		t.Fatalf("levels = %+v, want them measured from the decoded audio", got.Report)
	}
	want, err := Analyze(bytes.NewReader(wav))
	if err != nil {
		t.Fatal(err)
	}
	if *got.Report.RMSdBFS != *want.RMSdBFS {
		t.Errorf("RMS = %v, want the same reading Analyze gives the decoded WAV directly: %v", *got.Report.RMSdBFS, *want.RMSdBFS)
	}
}

func TestMeasureFileLeavesAnMP3sLevelsNotCheckedWithNoDecoder(t *testing.T) {
	path := mp3Fixture(t)
	got, err := MeasureFile(context.Background(), path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got.Report.MP3LevelsDecoded {
		t.Fatal("MP3LevelsDecoded = true with no Decoder given, want false")
	}
	if got.Report.RMSdBFS != nil {
		t.Fatalf("RMS = %v, want null: nothing decoded it", *got.Report.RMSdBFS)
	}
}

func TestMeasureFileLeavesLevelsNotCheckedWhenTheDecoderIsUnavailable(t *testing.T) {
	path := mp3Fixture(t)
	got, err := MeasureFile(context.Background(), path, Options{Decoder: fakeDecoder{err: ErrDecoderNotAvailable}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Report.MP3LevelsDecoded {
		t.Fatal("MP3LevelsDecoded = true when the decoder answered ErrDecoderNotAvailable, want false: no different from having no Decoder at all")
	}
}

func TestMeasureFileReportsAFailedDecodeAsAttemptedNotAsUnavailable(t *testing.T) {
	path := mp3Fixture(t)
	got, err := MeasureFile(context.Background(), path, Options{Decoder: fakeDecoder{err: errors.New("the MP3 is corrupt")}})
	if err != nil {
		t.Fatal(err)
	}
	if !got.Report.MP3LevelsDecoded {
		t.Fatal("MP3LevelsDecoded = false after a genuine decode failure, want true: an attempt was made, nothing usable came of it")
	}
	if got.Report.RMSdBFS != nil {
		t.Fatalf("RMS = %v, want null: a failed decode never fabricates a value", *got.Report.RMSdBFS)
	}
}

func TestMeasureFileStopsOnACancelledContextDuringDecode(t *testing.T) {
	path := mp3Fixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := MeasureFile(ctx, path, Options{Decoder: fakeDecoder{wav: encodeWAV(t, 1, 44100, 16, false, longMono(44100))}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
