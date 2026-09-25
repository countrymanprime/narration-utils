package measure

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
)

// The MP3 container check (delivery profiles PRD, Phase 6): the frame headers of an MPEG audio Layer III file are read
// for what a platform asks of the uploaded file (bitrate, constant bit rate, sample rate, channel mode and length).
// The audio itself is never decoded, so no level is measured on an MP3 (diagnostics PRD, DX-2). The bytes are
// untrusted: every read is bounded, a header found by searching is believed only when the next frame starts where it
// says, and a file that is not a run of Layer III frames is refused with the reason.

const (
	// maxResyncBytes is how far the reader searches for a frame where the previous one did not lead (padding, a stray
	// tag); beyond it the file is refused.
	maxResyncBytes = 64 << 10
	// maxLostBytes bounds the bytes a whole file may hold between frames.
	maxLostBytes = 1 << 20
	// id3v1Bytes is the size of an ID3v1 tag, which may close the file ("TAG").
	id3v1Bytes = 128
	// frameHeaderBytes is an MPEG audio frame header.
	frameHeaderBytes = 4
	// mp3ProgressFrames is how many frames are read between progress reports and checks of ctx.
	mp3ProgressFrames = 2048
)

// MP3Info is what the frame headers of an MP3 say. BitrateKbps is the bitrate of every audio frame when the file is
// constant bit rate (CBR), and 0 otherwise; AverageBitrateKbps is the audio bytes over the length. VBRTag names a
// Xing, Info or VBRI header in the first frame ("" when there is none): "Info" is the LAME tag of a CBR file, the
// others mark a variable bit rate. Frames counts the audio frames, not the tag frame. LostBytes counts bytes between
// frames that were skipped (a damaged or padded file).
type MP3Info struct {
	Version            string  `json:"version"`
	Layer              int     `json:"layer"`
	BitrateKbps        int     `json:"bitrate_kbps"`
	AverageBitrateKbps float64 `json:"average_bitrate_kbps"`
	CBR                bool    `json:"cbr"`
	VBRTag             string  `json:"vbr_tag"`
	SampleRate         int     `json:"sample_rate"`
	ChannelMode        string  `json:"channel_mode"`
	Frames             int64   `json:"frames"`
	DurationSeconds    float64 `json:"duration_seconds"`
	ID3v2Bytes         int64   `json:"id3v2_bytes"`
	LostBytes          int64   `json:"lost_bytes"`
}

// Channels is how many channels the channel mode carries.
func (i MP3Info) Channels() int {
	if i.ChannelMode == "mono" {
		return 1
	}
	return 2
}

// ErrNotMP3 is the answer for bytes that hold no run of MPEG audio frames.
var ErrNotMP3 = errors.New("no MPEG audio frames were found: not an MP3, or an MP3 holding only a tag")

// mp3Header is one decoded frame header.
type mp3Header struct {
	version      int // 1 for MPEG-1, 2 for MPEG-2, 25 for MPEG-2.5
	bitrateKbps  int
	sampleRate   int
	channelMode  int // 0 stereo, 1 joint stereo, 2 dual channel, 3 mono
	frameBytes   int
	samples      int // per frame
	sideInfoSize int
}

var (
	// Layer III bitrates in kbps by index, MPEG-1 and MPEG-2/2.5 (ISO/IEC 11172-3, 13818-3). Index 0 is free format,
	// index 15 invalid: both are refused.
	mp3BitratesV1 = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
	mp3BitratesV2 = [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}
	mp3Rates      = map[int][3]int{1: {44100, 48000, 32000}, 2: {22050, 24000, 16000}, 25: {11025, 12000, 8000}}
	mp3Modes      = [4]string{"stereo", "joint_stereo", "dual_channel", "mono"}
)

var errNoSync = errors.New("no frame sync")

// parseMP3Header decodes a 4-byte frame header, or says why it is not a Layer III header this check reads.
func parseMP3Header(b []byte) (mp3Header, error) {
	word := binary.BigEndian.Uint32(b)
	if word>>21 != 0x7ff {
		return mp3Header{}, errNoSync
	}
	var h mp3Header
	switch (word >> 19) & 3 {
	case 0:
		h.version = 25
	case 2:
		h.version = 2
	case 3:
		h.version = 1
	default:
		return mp3Header{}, errors.New("a reserved MPEG version")
	}
	if (word>>17)&3 != 1 {
		return mp3Header{}, errors.New("MPEG audio, but not Layer III")
	}
	index := (word >> 12) & 15
	if index == 0 || index == 15 {
		return mp3Header{}, errors.New("a free-format or invalid bitrate")
	}
	rateIndex := (word >> 10) & 3
	if rateIndex == 3 {
		return mp3Header{}, errors.New("a reserved sample rate")
	}
	h.sampleRate = mp3Rates[h.version][rateIndex]
	pad := int((word >> 9) & 1)
	h.channelMode = int((word >> 6) & 3)
	mono := h.channelMode == 3
	if h.version == 1 {
		h.bitrateKbps, h.samples = mp3BitratesV1[index], 1152
		h.frameBytes = 144*h.bitrateKbps*1000/h.sampleRate + pad
		h.sideInfoSize = map[bool]int{false: 32, true: 17}[mono]
	} else {
		h.bitrateKbps, h.samples = mp3BitratesV2[index], 576
		h.frameBytes = 72*h.bitrateKbps*1000/h.sampleRate + pad
		h.sideInfoSize = map[bool]int{false: 17, true: 9}[mono]
	}
	return h, nil
}

func (h mp3Header) versionName() string {
	switch h.version {
	case 1:
		return "MPEG-1"
	case 2:
		return "MPEG-2"
	}
	return "MPEG-2.5"
}

// sameStream reports whether next may belong to the stream h started: the same version, sample rate and channel mode.
func (h mp3Header) sameStream(next mp3Header) bool {
	return h.version == next.version && h.sampleRate == next.sampleRate && h.channelMode == next.channelMode
}

// vbrTagOf names the Xing, Info or VBRI header a first frame holds, or "".
func vbrTagOf(h mp3Header, frame []byte) string {
	at := frameHeaderBytes + h.sideInfoSize
	if len(frame) >= at+4 {
		if tag := string(frame[at : at+4]); tag == "Xing" || tag == "Info" {
			return tag
		}
	}
	if len(frame) >= 40 && string(frame[36:40]) == "VBRI" {
		return "VBRI"
	}
	return ""
}

// mp3Reader walks the frames of an MP3 from a buffered stream.
type mp3Reader struct {
	r      *bufio.Reader
	offset int64 // bytes consumed
	lost   int64 // bytes skipped between frames
}

func (m *mp3Reader) discard(n int64) error {
	for n > 0 {
		step := int(min(n, 1<<20))
		skipped, err := m.r.Discard(step)
		m.offset += int64(skipped)
		if err != nil {
			return err
		}
		n -= int64(step)
	}
	return nil
}

// skipID3v2 steps over an ID3v2 tag at the start ("ID3", version, flags, a syncsafe size, and a footer when flagged),
// answering its size in bytes.
func (m *mp3Reader) skipID3v2() (int64, error) {
	head, _ := m.r.Peek(10)
	if len(head) < 10 || string(head[:3]) != "ID3" {
		return 0, nil
	}
	var size int64
	for _, b := range head[6:10] {
		if b&0x80 != 0 {
			return 0, errors.New("the ID3v2 tag's size is not a syncsafe number")
		}
		size = size<<7 | int64(b)
	}
	size += 10
	if head[5]&0x10 != 0 {
		size += 10
	}
	if err := m.discard(size); err != nil {
		return 0, errors.New("the file ends inside its ID3v2 tag")
	}
	return size, nil
}

// atClosingTag reports whether the stream now holds a closing tag: an ID3v1 tag that is the last 128 bytes, or an APE
// tag (which encoders write before an ID3v1 tag). Either ends the audio.
func (m *mp3Reader) atClosingTag() bool {
	head, _ := m.r.Peek(id3v1Bytes + 1)
	if len(head) == id3v1Bytes && string(head[:3]) == "TAG" {
		return true
	}
	return len(head) >= 8 && string(head[:8]) == "APETAGEX"
}

// nextFrame answers the next frame header and its bytes. A frame right after the previous one is trusted; one found
// by searching (the first, or after skipped bytes) must be followed by another frame of the same stream. io.EOF means
// the audio ended: at the end of the file, at a closing tag, or in a last frame cut short (counted as lost).
func (m *mp3Reader) nextFrame(first *mp3Header) (mp3Header, []byte, error) {
	var problem error // why the bytes at the first sync were not read, for a file with no frame at all
	for searched := 0; ; searched++ {
		head, _ := m.r.Peek(frameHeaderBytes)
		if len(head) < frameHeaderBytes {
			if first == nil {
				return mp3Header{}, nil, notMP3(problem)
			}
			m.lost += int64(len(head))
			return mp3Header{}, nil, io.EOF
		}
		if first != nil && m.atClosingTag() {
			return mp3Header{}, nil, io.EOF
		}
		h, err := parseMP3Header(head)
		if err == nil && (first == nil || first.sameStream(h)) {
			frame, _ := m.r.Peek(h.frameBytes)
			switch {
			case len(frame) < h.frameBytes && first != nil:
				m.lost += int64(len(frame))
				return mp3Header{}, nil, io.EOF
			case len(frame) == h.frameBytes && ((first != nil && searched == 0) || m.followed(h, first != nil)):
				return h, frame, nil
			}
		} else if err != nil && !errors.Is(err, errNoSync) && problem == nil {
			problem = err
		}
		if searched >= maxResyncBytes {
			if first == nil {
				return mp3Header{}, nil, notMP3(problem)
			}
			return mp3Header{}, nil, fmt.Errorf("the frames stop at byte %d and do not resume within %d KiB", m.offset, maxResyncBytes>>10)
		}
		if err := m.discard(1); err != nil {
			return mp3Header{}, nil, err
		}
		m.lost++
		if m.lost > maxLostBytes {
			return mp3Header{}, nil, fmt.Errorf("more than %d KiB lie between frames: the file is damaged", maxLostBytes>>10)
		}
	}
}

// followed reports whether another frame of h's stream starts where h ends. At the very end of the stream, a frame
// of a stream already begun counts as followed; a first frame never does, so one stray sync is not an MP3.
func (m *mp3Reader) followed(h mp3Header, begun bool) bool {
	next, _ := m.r.Peek(h.frameBytes + frameHeaderBytes)
	if len(next) < h.frameBytes+frameHeaderBytes {
		return begun && len(next) == h.frameBytes
	}
	following, err := parseMP3Header(next[h.frameBytes:])
	return err == nil && h.sameStream(following)
}

func notMP3(problem error) error {
	if problem != nil {
		return fmt.Errorf("%w (the frames found are %v)", ErrNotMP3, problem)
	}
	return ErrNotMP3
}

// ReadMP3 reads the frame headers of an MP3 from r, checking ctx and telling progress the bytes read every few thousand
// frames. It decodes no audio.
func ReadMP3(ctx context.Context, r io.Reader, progress func(done int64)) (MP3Info, error) {
	m := &mp3Reader{r: bufio.NewReaderSize(r, 1<<16)}
	id3, err := m.skipID3v2()
	if err != nil {
		return MP3Info{}, err
	}
	info := MP3Info{ID3v2Bytes: id3, Layer: 3, CBR: true}
	var first *mp3Header
	var audioBytes, samples int64
	for read := int64(0); ; read++ {
		if read%mp3ProgressFrames == 0 {
			if err := ctx.Err(); err != nil {
				return MP3Info{}, err
			}
			if progress != nil {
				progress(m.offset)
			}
		}
		h, frame, err := m.nextFrame(first)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return MP3Info{}, err
		}
		if first == nil {
			first = &h
			info.Version, info.SampleRate, info.ChannelMode = h.versionName(), h.sampleRate, mp3Modes[h.channelMode]
			if tag := vbrTagOf(h, frame); tag != "" {
				// The tag frame holds no audio: it is not counted, and its bitrate says nothing about the stream.
				info.VBRTag = tag
				if err := m.discard(int64(h.frameBytes)); err != nil {
					return MP3Info{}, err
				}
				continue
			}
		}
		if info.Frames == 0 {
			info.BitrateKbps = h.bitrateKbps
		} else if h.bitrateKbps != info.BitrateKbps {
			info.CBR = false
		}
		info.Frames++
		samples += int64(h.samples)
		audioBytes += int64(h.frameBytes)
		if err := m.discard(int64(h.frameBytes)); err != nil {
			return MP3Info{}, err
		}
	}
	if info.Frames == 0 {
		return MP3Info{}, ErrNotMP3
	}
	if info.VBRTag == "Xing" || info.VBRTag == "VBRI" {
		info.CBR = false
	}
	if !info.CBR {
		info.BitrateKbps = 0
	}
	info.LostBytes = m.lost
	info.DurationSeconds = float64(samples) / float64(info.SampleRate)
	info.AverageBitrateKbps = math.Round(float64(audioBytes)*8/info.DurationSeconds/100) / 10
	if progress != nil {
		progress(m.offset)
	}
	return info, nil
}

// looksLikeMP3 reports whether a file's first bytes are an ID3v2 tag or an MPEG audio frame sync, so the measurement
// reads it as an MP3 rather than a WAV.
func looksLikeMP3(head []byte) bool {
	if len(head) >= 3 && string(head[:3]) == "ID3" {
		return true
	}
	return len(head) >= 2 && head[0] == 0xff && head[1]&0xe0 == 0xe0
}

// mp3Report is the report of an MP3: its format and length from the headers, and every level unmeasured (null),
// since the audio is not decoded.
func mp3Report(info MP3Info) Report {
	return Report{
		SampleRate: info.SampleRate, Channels: info.Channels(), DurationSeconds: info.DurationSeconds,
		ClipRuns: []ClipRun{}, MP3: &info,
	}
}
