package dictionary

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
)

// The lookup index is one file the install builds from the dataset (build.go) and every lookup reads without loading it: a fixed header,
// a table of keys sorted by their bytes, a table of synsets, and a blob holding the key text and each record as JSON. A lookup opens the
// file, binary-searches the key table with a few small reads, reads the records it needs and closes it again, so nothing stays open to
// stop the Manage local assets page removing or repairing the install.
//
//	magic      8 bytes   indexMagic
//	keyCount   uint32    little-endian, as every number here
//	synCount   uint32
//	keys       keyCount x {keyOffset, keyLength, recordOffset, recordLength uint32}   offsets into the blob
//	synsets    synCount x {recordOffset, recordLength uint32}
//	blob       the rest of the file
const (
	indexMagic   = "NUDICT01"
	headerSize   = 16
	keyEntrySize = 16
	synEntrySize = 8
	// maxRecordSize bounds one record a lookup reads, so a damaged table cannot make it allocate the file's size: the largest record in
	// the Open English WordNet 2025 is a few kilobytes.
	maxRecordSize = 1 << 20
	// IndexName is the file the install keeps, in the folder the dataset was unpacked to.
	IndexName = "index.bin"
)

// ErrDamagedIndex is an index file that is not one this package wrote, or has been changed since: the install needs repairing.
var ErrDamagedIndex = errors.New("the dictionary index is damaged: repair it from Manage local assets")

// keyRecord is what a key holds: the lemmas spelt that way (whatever their case) and the base lemmas it is a listed irregular form of.
type keyRecord struct {
	Lemmas []lemmaRecord `json:"w,omitempty"`
	FormOf []formRecord  `json:"f,omitempty"`
}

// formRecord is a base lemma's key and the part of speech the form belongs to ("ran" is a form of the verb "run", not the noun).
type formRecord struct {
	Base string `json:"b"`
	POS  string `json:"p"`
}

// lemmaRecord is one lemma in one part of speech ("n", "v", "a" (with its satellites) or "r") and its senses in the dataset's order.
type lemmaRecord struct {
	Lemma  string        `json:"l"`
	POS    string        `json:"p"`
	Senses []senseRecord `json:"s"`
}

// senseRecord is one sense: the synset it belongs to (its number in the synset table) and the words its antonym senses are.
type senseRecord struct {
	Synset   uint32   `json:"y"`
	Antonyms []string `json:"a,omitempty"`
}

// synsetRecord is one synset: its definitions, examples and member words.
type synsetRecord struct {
	Definitions []string `json:"d"`
	Examples    []string `json:"e,omitempty"`
	Members     []string `json:"m"`
}

// index is an open index file, checked to be the right shape.
type index struct {
	file              *os.File
	keyCount          uint32
	synCount          uint32
	blobStart, blobSz int64
}

func openIndex(path string) (*index, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	idx, err := checkHeader(file)
	if err != nil {
		_ = file.Close() // read-only
		return nil, err
	}
	return idx, nil
}

func checkHeader(file *os.File) (*index, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	header := make([]byte, headerSize)
	if _, err := file.ReadAt(header, 0); err != nil || string(header[:8]) != indexMagic {
		return nil, ErrDamagedIndex
	}
	keyCount, synCount := binary.LittleEndian.Uint32(header[8:]), binary.LittleEndian.Uint32(header[12:])
	blobStart := int64(headerSize) + int64(keyCount)*keyEntrySize + int64(synCount)*synEntrySize
	if blobStart > info.Size() {
		return nil, ErrDamagedIndex
	}
	return &index{file: file, keyCount: keyCount, synCount: synCount, blobStart: blobStart, blobSz: info.Size() - blobStart}, nil
}

func (x *index) close() { _ = x.file.Close() } // read-only

// readBlob reads length bytes at offset in the blob, refusing a span that is outside it or larger than any record.
func (x *index) readBlob(offset, length uint32) ([]byte, error) {
	if length > maxRecordSize || int64(offset)+int64(length) > x.blobSz {
		return nil, ErrDamagedIndex
	}
	buffer := make([]byte, length)
	// ReadFull over a section: a short read (the file shrank since it was opened, or a span that ends past it) is damage, never a buffer
	// padded with zeros.
	if _, err := io.ReadFull(io.NewSectionReader(x.file, x.blobStart+int64(offset), int64(length)), buffer); err != nil {
		return nil, ErrDamagedIndex
	}
	return buffer, nil
}

func (x *index) keyEntry(i uint32) ([4]uint32, error) {
	raw := make([]byte, keyEntrySize)
	if _, err := x.file.ReadAt(raw, headerSize+int64(i)*keyEntrySize); err != nil {
		return [4]uint32{}, ErrDamagedIndex
	}
	var entry [4]uint32
	for n := range entry {
		entry[n] = binary.LittleEndian.Uint32(raw[n*4:])
	}
	return entry, nil
}

// find binary-searches the key table; a key that is not there is a nil record and no error.
func (x *index) find(key string) (*keyRecord, error) {
	var searchErr error
	i := sort.Search(int(x.keyCount), func(i int) bool {
		if searchErr != nil {
			return true
		}
		entry, err := x.keyEntry(uint32(i)) //nolint:gosec // G115: i < keyCount, a uint32
		if err != nil {
			searchErr = err
			return true
		}
		text, err := x.readBlob(entry[0], entry[1])
		if err != nil {
			searchErr = err
			return true
		}
		return bytes.Compare(text, []byte(key)) >= 0
	})
	if searchErr != nil {
		return nil, searchErr
	}
	if i >= int(x.keyCount) {
		return nil, nil
	}
	entry, err := x.keyEntry(uint32(i)) //nolint:gosec // G115: i < keyCount, a uint32
	if err != nil {
		return nil, err
	}
	text, err := x.readBlob(entry[0], entry[1])
	if err != nil {
		return nil, err
	}
	if string(text) != key {
		return nil, nil
	}
	body, err := x.readBlob(entry[2], entry[3])
	if err != nil {
		return nil, err
	}
	var record keyRecord
	if err := json.Unmarshal(body, &record); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDamagedIndex, err)
	}
	return &record, nil
}

func (x *index) synset(n uint32) (synsetRecord, error) {
	if n >= x.synCount {
		return synsetRecord{}, ErrDamagedIndex
	}
	raw := make([]byte, synEntrySize)
	if _, err := x.file.ReadAt(raw, headerSize+int64(x.keyCount)*keyEntrySize+int64(n)*synEntrySize); err != nil {
		return synsetRecord{}, ErrDamagedIndex
	}
	body, err := x.readBlob(binary.LittleEndian.Uint32(raw), binary.LittleEndian.Uint32(raw[4:]))
	if err != nil {
		return synsetRecord{}, err
	}
	var record synsetRecord
	if err := json.Unmarshal(body, &record); err != nil {
		return synsetRecord{}, fmt.Errorf("%w: %v", ErrDamagedIndex, err)
	}
	return record, nil
}
