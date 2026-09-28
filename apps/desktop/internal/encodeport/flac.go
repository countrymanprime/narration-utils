package encodeport

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"

	"github.com/countrymanprime/narration-utils/shell/internal/measure"
)

// FLAC output (render-encode-master Phase 7, Could/Q7): FFmpeg's own native "flac" encoder writes a lossless file - there is no
// bitrate to ask for, and no MPEG-1-style sample-rate restriction to work around (mp3Spec's own concern). encodeFLAC (ffmpeg.go)
// follows the same chain of custody as MP3 and M4B: a dot-named partial beside dst, checked before it is kept, removed on any
// failure, timeout or cancel. checkFLAC reads back the STREAMINFO metadata block FLAC requires to be first (RFC 9639 §8.1-8.2)
// -the sample rate, channel count and sample count FFmpeg actually wrote - rather than trusting what was asked for, mirroring
// checkMP3 and checkM4B; it never reads the audio frames that follow.

// flacMagic is a FLAC stream's fixed four-byte marker (RFC 9639 §8.1).
const flacMagic = "fLaC"

// flacStreamInfoSize is STREAMINFO's fixed body length (RFC 9639 §8.2): 34 bytes after its own 4-byte metadata block header.
const flacStreamInfoSize = 34

// flacInfo is what a FLAC file's own STREAMINFO block says it holds.
type flacInfo struct {
	SampleRate    int
	Channels      int
	BitsPerSample int
	TotalSamples  uint64
}

// flacSpec refuses a Spec no FLAC encode can honor: FLAC is lossless, so a bitrate has no meaning, and this encoder writes only
// the mono/stereo narration this app records (the same channel restriction mp3Spec and m4bSpec already apply).
func flacSpec(spec *Spec) error {
	if spec.BitrateKbps != 0 {
		return fmt.Errorf("FLAC is lossless; a bitrate has no meaning for it, got %d kbps", spec.BitrateKbps)
	}
	if spec.Channels < 0 || spec.Channels > 2 {
		return fmt.Errorf("a FLAC encode holds one or two channels, not %d", spec.Channels)
	}
	if spec.SampleRateHz < 0 {
		return fmt.Errorf("a FLAC sample rate must be positive, not %d Hz", spec.SampleRateHz)
	}
	return nil
}

// flacArgs is the command line of one FLAC encode: the WAV's first audio stream, FFmpeg's native lossless "flac" encoder, with
// machine-readable progress on stdout. Paths reach FFmpeg the same way mp3Args's and m4bArgs's do: absolute, through the file
// protocol, with every other protocol refused, so neither can be read as an option ("-...") or as a URL FFmpeg would fetch or
// expand ("http:", "concat:", ...).
func flacArgs(wav, out string, spec Spec) []string {
	args := []string{
		"-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
		"-protocol_whitelist", "file", "-i", fileURL(wav), "-map", "0:a:0", "-map_metadata", "-1", "-c:a", "flac",
	}
	if spec.SampleRateHz != 0 {
		args = append(args, "-ar", strconv.Itoa(spec.SampleRateHz))
	}
	if spec.Channels != 0 {
		args = append(args, "-ac", strconv.Itoa(spec.Channels))
	}
	return append(args, "-f", "flac", "-y", fileURL(out))
}

// checkFLAC reads path's STREAMINFO block and refuses it unless it is a well-formed FLAC holding some audio at the sample rate
// and channel count that was asked for (source's own, when spec left either open, since FLAC has no rate restriction to work
// around).
func checkFLAC(path string, spec Spec, source measure.Format) error {
	info, err := readFLACStreamInfo(path)
	if err != nil {
		return fmt.Errorf("FFmpeg wrote a file the app cannot read as FLAC: %w", err)
	}
	wantRate := spec.SampleRateHz
	if wantRate == 0 {
		wantRate = source.SampleRate
	}
	wantChannels := spec.Channels
	if wantChannels == 0 {
		wantChannels = source.Channels
	}
	switch {
	case info.SampleRate != wantRate:
		return fmt.Errorf("FFmpeg wrote a FLAC at %d Hz, not %d Hz", info.SampleRate, wantRate)
	case info.Channels != wantChannels:
		return fmt.Errorf("FFmpeg wrote a FLAC with %d channel(s), not %d", info.Channels, wantChannels)
	case info.TotalSamples == 0:
		return errors.New("FFmpeg wrote a FLAC with no samples")
	}
	return nil
}

// readFLACStreamInfo reads only path's magic and its first metadata block: FLAC requires STREAMINFO to be that first block, so
// this never reads past the file's own fixed-size header, however long its audio is (mirroring checkMP3's and checkM4B's own
// bounded reads).
func readFLACStreamInfo(path string) (flacInfo, error) {
	file, err := os.Open(path)
	if err != nil {
		return flacInfo{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	header := make([]byte, len(flacMagic)+4+flacStreamInfoSize)
	if _, err := io.ReadFull(file, header); err != nil {
		return flacInfo{}, fmt.Errorf("too short to be a FLAC file: %w", err)
	}
	if string(header[:len(flacMagic)]) != flacMagic {
		return flacInfo{}, fmt.Errorf(`does not start with the FLAC marker %q`, flacMagic)
	}
	blockHeader := header[len(flacMagic) : len(flacMagic)+4]
	if blockType := blockHeader[0] & 0x7F; blockType != 0 {
		return flacInfo{}, fmt.Errorf("its first metadata block is type %d, not STREAMINFO (0)", blockType)
	}
	length := uint32(blockHeader[1])<<16 | uint32(blockHeader[2])<<8 | uint32(blockHeader[3])
	if length != flacStreamInfoSize {
		return flacInfo{}, fmt.Errorf("its STREAMINFO block is %d bytes, not %d", length, flacStreamInfoSize)
	}

	// STREAMINFO (RFC 9639 §8.2): after min/max block size (2+2 bytes) and min/max frame size (3+3 bytes, the first 10 bytes of
	// the block's body), a packed 64-bit field holds sample rate (20 bits), channels-1 (3 bits), bits-per-sample-1 (5 bits) and
	// total samples (36 bits) - 64 bits exactly.
	body := header[len(flacMagic)+4:]
	packed := binary.BigEndian.Uint64(body[10:18])
	return flacInfo{
		SampleRate:    int(packed >> 44),
		Channels:      int((packed>>41)&0x7) + 1,
		BitsPerSample: int((packed>>36)&0x1F) + 1,
		TotalSamples:  packed & 0xFFFFFFFFF,
	}, nil
}
