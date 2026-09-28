package recording

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
)

// FolderName is the take folder inside a project (Q4, answered by D86: the `<project>/<Feature>/` convention, as
// TranscriptCompare and ManuscriptGuide use), holding plain WAV takes a narrator can drag into a DAW.
const FolderName = "Recordings"

const (
	finishedSuffix = ".wav"
	partialSuffix  = ".partial.wav"
)

var takeFile = regexp.MustCompile(`^Take (\d{3,})(\.partial)?\.wav$`)

// Take is one take file in the folder.
type Take struct {
	Name       string  `json:"name"`
	Path       string  `json:"path"`
	Seconds    float64 `json:"seconds"`
	SampleRate int     `json:"sampleRate"`
	Channels   int     `json:"channels"`
	Bits       int     `json:"bits"`
	// RecordedAt is the file's modification time, Unix milliseconds.
	RecordedAt int64 `json:"recordedAt"`
	// Unfinished marks a partial file left by a take whose engine ended without finishing it.
	Unfinished bool `json:"unfinished"`
	// LineID is the take's composed line identity (ComposeLineID), or nil when it carries none yet. It is read
	// from the folder's line-identity sidecar (identity.go), the native-take equivalent of a REAPER item's stamped
	// P_EXT line id (docs/adr/0026).
	LineID *string `json:"lineId"`
	number int
}

// takeName is "Take 004" for number 4.
func takeName(number int) string { return fmt.Sprintf("Take %03d", number) }

func finishedPath(folder string, number int) string {
	return filepath.Join(folder, takeName(number)+finishedSuffix)
}

func partialPath(folder string, number int) string {
	return filepath.Join(folder, takeName(number)+partialSuffix)
}

// listTakes reads folder's takes, oldest number first. A missing folder has none. except is a partial being recorded
// now, which is not a take yet. A file whose header cannot be read is still listed, with no format: it is the
// narrator's file and they should see it.
func listTakes(folder, except string) ([]Take, int, error) {
	entries, err := os.ReadDir(folder)
	if errors.Is(err, os.ErrNotExist) {
		return []Take{}, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	takes := []Take{}
	highest := 0
	identities := readIdentities(folder)
	for _, entry := range entries {
		match := takeFile.FindStringSubmatch(entry.Name())
		if match == nil || entry.IsDir() {
			continue
		}
		number, err := strconv.Atoi(match[1])
		if err != nil {
			continue
		}
		highest = max(highest, number)
		path := filepath.Join(folder, entry.Name())
		if path == except {
			continue
		}
		take := Take{Name: takeName(number), Path: path, Unfinished: match[2] != "", number: number}
		if info, err := entry.Info(); err == nil {
			take.RecordedAt = info.ModTime().UnixMilli()
		}
		if format, err := readWavFormat(path); err == nil {
			take.SampleRate, take.Channels, take.Bits, take.Seconds = format.sampleRate, format.channels, format.bits, format.seconds()
		}
		if lineID, ok := identities[take.Name]; ok {
			take.LineID = &lineID
		}
		takes = append(takes, take)
	}
	sort.SliceStable(takes, func(i, j int) bool {
		if takes[i].number != takes[j].number {
			return takes[i].number < takes[j].number
		}
		return !takes[i].Unfinished // a finished take before a partial of the same number
	})
	return takes, highest, nil
}

// finish gives a finished partial its take name without ever replacing a file: a hard link fails when the name exists,
// so the finished name appears only with this file. Where the volume cannot link (FAT, some network shares) it falls
// back to a rename after checking the name is free, which leaves only a narrow race on a volume nothing else writes to.
func finish(partial, final string) error {
	if err := os.Link(partial, final); err == nil {
		return os.Remove(partial)
	} else if errors.Is(err, os.ErrExist) {
		return fmt.Errorf("%s already exists, so the take stays as %s", filepath.Base(final), filepath.Base(partial))
	}
	if _, err := os.Lstat(final); err == nil {
		return fmt.Errorf("%s already exists, so the take stays as %s", filepath.Base(final), filepath.Base(partial))
	}
	return os.Rename(partial, final)
}

type wavFormat struct {
	sampleRate, channels, bits int
	dataBytes                  int64
}

func (f wavFormat) seconds() float64 {
	frame := int64(f.channels * f.bits / 8)
	if f.sampleRate <= 0 || frame <= 0 {
		return 0
	}
	return float64(f.dataBytes/frame) / float64(f.sampleRate)
}

// readWavFormat reads a PCM WAV's fmt chunk and data size (only the headers: the audio is never read). A data size past
// the file's end (a partial whose header was patched a second ago) is clamped to what is there.
func readWavFormat(path string) (wavFormat, error) {
	file, err := os.Open(path)
	if err != nil {
		return wavFormat{}, err
	}
	defer func() { _ = file.Close() }() // read-only
	info, err := file.Stat()
	if err != nil {
		return wavFormat{}, err
	}
	var riff [12]byte
	if _, err := io.ReadFull(file, riff[:]); err != nil {
		return wavFormat{}, err
	}
	if string(riff[0:4]) != "RIFF" || string(riff[8:12]) != "WAVE" {
		return wavFormat{}, errors.New("not a WAV file")
	}
	var format wavFormat
	haveFormat := false
	offset := int64(12)
	for offset+8 <= info.Size() {
		var head [8]byte
		if _, err := file.ReadAt(head[:], offset); err != nil {
			return wavFormat{}, err
		}
		size := int64(binary.LittleEndian.Uint32(head[4:8]))
		body := offset + 8
		switch string(head[0:4]) {
		case "fmt ":
			var fmtChunk [16]byte
			if _, err := file.ReadAt(fmtChunk[:], body); err != nil {
				return wavFormat{}, err
			}
			format.channels = int(binary.LittleEndian.Uint16(fmtChunk[2:4]))
			format.sampleRate = int(binary.LittleEndian.Uint32(fmtChunk[4:8]))
			format.bits = int(binary.LittleEndian.Uint16(fmtChunk[14:16]))
			haveFormat = true
		case "data":
			if !haveFormat {
				return wavFormat{}, errors.New("the WAV data comes before its format")
			}
			format.dataBytes = min(size, info.Size()-body)
			return format, nil
		}
		offset = body + size + size%2
	}
	return wavFormat{}, errors.New("the WAV file has no data chunk")
}
