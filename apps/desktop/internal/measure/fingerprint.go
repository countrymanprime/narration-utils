package measure

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"time"
)

// drainBlockBytes is how much of the file after the measured audio is hashed at a time, between checks of ctx.
const drainBlockBytes = 1 << 20

// ErrFileChanged is the answer when a file's size or modified time moved while it was being measured, as a file
// still being recorded or rendered does: the report and the fingerprint would describe different audio.
var ErrFileChanged = errors.New("the file changed while it was being measured; measure it again once it is finished")

// Fingerprint identifies the exact bytes a measurement read: the file's size, its modified time (UTC, RFC 3339 with
// nanoseconds) and the SHA-256 of its whole content. A finding records it as evidence, so a later render of the same
// path is recognisably different audio (PRD open question 5, recommendation (b): the id stays stable).
type Fingerprint struct {
	SizeBytes  int64  `json:"size_bytes"`
	ModifiedAt string `json:"modified_at"`
	SHA256     string `json:"sha256"`
}

// FileMeasurement is a file's report together with the fingerprint of the bytes it was measured from.
type FileMeasurement struct {
	Report      Report      `json:"report"`
	Fingerprint Fingerprint `json:"fingerprint"`
}

// FingerprintFile reads the whole file at path, read-only, and fingerprints it.
func FingerprintFile(path string) (Fingerprint, error) {
	file, info, err := openForReading(path)
	if err != nil {
		return Fingerprint{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return Fingerprint{}, fmt.Errorf("%s: %w", path, err)
	}
	return fingerprintOf(info, digest), nil
}

// MeasureFile measures the WAV file at path (or opts.Range of it) and fingerprints it in the same pass. A file that
// starts as an MP3 (an ID3v2 tag or a frame sync) is read for its container only (mp3header.go); a range is refused
// for it, since it has no decoded audio to take a range of. The fingerprint
// always covers every byte of the file, so a range measurement still reads the file to its end, hashing what follows
// the range without decoding it. The file is opened read-only and never written. A file whose size or modified time
// changed between the start and the end answers ErrFileChanged; cancelling ctx answers ctx's error.
func MeasureFile(ctx context.Context, path string, opts Options) (FileMeasurement, error) {
	file, before, err := openForReading(path)
	if err != nil {
		return FileMeasurement{}, err
	}
	defer func() { _ = file.Close() }() // read-only

	digest := sha256.New()
	counted := &countingReader{r: io.TeeReader(file, digest)}
	head := make([]byte, 4)
	n, _ := file.ReadAt(head, 0)
	var report Report
	if looksLikeMP3(head[:n]) {
		report, err = measureMP3(ctx, counted, opts, before.Size())
	} else {
		report, err = analyze(ctx, counted, opts, before.Size())
	}
	if err != nil {
		return FileMeasurement{}, err
	}
	if err := drain(ctx, counted); err != nil {
		return FileMeasurement{}, err
	}
	after, err := os.Stat(path)
	if err != nil {
		return FileMeasurement{}, err
	}
	if counted.n != before.Size() || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return FileMeasurement{}, ErrFileChanged
	}
	report.File = path
	return FileMeasurement{Report: report, Fingerprint: fingerprintOf(before, digest)}, nil
}

func openForReading(path string) (*os.File, os.FileInfo, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, nil, fmt.Errorf("%s is not a regular file", path)
	}
	return file, info, nil
}

func fingerprintOf(info os.FileInfo, digest hash.Hash) Fingerprint {
	return Fingerprint{
		SizeBytes:  info.Size(),
		ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		SHA256:     hex.EncodeToString(digest.Sum(nil)),
	}
}

// drain reads what the measurement did not need, so the hash covers the whole file.
func drain(ctx context.Context, r io.Reader) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := io.CopyN(io.Discard, r, drainBlockBytes)
		if errors.Is(err, io.EOF) || (err == nil && n < drainBlockBytes) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// countingReader counts the bytes read through it.
type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// measureMP3 reads an MP3's frame headers into a report, telling opts.Progress the bytes read.
func measureMP3(ctx context.Context, r io.Reader, opts Options, size int64) (Report, error) {
	if opts.Range != nil {
		return Report{}, errors.New("a range can only be measured in a WAV file")
	}
	var progress func(int64)
	if opts.Progress != nil {
		progress = func(done int64) { opts.Progress(done, size) }
	}
	info, err := ReadMP3(ctx, r, progress)
	if err != nil {
		return Report{}, err
	}
	return mp3Report(info), nil
}
