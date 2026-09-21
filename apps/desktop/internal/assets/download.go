package assets

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ErrIncomplete is a download that ended before the whole file arrived without the connection reporting an error. What did arrive is kept.
var ErrIncomplete = errors.New("the download ended before the whole file arrived")

// StatusError is a host that answered with something other than the file. A caller can tell a missing file from a busy host.
type StatusError struct {
	Code   int
	Status string
}

func (e *StatusError) Error() string { return "could not download approved asset: " + e.Status }

// Missing reports whether the host says the file is not there for this client (not found, forbidden, gone): a problem with the release,
// not with the connection, and one that trying again does not fix.
func (e *StatusError) Missing() bool {
	return e.Code == http.StatusNotFound || e.Code == http.StatusForbidden || e.Code == http.StatusGone
}

// download brings one catalog file into staging. A file that is already there and right is kept (an earlier attempt got that far), the
// bytes of an earlier attempt that stopped short are continued with an HTTP Range request, and a host that does not honour the range is
// started from the top. Whatever the route, the finished file must match its size and SHA-256.
func download(ctx context.Context, staging string, file File, options Options) error {
	final := filepath.Join(staging, file.Name)
	if info, err := os.Stat(final); err == nil && info.Size() == file.Size && verify(final, file) == nil {
		reportProgress(options, file, file.Size)
		return nil
	}
	_ = os.Remove(final)
	part := final + partSuffix
	offset := partialSize(part, file.Size)
	for attempt := 0; ; attempt++ {
		restart, err := fetch(ctx, part, file, offset, options)
		if err != nil {
			return err
		}
		if !restart {
			break
		}
		// The host refused the range, or answered with another one: what is on disk cannot be continued.
		if attempt > 0 {
			return fmt.Errorf("could not download approved asset: the host would not send %s", file.Name)
		}
		_ = os.Remove(part)
		offset = 0
	}
	if err := os.Rename(part, final); err != nil {
		return err
	}
	if options.OnVerify != nil {
		options.OnVerify(file)
	}
	if err := verify(final, file); err != nil {
		_ = os.Remove(final)
		return err
	}
	return nil
}

// partialSize is how many bytes of a file an earlier attempt left, or 0 when there is nothing to continue (none, or more than the file
// should have, which cannot be a prefix of it).
func partialSize(part string, want int64) int64 {
	info, err := os.Stat(part)
	if err != nil {
		return 0
	}
	if info.Size() >= want {
		_ = os.Remove(part)
		return 0
	}
	return info.Size()
}

// fetch requests file from offset and appends what arrives to part. restart is true when the part file cannot be continued.
func fetch(ctx context.Context, part string, file File, offset int64, options Options) (restart bool, err error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, file.URL, nil)
	if err != nil {
		return false, err
	}
	if offset > 0 {
		request.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
	}
	client := options.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return false, fmt.Errorf("could not download approved asset: %w", err)
	}
	defer func() { _ = response.Body.Close() }() // the body was read or abandoned; nothing to report
	switch {
	case response.StatusCode == http.StatusRequestedRangeNotSatisfiable:
		return true, nil
	case response.StatusCode == http.StatusPartialContent:
		if start, ok := contentRangeStart(response.Header.Get("Content-Range")); !ok || start != offset {
			return true, nil
		}
	case response.StatusCode >= 200 && response.StatusCode < 300:
		offset = 0 // a plain answer to a range request is the whole file
	default:
		return false, &StatusError{Code: response.StatusCode, Status: response.Status}
	}
	flags := os.O_CREATE | os.O_WRONLY
	if offset > 0 {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}
	out, err := os.OpenFile(part, flags, 0o600)
	if err != nil {
		return false, err
	}
	reportProgress(options, file, offset)
	// The catalog says how big the file is, so no more than that is read: a server cannot fill the disk by sending on. One byte past
	// the declared size is read on purpose, so an oversized body is seen as a mismatch and not as a file that happens to end there.
	body := io.Reader(io.LimitReader(response.Body, file.Size-offset+1))
	if options.OnProgress != nil {
		body = &progressReader{reader: body, done: offset, report: func(done int64) { options.OnProgress(file, done) }}
	}
	_, copyErr := io.Copy(out, body)
	closeErr := out.Close()
	if copyErr != nil {
		return false, copyErr
	}
	if closeErr != nil {
		return false, closeErr
	}
	info, err := os.Stat(part)
	if err != nil {
		return false, err
	}
	switch {
	case info.Size() > file.Size:
		_ = os.Remove(part)
		return false, ErrSizeMismatch
	case info.Size() < file.Size:
		return false, ErrIncomplete
	}
	return false, nil
}

func reportProgress(options Options, file File, done int64) {
	if options.OnProgress != nil && done > 0 {
		options.OnProgress(file, done)
	}
}

// contentRangeStart is the first byte of a `bytes 100-199/2249` header.
func contentRangeStart(header string) (int64, bool) {
	rest, ok := strings.CutPrefix(header, "bytes ")
	if !ok {
		return 0, false
	}
	first, _, ok := strings.Cut(rest, "-")
	if !ok {
		return 0, false
	}
	start, err := strconv.ParseInt(first, 10, 64)
	return start, err == nil
}
