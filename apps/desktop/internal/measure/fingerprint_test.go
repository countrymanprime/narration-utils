package measure

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func writeTemp(t *testing.T, name string, raw []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func TestFingerprintFileIsSizeModifiedTimeAndContentHash(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, longMono(8000))
	path := writeTemp(t, "chapter.wav", raw)
	stamp := time.Date(2026, 9, 23, 10, 30, 0, 125_000_000, time.UTC)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}

	got, err := FingerprintFile(path)
	if err != nil {
		t.Fatal(err)
	}
	want := Fingerprint{SizeBytes: int64(len(raw)), ModifiedAt: "2026-09-23T10:30:00.125Z", SHA256: sha256Hex(raw)}
	if got != want {
		t.Fatalf("fingerprint = %+v, want %+v", got, want)
	}
}

func TestFingerprintFileNamesAMissingFile(t *testing.T) {
	if _, err := FingerprintFile(filepath.Join(t.TempDir(), "gone.wav")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want not-exist", err)
	}
}

func TestMeasureFileReportsTheFileAndTheFingerprintOfWhatItRead(t *testing.T) {
	raw := encodeWAV(t, 2, 8000, 24, false, stereo(longMono(8000)))
	path := writeTemp(t, "chapter.wav", raw)
	var log progressLog

	got, err := MeasureFile(context.Background(), path, Options{Progress: log.record})
	if err != nil {
		t.Fatal(err)
	}
	want, err := AnalyzeFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got.Report, want) {
		t.Fatalf("report\n%+v\nwant AnalyzeFile's\n%+v", got.Report, want)
	}
	fingerprint, err := FingerprintFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Fingerprint != fingerprint {
		t.Fatalf("fingerprint = %+v, want FingerprintFile's %+v", got.Fingerprint, fingerprint)
	}
	log.check(t, int64(len(raw)-44)) // everything after the 44-byte canonical header
}

func TestMeasureFileOfARangeStillFingerprintsTheWholeFile(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, longMono(8000))
	path := writeTemp(t, "chapter.wav", raw)
	rng := Range{StartSeconds: 0.25, LengthSeconds: 0.5}

	got, err := MeasureFile(context.Background(), path, Options{Range: &rng})
	if err != nil {
		t.Fatal(err)
	}
	if got.Fingerprint.SHA256 != sha256Hex(raw) || got.Fingerprint.SizeBytes != int64(len(raw)) {
		t.Fatalf("fingerprint = %+v, want the whole file's", got.Fingerprint)
	}
	if want, _ := AnalyzeFileRange(path, rng); !reflect.DeepEqual(got.Report, want) {
		t.Fatalf("report\n%+v\nwant AnalyzeFileRange's\n%+v", got.Report, want)
	}
}

func TestMeasureFileNeverChangesTheInput(t *testing.T) {
	raw := encodeWAV(t, 2, 8000, 16, false, stereo(longMono(8000)))
	path := writeTemp(t, "chapter.wav", raw)
	before, err := FingerprintFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := MeasureFile(context.Background(), path, Options{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	_, _ = MeasureFile(ctx, path, Options{Progress: func(int64, int64) { cancel() }})

	after, err := FingerprintFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("measuring changed the file: %+v, then %+v", before, after)
	}
}

func TestMeasureFileRefusesAFileThatChangedWhileItWasRead(t *testing.T) {
	raw := encodeWAV(t, 1, 8000, 16, false, longMono(8000))
	path := writeTemp(t, "recording.wav", raw)
	grown := false

	_, err := MeasureFile(context.Background(), path, Options{Progress: func(int64, int64) {
		if grown {
			return
		}
		grown = true
		file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			t.Error(err)
			return
		}
		_, _ = file.Write(make([]byte, 4096))
		_ = file.Close()
	}})
	if !errors.Is(err, ErrFileChanged) {
		t.Fatalf("err = %v, want ErrFileChanged", err)
	}
}

func TestMeasureFilePassesOnCancellation(t *testing.T) {
	path := writeTemp(t, "chapter.wav", encodeWAV(t, 1, 8000, 16, false, longMono(8000)))
	ctx, cancel := context.WithCancel(context.Background())
	_, err := MeasureFile(ctx, path, Options{Progress: func(int64, int64) { cancel() }})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestMeasureFileProgressOfAnUnfinishedHeaderRunsToTheEndOfTheFile(t *testing.T) {
	body := encodeWAV(t, 1, 8000, 16, false, longMono(8000))[44:]
	path := writeTemp(t, "recording.wav", riff(fmtChunk(1, 1, 8000, 16), dataChunk(body, 0xFFFFFFFF)))
	var log progressLog

	if _, err := MeasureFile(context.Background(), path, Options{Progress: log.record}); err != nil {
		t.Fatal(err)
	}
	log.check(t, int64(len(body)))
}

func TestMeasureFileRefusesAFolder(t *testing.T) {
	dir := t.TempDir()
	if _, err := MeasureFile(context.Background(), dir, Options{}); err == nil {
		t.Fatal("a folder was measured")
	}
	if _, err := FingerprintFile(dir); err == nil {
		t.Fatal("a folder was fingerprinted")
	}
}

// bigFile is a WAV of over two megabytes, so hashing what follows a short range takes several drain blocks.
func bigFile(t *testing.T) (string, []byte) {
	t.Helper()
	raw := encodeWAV(t, 2, 48000, 16, false, stereo(sine(48000, 12, 440, -20, 0)))
	return writeTemp(t, "long.wav", raw), raw
}

func TestMeasureFileOfAnEarlyRangeHashesTheLongTailInBlocks(t *testing.T) {
	path, raw := bigFile(t)
	rng := Range{StartSeconds: 0, LengthSeconds: 0.1}
	got, err := MeasureFile(context.Background(), path, Options{Range: &rng})
	if err != nil {
		t.Fatal(err)
	}
	if got.Fingerprint.SHA256 != sha256Hex(raw) {
		t.Fatal("the fingerprint does not cover the file after the range")
	}
}

func TestMeasureFileStopsHashingTheTailWhenCancelled(t *testing.T) {
	path, _ := bigFile(t)
	rng := Range{StartSeconds: 0, LengthSeconds: 0.1}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// The last progress call is made when the range is measured, before the rest of the file is hashed.
	_, err := MeasureFile(ctx, path, Options{Range: &rng, Progress: func(done, total int64) {
		if done == total {
			cancel()
		}
	}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestMeasureFileNamesAMissingFile(t *testing.T) {
	if _, err := MeasureFile(context.Background(), filepath.Join(t.TempDir(), "gone.wav"), Options{}); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want not-exist", err)
	}
}
