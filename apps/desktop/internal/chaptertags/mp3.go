// Package chaptertags is the host's local-file half of Phase 12 (chapter tag embedding) of the
// reaper-automation-follow-through PRD. It never talks to REAPER or the bridge: it reads already-rendered MP3
// files, computes a chapter timeline from them, and writes ID3v2 CHAP/CTOC frames into a NEW copy of a
// narrator-supplied MP3 - never the file it is given, and never the per-chapter render files it reads durations
// from. See docs/adr/0099-chapter-tags-are-embedded-with-bogem-id3v2-and-a-hand-built-ctoc-frame.md for why
// bogem/id3v2 (MIT) was picked and why CTOC is built by hand.
package chaptertags

import (
	"fmt"
	"os"
	"time"
)

// mpegVersion and mpegLayer identify which bitrate/sample-rate table and samples-per-frame constant apply to a
// parsed frame header (ISO/IEC 11172-3, ISO/IEC 13818-3).
type mpegVersion int

const (
	mpegVersion1 mpegVersion = iota
	mpegVersion2
	mpegVersion25
)

type mpegLayer int

const (
	layerI mpegLayer = iota
	layerII
	layerIII
)

// bitrateTableKbps maps [version][layer] to the 14 non-zero, non-"free" bitrate index values (kbps), index 0 of
// the returned slice is bitrate index 1.
var bitrateTableKbps = map[mpegVersion]map[mpegLayer][]int{
	mpegVersion1: {
		layerI:   {32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448},
		layerII:  {32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384},
		layerIII: {32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320},
	},
	mpegVersion2: {
		layerI:   {32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256},
		layerII:  {8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
		layerIII: {8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160},
	},
}

var sampleRateTable = map[mpegVersion][]int{
	mpegVersion1:  {44100, 48000, 32000},
	mpegVersion2:  {22050, 24000, 16000},
	mpegVersion25: {11025, 12000, 8000},
}

func samplesPerFrame(version mpegVersion, layer mpegLayer) int {
	switch {
	case layer == layerI:
		return 384
	case layer == layerII:
		return 1152
	case version == mpegVersion1: // Layer III, MPEG1
		return 1152
	default: // Layer III, MPEG2/2.5
		return 576
	}
}

// frameSizeConstant and frameSlotSize give the two per-layer constants the MPEG frame-size formula needs:
// FrameSize = (constant * bitrate / sampleRate + padding) * slotSize (ISO/IEC 11172-3 2.4.3.1, 13818-3).
func frameSizeConstant(version mpegVersion, layer mpegLayer) (constant, slotSize int) {
	switch {
	case layer == layerI:
		return 12, 4
	case version == mpegVersion1: // Layer II or III, MPEG1
		return 144, 1
	default: // Layer II or III, MPEG2/2.5
		if layer == layerII {
			return 144, 1
		}
		return 72, 1
	}
}

// frameHeader is what mp3Duration needs from one parsed 4-byte MPEG audio frame header.
type frameHeader struct {
	sampleRate int
	samples    int
	sizeBytes  int
}

// parseFrameHeader reads the 4 header bytes at the front of header and reports whether they form a valid MPEG
// audio frame header this package understands (Layer I, II or III; any of MPEG 1, 2 or 2.5).
func parseFrameHeader(header []byte) (frameHeader, bool) {
	if len(header) < 4 || header[0] != 0xFF || header[1]&0xE0 != 0xE0 {
		return frameHeader{}, false
	}
	versionBits := (header[1] >> 3) & 0x03
	layerBits := (header[1] >> 1) & 0x03
	bitrateIndex := (header[2] >> 4) & 0x0F
	sampleRateIndex := (header[2] >> 2) & 0x03
	padding := (header[2] >> 1) & 0x01

	var version mpegVersion
	switch versionBits {
	case 0b11:
		version = mpegVersion1
	case 0b10:
		version = mpegVersion2
	case 0b00:
		version = mpegVersion25
	default:
		return frameHeader{}, false // reserved
	}

	var layer mpegLayer
	switch layerBits {
	case 0b11:
		layer = layerI
	case 0b10:
		layer = layerII
	case 0b01:
		layer = layerIII
	default:
		return frameHeader{}, false // reserved
	}

	if bitrateIndex == 0 || bitrateIndex == 0x0F || sampleRateIndex == 0x03 {
		return frameHeader{}, false // free/bad bitrate, or a reserved sample rate
	}

	rates, ok := sampleRateTable[version]
	if !ok || int(sampleRateIndex) >= len(rates) {
		return frameHeader{}, false
	}
	sampleRate := rates[sampleRateIndex]

	bitrateVersion := version
	if bitrateVersion == mpegVersion25 {
		bitrateVersion = mpegVersion2 // MPEG2 and 2.5 share one bitrate table
	}
	bitrates, ok := bitrateTableKbps[bitrateVersion][layer]
	if !ok || int(bitrateIndex-1) >= len(bitrates) {
		return frameHeader{}, false
	}
	bitrateBps := bitrates[bitrateIndex-1] * 1000

	samples := samplesPerFrame(version, layer)
	constant, slotSize := frameSizeConstant(version, layer)
	size := (constant*bitrateBps/sampleRate + int(padding)) * slotSize
	if size <= 0 {
		return frameHeader{}, false
	}
	return frameHeader{sampleRate: sampleRate, samples: samples, sizeBytes: size}, true
}

// id3v2HeaderSize returns the number of bytes the leading ID3v2 tag occupies (10-byte header plus its syncsafe
// size), or 0 when data does not start with one.
func id3v2HeaderSize(data []byte) int {
	if len(data) < 10 || data[0] != 'I' || data[1] != 'D' || data[2] != '3' {
		return 0
	}
	size := int(data[6]&0x7F)<<21 | int(data[7]&0x7F)<<14 | int(data[8]&0x7F)<<7 | int(data[9]&0x7F)
	return 10 + size
}

// mp3Duration estimates an MP3 file's playback duration by summing every MPEG audio frame's sample count over its
// sample rate. It is an estimate, not a frame-accurate decode: an encoder's leading Xing/LAME info frame (muted
// audio, present in most encoders' output whether or not the stream is CBR) is counted like any other frame, and
// any trailing ID3v1/APE tag bytes are skipped by frame resync rather than parsed. That is enough precision for
// building a chapter timeline; it is not used to prove sample-accurate seeking.
func mp3Duration(path string) (time.Duration, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, fmt.Errorf("could not read %q: %w", path, err)
	}
	offset := id3v2HeaderSize(data)
	var totalSamples int64
	var sampleRate int
	for offset+4 <= len(data) {
		header, ok := parseFrameHeader(data[offset : offset+4])
		if !ok {
			offset++
			continue
		}
		if sampleRate == 0 {
			sampleRate = header.sampleRate
		}
		totalSamples += int64(header.samples)
		offset += header.sizeBytes
	}
	if sampleRate == 0 {
		return 0, fmt.Errorf("no MPEG audio frames found in %q; it may not be an MP3 file", path)
	}
	return time.Duration(float64(totalSamples) / float64(sampleRate) * float64(time.Second)), nil
}
