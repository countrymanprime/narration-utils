package assets

import "io"

// progressReader counts the bytes that pass through it and reports the running total after every read.
type progressReader struct {
	reader io.Reader
	done   int64
	report func(done int64)
}

func (p *progressReader) Read(buffer []byte) (int, error) {
	n, err := p.reader.Read(buffer)
	if n > 0 {
		p.done += int64(n)
		p.report(p.done)
	}
	return n, err
}
