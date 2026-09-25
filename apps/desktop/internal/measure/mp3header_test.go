package measure

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mp3Frame builds one Layer III frame: a header for the MPEG version (1, 2 or 25), the bitrate index, the sample-rate
// index and the channel mode, then zero bytes to the frame's length. payload, when given, is written after the header
// and side information (where a Xing or Info tag sits).
func mp3Frame(t testing.TB, version, bitrateIndex, rateIndex, mode int, payload string) []byte {
	t.Helper()
	versionBits := map[int]byte{1: 3, 2: 2, 25: 0}[version]
	header := []byte{0xff, 0xe0 | versionBits<<3 | 1<<1 | 1, byte(bitrateIndex<<4 | rateIndex<<2), byte(mode << 6)}
	h, err := parseMP3Header(header)
	if err != nil {
		t.Fatalf("mp3Frame: %v", err)
	}
	frame := make([]byte, h.frameBytes)
	copy(frame, header)
	copy(frame[frameHeaderBytes+h.sideInfoSize:], payload)
	return frame
}

func mp3Frames(t testing.TB, count, bitrateIndex, mode int) []byte {
	t.Helper()
	var out bytes.Buffer
	for range count {
		out.Write(mp3Frame(t, 1, bitrateIndex, 0, mode, ""))
	}
	return out.Bytes()
}

// id3v2 is an ID3v2.4 tag with size bytes of body (a syncsafe size).
func id3v2(size int) []byte {
	head := []byte{'I', 'D', '3', 4, 0, 0, byte(size >> 21 & 0x7f), byte(size >> 14 & 0x7f), byte(size >> 7 & 0x7f), byte(size & 0x7f)}
	return append(head, make([]byte, size)...)
}

func id3v1() []byte {
	tag := make([]byte, id3v1Bytes)
	copy(tag, "TAG")
	return tag
}

func concat8(parts ...[]byte) []byte {
	var out []byte
	for _, part := range parts {
		out = append(out, part...)
	}
	return out
}

func readMP3(t *testing.T, raw []byte) MP3Info {
	t.Helper()
	info, err := ReadMP3(context.Background(), bytes.NewReader(raw), nil)
	if err != nil {
		t.Fatalf("ReadMP3: %v", err)
	}
	return info
}

func TestReadMP3ReadsAConstantBitRateFile(t *testing.T) {
	// 192 kbps (index 11) joint stereo at 44.1 kHz: 1000 frames of 1152 samples.
	raw := concat8(id3v2(2048), mp3Frames(t, 1000, 11, 1), id3v1())
	info := readMP3(t, raw)

	if !info.CBR || info.BitrateKbps != 192 || info.SampleRate != 44100 || info.ChannelMode != "joint_stereo" || info.Channels() != 2 {
		t.Fatalf("info = %+v, want 192 kbps CBR joint stereo at 44.1 kHz", info)
	}
	if info.Version != "MPEG-1" || info.Layer != 3 || info.Frames != 1000 || info.ID3v2Bytes != 2058 || info.LostBytes != 0 {
		t.Fatalf("info = %+v, want MPEG-1 Layer III, 1000 frames, a 2058-byte ID3v2 tag, nothing lost", info)
	}
	if want := 1000 * 1152 / 44100.0; math.Abs(info.DurationSeconds-want) > 1e-9 {
		t.Fatalf("duration = %v, want %v", info.DurationSeconds, want)
	}
	// The frames here are never padded (an encoder pads some to keep 192 exactly), so the average is a little lower.
	if math.Abs(info.AverageBitrateKbps-192) > 0.5 {
		t.Fatalf("average bitrate = %v, want about 192", info.AverageBitrateKbps)
	}
}

func TestReadMP3TellsVariableBitRateFromAXingTagOrFromTheFrames(t *testing.T) {
	xing := concat8(mp3Frame(t, 1, 9, 0, 3, "Xing"), mp3Frames(t, 50, 9, 3))
	info := readMP3(t, xing)
	if info.CBR || info.BitrateKbps != 0 || info.VBRTag != "Xing" || info.Frames != 50 || info.ChannelMode != "mono" || info.Channels() != 1 {
		t.Fatalf("Xing-tagged = %+v, want VBR, the tag frame not counted, mono", info)
	}

	mixed := concat8(mp3Frames(t, 20, 11, 1), mp3Frames(t, 20, 13, 1))
	if info := readMP3(t, mixed); info.CBR || info.BitrateKbps != 0 || info.AverageBitrateKbps <= 192 {
		t.Fatalf("mixed bitrates = %+v, want VBR with an average above 192", info)
	}

	lame := concat8(mp3Frame(t, 1, 11, 0, 1, "Info"), mp3Frames(t, 30, 11, 1))
	if info := readMP3(t, lame); !info.CBR || info.BitrateKbps != 192 || info.VBRTag != "Info" || info.Frames != 30 {
		t.Fatalf("LAME Info-tagged CBR = %+v, want CBR at 192 with the tag frame not counted", info)
	}
}

func TestReadMP3ReadsMPEG2AndSkipsJunkBetweenFrames(t *testing.T) {
	var mpeg2 bytes.Buffer
	for range 40 {
		mpeg2.Write(mp3Frame(t, 2, 8, 0, 3, "")) // 64 kbps at 22.05 kHz
	}
	info := readMP3(t, mpeg2.Bytes())
	if info.Version != "MPEG-2" || info.SampleRate != 22050 || info.BitrateKbps != 64 || info.Frames != 40 {
		t.Fatalf("MPEG-2 = %+v", info)
	}
	if want := 40 * 576 / 22050.0; math.Abs(info.DurationSeconds-want) > 1e-9 {
		t.Fatalf("duration = %v, want %v", info.DurationSeconds, want)
	}

	padded := concat8(make([]byte, 300), mp3Frames(t, 10, 11, 1), []byte("junk!"), mp3Frames(t, 10, 11, 1))
	if info := readMP3(t, padded); info.Frames != 20 || info.LostBytes != 305 {
		t.Fatalf("padded = %+v, want 20 frames and 305 bytes lost", info)
	}

	cut := mp3Frames(t, 10, 11, 1)
	cut = cut[:len(cut)-100]
	if info := readMP3(t, cut); info.Frames != 9 || info.LostBytes == 0 {
		t.Fatalf("a last frame cut short = %+v, want 9 whole frames and the rest lost", info)
	}
}

func TestReadMP3RefusesWhatIsNotARunOfLayerIIIFrames(t *testing.T) {
	layer2 := bytes.Repeat([]byte{0xff, 0xfd, 0xb0, 0x40}, 5000)
	cases := map[string]struct {
		raw  []byte
		want string
	}{
		"empty":              {nil, "no MPEG audio frames"},
		"an ID3 tag only":    {id3v2(500), "no MPEG audio frames"},
		"a WAV file":         {encodeWAV(t, 1, 44100, 16, false, silence(44100, 0.1)), "no MPEG audio frames"},
		"a lone stray sync":  {concat8([]byte{0xff, 0xfb, 0xb0, 0x40}, make([]byte, 200)), "no MPEG audio frames"},
		"Layer II":           {layer2, "not Layer III"},
		"a cut ID3 tag":      {id3v2(500)[:100], "inside its ID3v2 tag"},
		"a bad ID3 size":     {[]byte{'I', 'D', '3', 4, 0, 0, 0x80, 0, 0, 0}, "syncsafe"},
		"frames then 70 KiB": {concat8(mp3Frames(t, 5, 11, 1), bytes.Repeat([]byte{0x11}, 70<<10), mp3Frames(t, 5, 11, 1)), "do not resume"},
	}
	for name, c := range cases {
		_, err := ReadMP3(context.Background(), bytes.NewReader(c.raw), nil)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want one saying %q", name, err, c.want)
		}
	}
}

func TestReadMP3StopsWhenCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ReadMP3(ctx, bytes.NewReader(mp3Frames(t, 10, 11, 1)), nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestMeasureFileReadsAnMP3ForItsContainerAndFingerprintsItAll(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Chapter 01.mp3")
	raw := concat8(id3v2(100), mp3Frames(t, 200, 11, 3), id3v1())
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	var lastDone, total int64
	measured, err := MeasureFile(context.Background(), path, Options{Progress: func(done, all int64) { lastDone, total = done, all }})
	if err != nil {
		t.Fatalf("MeasureFile: %v", err)
	}
	report := measured.Report
	if report.MP3 == nil || report.MP3.BitrateKbps != 192 || report.SampleRate != 44100 || report.Channels != 1 || report.File != path {
		t.Fatalf("report = %+v, want the MP3's container read", report)
	}
	if report.RMSdBFS != nil || report.SamplePeakdBFS != nil || report.HeadRoomToneSeconds != nil {
		t.Fatalf("an MP3 report holds levels or edges %+v; nothing is decoded", report)
	}
	if measured.Fingerprint.SizeBytes != int64(len(raw)) || total != int64(len(raw)) || lastDone == 0 {
		t.Fatalf("fingerprint %+v, progress %d of %d; want the whole file", measured.Fingerprint, lastDone, total)
	}
	if _, err := MeasureFile(context.Background(), path, Options{Range: &Range{StartSeconds: 0, LengthSeconds: 1}}); err == nil {
		t.Fatal("a range of an MP3 was measured; it has no decoded audio")
	}
}

// FuzzReadMP3 feeds arbitrary bytes to the header reader: it must answer or refuse, never panic or loop, and what it
// answers must hold together.
func FuzzReadMP3(f *testing.F) {
	f.Add(concat8(id3v2(20), mp3Frames(f, 4, 11, 1), id3v1()))
	f.Add(concat8(mp3Frame(f, 1, 9, 0, 3, "Xing"), mp3Frames(f, 3, 9, 3)))
	f.Add([]byte("ID3\x04\x00\x10\x00\x00\x00\x05hello"))
	f.Add([]byte{0xff, 0xfb, 0x90, 0x00})
	f.Fuzz(func(t *testing.T, raw []byte) {
		info, err := ReadMP3(context.Background(), bytes.NewReader(raw), nil)
		if err != nil {
			return
		}
		if info.Frames < 1 || info.SampleRate <= 0 || !(info.DurationSeconds > 0) || info.LostBytes < 0 || info.LostBytes > int64(len(raw)) {
			t.Fatalf("inconsistent info %+v from %d bytes", info, len(raw))
		}
		if info.CBR != (info.BitrateKbps > 0) {
			t.Fatalf("CBR %v with bitrate %d", info.CBR, info.BitrateKbps)
		}
	})
}

func TestParseMP3HeaderReadsMPEG25AndRefusesReservedAndFreeFormatHeaders(t *testing.T) {
	h, err := parseMP3Header(mp3Frame(t, 25, 8, 0, 3, "")[:frameHeaderBytes])
	if err != nil || h.versionName() != "MPEG-2.5" || h.sampleRate != 11025 || h.samples != 576 {
		t.Fatalf("MPEG-2.5 header = %+v, %v", h, err)
	}
	for name, header := range map[string][]byte{
		"a reserved version":     {0xff, 0xeb, 0x90, 0x00}, // version bits 01
		"free format":            {0xff, 0xfb, 0x00, 0x00}, // bitrate index 0
		"an invalid bitrate":     {0xff, 0xfb, 0xf0, 0x00}, // bitrate index 15
		"a reserved sample rate": {0xff, 0xfb, 0x9c, 0x00}, // rate index 3
	} {
		if _, err := parseMP3Header(header); err == nil || errors.Is(err, errNoSync) {
			t.Errorf("%s: err = %v, want a named refusal", name, err)
		}
	}
}

func TestReadMP3ReadsAVBRIHeaderAsVariableBitRate(t *testing.T) {
	first := mp3Frame(t, 1, 9, 0, 1, "")
	copy(first[36:], "VBRI")
	if info := readMP3(t, concat8(first, mp3Frames(t, 10, 9, 1))); info.CBR || info.VBRTag != "VBRI" || info.Frames != 10 {
		t.Fatalf("VBRI-tagged = %+v, want VBR with the tag frame not counted", info)
	}
}

func TestReadMP3RefusesALoneFrameLongJunkATagFrameAloneAndTooMuchSkipped(t *testing.T) {
	var gappy bytes.Buffer
	for range 20 {
		gappy.Write(mp3Frames(t, 3, 11, 1))
		gappy.Write(bytes.Repeat([]byte{0x11}, 60<<10))
	}
	tagOnly := concat8(mp3Frame(t, 1, 9, 0, 3, "Xing"), mp3Frame(t, 1, 9, 0, 3, "")[:frameHeaderBytes+10])
	for name, c := range map[string]struct {
		raw  []byte
		want string
	}{
		"one frame and nothing after it": {mp3Frame(t, 1, 11, 0, 1, ""), "no MPEG audio frames"},
		"70 KiB without a frame":         {bytes.Repeat([]byte{0x11}, 70<<10), "no MPEG audio frames"},
		"a VBR tag frame and no audio":   {tagOnly, "no MPEG audio frames"},
		"over 1 MiB between frames":      {gappy.Bytes(), "the file is damaged"},
	} {
		if _, err := ReadMP3(context.Background(), bytes.NewReader(c.raw), nil); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want one saying %q", name, err, c.want)
		}
	}
}

func TestMeasureFileAnswersWhyAnMP3CouldNotBeRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Chapter 02.mp3")
	if err := os.WriteFile(path, id3v2(500)[:100], 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := MeasureFile(context.Background(), path, Options{}); err == nil || !strings.Contains(err.Error(), "ID3v2 tag") {
		t.Fatalf("err = %v, want the MP3 reader's reason", err)
	}
}
