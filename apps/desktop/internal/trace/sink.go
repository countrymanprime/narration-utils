package trace

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
)

const maxBackups = 2

// sink is the trace file: buffered appends, rotated to path.1 and path.2 when a line would push it past max bytes. The
// Tracer's lock serializes every call, so the sink holds none of its own.
type sink struct {
	path string
	max  int64
	file *os.File
	buf  *bufio.Writer
	size int64
}

func newSink(path string, max int64) *sink { return &sink{path: path, max: max} }

func (s *sink) open() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return err
	}
	s.file, s.buf, s.size = file, bufio.NewWriterSize(file, 16<<10), info.Size()
	return nil
}

// write appends line, rotating first when it would not fit. A line longer than the cap on its own is still written.
func (s *sink) write(line []byte) error {
	if s.file == nil {
		if err := s.open(); err != nil {
			return err
		}
	}
	if s.size > 0 && s.size+int64(len(line)) > s.max {
		if err := s.rotate(); err != nil {
			return err
		}
	}
	n, err := s.buf.Write(line)
	s.size += int64(n)
	return err
}

func (s *sink) rotate() error {
	if err := s.close(); err != nil {
		return err
	}
	_ = os.Remove(s.path + "." + strconv.Itoa(maxBackups))
	for i := maxBackups - 1; i >= 1; i-- {
		from, to := s.path+"."+strconv.Itoa(i), s.path+"."+strconv.Itoa(i+1)
		if _, err := os.Stat(from); err == nil {
			if err := os.Rename(from, to); err != nil {
				return err
			}
		}
	}
	if err := os.Rename(s.path, s.path+".1"); err != nil {
		return err
	}
	return s.open()
}

func (s *sink) flush() error {
	if s.buf == nil {
		return nil
	}
	return s.buf.Flush()
}

func (s *sink) close() error {
	if s.file == nil {
		return nil
	}
	flushErr := s.buf.Flush()
	closeErr := s.file.Close()
	s.file, s.buf = nil, nil
	if flushErr != nil {
		return flushErr
	}
	return closeErr
}
