// build.go builds the compact word -> {ipa, audio} pronunciation index this package installs (Q8): one pass over the
// unpacked Wiktextract release's JSON Lines files, keeping only a single-word headword's first IPA transcription and
// first Wikimedia Commons audio file name (docs/research/wiktextract-pronunciation-source.md). A multi-word headword is
// skipped, the same "single-word lookups only" rule internal/dictionary's own WordNet index already follows (ADR 0097).
package wiktextract

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// IndexName is the derived index's file name inside the install: the only file the install keeps.
const IndexName = "wiktextract-index.json"

// WordEntry is what the derived index keeps for one headword. Audio (a Wikimedia Commons file name) is read here for
// prep-depth Phase 10 to use later; Phase 8 itself only reads IPA.
type WordEntry struct {
	IPA   string `json:"ipa"`
	Audio string `json:"audio"`
}

// wiktextractIndex is the derived index's on-disk shape (docs/research/wiktextract-pronunciation-source.md), read
// directly by the guide sidecar's WiktextractSource (Python, json.load) as well as by this package's own LoadIndex.
type wiktextractIndex struct {
	CatalogFormat int                  `json:"catalogFormat"`
	Words         map[string]WordEntry `json:"words"`
}

// wiktextractEntry is the one Wiktextract JSON Lines shape this package reads: a headword and its sounds. Every other
// field a real release line carries (senses, forms, etymology, part of speech, ...) is ignored.
type wiktextractEntry struct {
	Word   string `json:"word"`
	Sounds []struct {
		IPA   string `json:"ipa"`
		Audio string `json:"audio"`
	} `json:"sounds"`
}

// BuildIndex reads every *.jsonl file directly under root (the unpacked release) and writes the derived index to built.
func BuildIndex(root, built string) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	words := map[string]WordEntry{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		if err := readLines(filepath.Join(root, entry.Name()), words); err != nil {
			return err
		}
	}
	body, err := json.Marshal(wiktextractIndex{CatalogFormat: 1, Words: words})
	if err != nil {
		return err
	}
	return os.WriteFile(built, body, 0o600)
}

func readLines(path string, words map[string]WordEntry) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }() // read-only
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 8<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var raw wiktextractEntry
		if err := json.Unmarshal([]byte(line), &raw); err != nil {
			continue // a line this package cannot parse contributes nothing; it is not the whole release failing
		}
		word := strings.ToLower(strings.TrimSpace(raw.Word))
		if word == "" || strings.ContainsAny(word, " \t") {
			continue // a multi-word headword is out of scope, matching internal/dictionary's own WordNet index
		}
		if _, already := words[word]; already {
			continue // the first entry for a word wins (Q8: one pronunciation-only index, not every sense)
		}
		var ipa, audio string
		for _, sound := range raw.Sounds {
			if ipa == "" && sound.IPA != "" {
				ipa = sound.IPA
			}
			if audio == "" && sound.Audio != "" {
				audio = sound.Audio
			}
		}
		if ipa == "" {
			continue
		}
		words[word] = WordEntry{IPA: ipa, Audio: audio}
	}
	return scanner.Err()
}

// LoadIndex reads a derived index back: what a test checks BuildIndex wrote. The guide sidecar reads the same file
// directly (Python, json.load), so this is not otherwise used at runtime.
func LoadIndex(path string) (map[string]WordEntry, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var parsed wiktextractIndex
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	return parsed.Words, nil
}
