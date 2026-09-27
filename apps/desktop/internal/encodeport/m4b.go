package encodeport

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// M4B chapters (render-encode-master Phase 2): FFmpeg is told a Spec's Chapters through an FFMETADATA file (its own
// chapter-metadata format, ffmpeg-formats(1) "Metadata"), passed as a second input and merged with -map_metadata. The "ipod"
// muxer (FFmpeg's M4A/M4B flavour of MP4/ISO base media) writes them as a QuickTime "chapters" text track that the audio
// track's own tref/chap box names - the format iTunes, VLC and most audiobook players read - rather than the ID3 CHAP/CTOC
// frames chaptertags writes into an MP3. readM4BChapters reads that same track back, so an encode can check what it wrote
// (mirroring checkMP3) before it is kept.

// DefaultAACBitrateKbps is the bitrate an m4b Spec leaves to the encoder: comfortably transparent for narrated speech.
const DefaultAACBitrateKbps = 64

// m4bSpec fills a spec's AAC defaults and refuses a chapter list no M4B can have: an empty title, or an end at or before its
// own start. It answers the bitrate.
func m4bSpec(spec *Spec) (int, error) {
	for i, chapter := range spec.Chapters {
		if strings.TrimSpace(chapter.Title) == "" {
			return 0, fmt.Errorf("chapter %d has no title", i+1)
		}
		if chapter.Start < 0 {
			return 0, fmt.Errorf("chapter %d (%q) starts before zero (%v)", i+1, chapter.Title, chapter.Start)
		}
		if chapter.End <= chapter.Start {
			return 0, fmt.Errorf("chapter %d (%q) ends at or before it starts (%v to %v)", i+1, chapter.Title, chapter.Start, chapter.End)
		}
	}
	bitrate := spec.BitrateKbps
	if bitrate == 0 {
		bitrate = DefaultAACBitrateKbps
	}
	if bitrate <= 0 {
		return 0, fmt.Errorf("an AAC bitrate must be positive, not %d kbps", bitrate)
	}
	if spec.Channels < 0 || spec.Channels > 2 {
		return 0, fmt.Errorf("an M4B holds one or two channels, not %d", spec.Channels)
	}
	return bitrate, nil
}

// ffmetadata is chapters as an FFMETADATA1 document, one [CHAPTER] section each, timed in whole milliseconds (FFmpeg accepts
// any TIMEBASE; milliseconds are exact for a Spec's time.Duration boundaries and easy to read back).
func ffmetadata(chapters []Chapter) []byte {
	var b bytes.Buffer
	b.WriteString(";FFMETADATA1\n")
	for _, chapter := range chapters {
		fmt.Fprintf(&b, "[CHAPTER]\nTIMEBASE=1/1000\nSTART=%d\nEND=%d\ntitle=%s\n",
			chapter.Start.Milliseconds(), chapter.End.Milliseconds(), escapeMetadata(chapter.Title))
	}
	return b.Bytes()
}

// escapeMetadata backslash-escapes the characters FFMETADATA gives syntax meaning to (ffmpeg-formats(1) "Metadata": '\', '=',
// ';', '#' and a newline), so a title holding one is read back verbatim rather than breaking a line or starting a new key.
func escapeMetadata(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '\\', '=', ';', '#', '\n':
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// writeMetadataFile writes chapters as an FFMETADATA file beside dst, dot-named like the encode's own partial output. The
// caller removes it once FFmpeg has read it; it is never the encode's output.
func writeMetadataFile(dst string, chapters []Chapter) (string, error) {
	file, err := os.CreateTemp(filepath.Dir(dst), "."+filepath.Base(dst)+".*.chapters.txt")
	if err != nil {
		return "", err
	}
	name := file.Name()
	_, writeErr := file.Write(ffmetadata(chapters))
	closeErr := file.Close()
	if writeErr != nil {
		_ = os.Remove(name)
		return "", writeErr
	}
	if closeErr != nil {
		_ = os.Remove(name)
		return "", closeErr
	}
	return name, nil
}

// m4bArgs is the command line of one m4b encode: the WAV's first audio stream, native AAC, muxed by the "ipod" muxer, with
// machine-readable progress on stdout. metadata, when not empty, is a second FFMETADATA input merged in as chapters. Every
// path reaches FFmpeg the same way mp3Args's do: absolute, through the file protocol, with every other protocol refused.
func m4bArgs(wav, metadata, out string, bitrate int, spec Spec) []string {
	args := []string{
		"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
		"-protocol_whitelist", "file", "-i", fileURL(wav),
	}
	if metadata != "" {
		args = append(args, "-f", "ffmetadata", "-protocol_whitelist", "file", "-i", fileURL(metadata), "-map_metadata", "1")
	}
	args = append(args, "-map", "0:a:0", "-c:a", "aac", "-b:a", strconv.Itoa(bitrate)+"k")
	if spec.SampleRateHz != 0 {
		args = append(args, "-ar", strconv.Itoa(spec.SampleRateHz))
	}
	if spec.Channels != 0 {
		args = append(args, "-ac", strconv.Itoa(spec.Channels))
	}
	return append(args, "-f", "ipod", "-y", fileURL(out))
}

// checkM4B reads what FFmpeg wrote with the app's own M4B chapter reader and refuses it unless it embedded exactly the
// chapters that were asked for. readM4BChapters does not read titles back (a chapter's title is not a per-sample promise the
// container's timing is), so only counts and boundaries are compared, to the millisecond (FFMETADATA's own precision).
func checkM4B(path string, want []Chapter) error {
	got, err := ReadM4BChapters(path)
	if err != nil {
		return fmt.Errorf("FFmpeg wrote a file the app cannot read its chapters back from: %w", err)
	}
	if len(got) != len(want) {
		return fmt.Errorf("FFmpeg wrote %d chapter(s), not %d", len(got), len(want))
	}
	const tolerance = time.Millisecond
	for i, w := range want {
		g := got[i]
		if absDuration(g.Start-w.Start) > tolerance || absDuration(g.End-w.End) > tolerance {
			return fmt.Errorf("chapter %d (%q) was written at %v-%v, not %v-%v", i+1, w.Title, g.Start, g.End, w.Start, w.End)
		}
	}
	return nil
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// ReadM4BChapters reads back the chapters embedded in path's audio track: the QuickTime "chapters" text track its tref/chap
// box names, laid out by that track's own timescale (mdia/mdhd) and per-sample durations (mdia/minf/stbl/stts) - the same
// "ipod"/mp4-muxer shape m4bArgs asks FFmpeg to write. It answers each chapter's Start and End (Title is always empty: this
// reader does not decode the text track's own samples, which no caller of it today needs). A file with no chapter track (an
// m4b encoded with none asked for) answers (nil, nil), not an error.
func ReadM4BChapters(path string) ([]Chapter, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	moovs, err := mp4Find(data, "moov")
	if err != nil {
		return nil, err
	}
	if len(moovs) != 1 {
		return nil, fmt.Errorf("%s: has %d moov box(es), want 1", path, len(moovs))
	}
	traks, err := mp4Find(moovs[0], "trak")
	if err != nil {
		return nil, err
	}
	chapterTrackID, ok, err := audioChapterTrackID(traks)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	chapterTrack, err := findTrackByID(traks, chapterTrackID)
	if err != nil {
		return nil, err
	}
	timescale, err := mdhdTimescale(chapterTrack)
	if err != nil {
		return nil, err
	}
	durations, err := sttsDurations(chapterTrack)
	if err != nil {
		return nil, err
	}
	chapters := make([]Chapter, len(durations))
	var cursor time.Duration
	for i, ticks := range durations {
		d := time.Duration(int64(ticks) * int64(time.Second) / int64(timescale))
		chapters[i] = Chapter{Start: cursor, End: cursor + d}
		cursor += d
	}
	return chapters, nil
}

// audioChapterTrackID is the track ID the program's one audio (handler type "soun") track names in its own tref/chap box, and
// whether it names one at all. It errors only on a structurally broken moov (no audio track, or one whose boxes don't parse),
// never on a merely chapterless one.
func audioChapterTrackID(traks [][]byte) (id uint32, ok bool, err error) {
	sawAudio := false
	for _, trak := range traks {
		handler, err := handlerType(trak)
		if err != nil {
			return 0, false, err
		}
		if handler != "soun" {
			continue
		}
		sawAudio = true
		refs, err := mp4Find(trak, "tref", "chap")
		if err != nil {
			return 0, false, err
		}
		if len(refs) != 1 || len(refs[0]) < 4 {
			continue // this audio track names no chapter track
		}
		return binary.BigEndian.Uint32(refs[0][0:4]), true, nil
	}
	if !sawAudio {
		return 0, false, errors.New("no audio (soun) track")
	}
	return 0, false, nil
}

func findTrackByID(traks [][]byte, id uint32) ([]byte, error) {
	for _, trak := range traks {
		got, err := trackID(trak)
		if err != nil {
			return nil, err
		}
		if got == id {
			return trak, nil
		}
	}
	return nil, fmt.Errorf("no track with ID %d, named by the audio track's own chapter reference", id)
}

func trackID(trak []byte) (uint32, error) {
	tkhds, err := mp4Find(trak, "tkhd")
	if err != nil {
		return 0, err
	}
	if len(tkhds) != 1 {
		return 0, errors.New("a trak has no well-formed tkhd")
	}
	// tkhd (ISO/IEC 14496-12 8.3.2): version/flags(4), then creation_time and modification_time (4 bytes each in version 0,
	// 8 each in version 1), then track_ID: offset 12 in version 0, 20 in version 1.
	return fullBoxUint32(tkhds[0], 12, 20)
}

func handlerType(trak []byte) (string, error) {
	hdlrs, err := mp4Find(trak, "mdia", "hdlr")
	if err != nil {
		return "", err
	}
	if len(hdlrs) != 1 || len(hdlrs[0]) < 12 {
		return "", errors.New("a trak's mdia has no well-formed hdlr")
	}
	return string(hdlrs[0][8:12]), nil
}

func mdhdTimescale(trak []byte) (uint32, error) {
	mdhds, err := mp4Find(trak, "mdia", "mdhd")
	if err != nil {
		return 0, err
	}
	if len(mdhds) != 1 {
		return 0, errors.New("a trak's mdia has no well-formed mdhd")
	}
	// mdhd (ISO/IEC 14496-12 8.4.2) lays out the same way tkhd does: timescale follows creation_time and modification_time, at
	// offset 12 in version 0, 20 in version 1.
	timescale, err := fullBoxUint32(mdhds[0], 12, 20)
	if err != nil {
		return 0, err
	}
	if timescale == 0 {
		return 0, errors.New("mdhd declares a zero timescale")
	}
	return timescale, nil
}

// fullBoxUint32 reads the uint32 at version0Offset in a version-0 full box (after its 4-byte version/flags header), or at
// version1Offset in a version-1 one (which widens the fields ahead of it to 64 bits): tkhd's track_ID and mdhd's timescale are
// both laid out this way (ISO/IEC 14496-12).
func fullBoxUint32(payload []byte, version0Offset, version1Offset int) (uint32, error) {
	if len(payload) == 0 {
		return 0, errors.New("an empty full box")
	}
	offset := version0Offset
	if payload[0] == 1 {
		offset = version1Offset
	}
	if len(payload) < offset+4 {
		return 0, fmt.Errorf("a full box is %d bytes, too short for its own version %d", len(payload), payload[0])
	}
	return binary.BigEndian.Uint32(payload[offset : offset+4]), nil
}

// sttsDurations is a track's sample durations, in its own timescale's ticks, in sample order (ISO/IEC 14496-12 "Time-to-sample
// box"): one entry per sample, expanded from stts's run-length (count, delta) pairs.
func sttsDurations(trak []byte) ([]uint32, error) {
	sttss, err := mp4Find(trak, "mdia", "minf", "stbl", "stts")
	if err != nil {
		return nil, err
	}
	if len(sttss) != 1 || len(sttss[0]) < 8 {
		return nil, errors.New("a trak's stbl has no well-formed stts")
	}
	stts := sttss[0]
	count := binary.BigEndian.Uint32(stts[4:8])
	if need := 8 + int(count)*8; len(stts) < need {
		return nil, fmt.Errorf("stts declares %d entries but has room for fewer", count)
	}
	var durations []uint32
	for i := range int(count) {
		off := 8 + i*8
		sampleCount := binary.BigEndian.Uint32(stts[off : off+4])
		delta := binary.BigEndian.Uint32(stts[off+4 : off+8])
		for range int(sampleCount) {
			durations = append(durations, delta)
		}
	}
	return durations, nil
}

// mp4Box is one ISO base media box (ISO/IEC 14496-12): typ is its four-character type, and payload everything after its
// header (its 64-bit size variant is a header FFmpeg's own muxers don't write for the small boxes this reader looks inside,
// so mp4Boxes accepts it at the top level only, where a large mdat can need it).
type mp4Box struct {
	typ     string
	payload []byte
}

// mp4Boxes parses data as a flat sequence of boxes, refusing one whose declared size does not fit in what remains rather than
// reading past it.
func mp4Boxes(data []byte) ([]mp4Box, error) {
	var boxes []mp4Box
	for len(data) > 0 {
		if len(data) < 8 {
			return nil, fmt.Errorf("a box header needs 8 bytes, %d remain", len(data))
		}
		size := uint64(binary.BigEndian.Uint32(data[0:4]))
		typ := string(data[4:8])
		header := 8
		switch size {
		case 0:
			size = uint64(len(data))
		case 1:
			if len(data) < 16 {
				return nil, fmt.Errorf("box %q declares a 64-bit size but has no room for it", typ)
			}
			size = binary.BigEndian.Uint64(data[8:16])
			header = 16
		}
		if size < uint64(header) || size > uint64(len(data)) {
			return nil, fmt.Errorf("box %q declares size %d, but %d byte(s) remain", typ, size, len(data))
		}
		boxes = append(boxes, mp4Box{typ: typ, payload: data[header:size]})
		data = data[size:]
	}
	return boxes, nil
}

// mp4Find walks path, a sequence of box types each a direct child of the last, from data's own top-level boxes, and answers
// the payload of every box found at that path (there can be more than one trak, for example).
func mp4Find(data []byte, path ...string) ([][]byte, error) {
	payloads := [][]byte{data}
	for _, name := range path {
		var next [][]byte
		for _, p := range payloads {
			boxes, err := mp4Boxes(p)
			if err != nil {
				return nil, err
			}
			for _, b := range boxes {
				if b.typ == name {
					next = append(next, b.payload)
				}
			}
		}
		payloads = next
	}
	return payloads, nil
}
