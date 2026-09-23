package chaptertags

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The fixtures under testdata/ are synthetic sine-wave MP3s generated with ffmpeg (libmp3lame, 44.1 kHz mono,
// 32 kbps): chapter1.mp3 is exactly 1.0s, chapter2.mp3 is exactly 1.5s, book.mp3 is exactly 2.6s (ffprobe
// -show_entries format=duration at authoring time). mp3Duration is a frame-summing estimate, not a decode, so
// tests allow a small tolerance rather than asserting exact equality.

func TestMp3DurationMatchesKnownFixtureLengths(t *testing.T) {
	cases := []struct {
		file string
		want time.Duration
	}{
		{"chapter1.mp3", 1000 * time.Millisecond},
		{"chapter2.mp3", 1500 * time.Millisecond},
		{"book.mp3", 2600 * time.Millisecond},
	}
	const tolerance = 100 * time.Millisecond // LAME's info frame plus encoder priming/padding samples

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			got, err := mp3Duration(filepath.Join("testdata", tc.file))
			if err != nil {
				t.Fatalf("mp3Duration(%s) error: %v", tc.file, err)
			}
			diff := got - tc.want
			if diff < 0 {
				diff = -diff
			}
			if diff > tolerance {
				t.Fatalf("mp3Duration(%s) = %v, want close to %v (tolerance %v)", tc.file, got, tc.want, tolerance)
			}
		})
	}
}

func TestMp3DurationRejectsNonAudio(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "not-audio.mp3")
	if err := os.WriteFile(path, []byte("this is not an mp3 file at all"), 0o644); err != nil {
		t.Fatalf("os.WriteFile: %v", err)
	}
	if _, err := mp3Duration(path); err == nil {
		t.Fatal("mp3Duration on non-audio data: want error, got nil")
	}
}

func TestMp3DurationMissingFile(t *testing.T) {
	if _, err := mp3Duration(filepath.Join("testdata", "does-not-exist.mp3")); err == nil {
		t.Fatal("mp3Duration on a missing file: want error, got nil")
	}
}

func TestParseFrameHeaderRejectsGarbage(t *testing.T) {
	if _, ok := parseFrameHeader([]byte{0x00, 0x00, 0x00, 0x00}); ok {
		t.Fatal("parseFrameHeader on all-zero bytes: want ok=false")
	}
	if _, ok := parseFrameHeader([]byte{0xFF}); ok {
		t.Fatal("parseFrameHeader on too-short input: want ok=false")
	}
}
