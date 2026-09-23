package dictionary

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"sort"
	"strings"
)

// The files of the Open English WordNet JSON release the index reads: the entries, one file per initial, and the synsets, one file per
// lexicographer file. Anything else in the folder (frames.json) is not read.
var (
	entriesFile = regexp.MustCompile(`^entries-[a-z0-9]+\.json$`)
	synsetsFile = regexp.MustCompile(`^(noun|verb|adj|adv)\.[A-Za-z]+\.json$`)
)

// rawEntry and rawSynset are the parts of the release's JSON the index keeps.
type rawEntry struct {
	Form  []string   `json:"form"`
	Sense []rawSense `json:"sense"`
}

type rawSense struct {
	ID      string   `json:"id"`
	Synset  string   `json:"synset"`
	Antonym []string `json:"antonym"`
}

type rawSynset struct {
	Definition []string          `json:"definition"`
	Example    []json.RawMessage `json:"example"`
	Members    []string          `json:"members"`
}

// dataset is the release read into memory: lemma -> part of speech -> entry, and synset id -> synset.
type dataset struct {
	entries map[string]map[string]rawEntry
	synsets map[string]rawSynset
}

// BuildIndex reads the unpacked Open English WordNet JSON release in dir and writes the lookup index to out. Only single-word lemmas are
// indexed (ADR 0097), with the synsets they use. A folder that is not the release (no entries, no synsets, a sense whose synset is
// missing) is an error, and nothing is written.
func BuildIndex(dir, out string) error {
	data, err := readDataset(dir)
	if err != nil {
		return err
	}
	keys, synsets, err := data.records()
	if err != nil {
		return err
	}
	return writeIndex(out, keys, synsets)
}

// readDataset reads the release through an fs.FS rooted at dir, so no file name in the folder can reach outside it.
func readDataset(dir string) (dataset, error) {
	release := os.DirFS(dir)
	names, err := fs.ReadDir(release, ".")
	if err != nil {
		return dataset{}, err
	}
	data := dataset{entries: map[string]map[string]rawEntry{}, synsets: map[string]rawSynset{}}
	for _, name := range names {
		path := name.Name()
		switch {
		case entriesFile.MatchString(name.Name()):
			var part map[string]map[string]rawEntry
			if err := readJSON(release, path, &part); err != nil {
				return dataset{}, err
			}
			for lemma, byPOS := range part {
				data.entries[lemma] = byPOS
			}
		case synsetsFile.MatchString(name.Name()):
			var part map[string]rawSynset
			if err := readJSON(release, path, &part); err != nil {
				return dataset{}, err
			}
			for id, synset := range part {
				data.synsets[id] = synset
			}
		}
	}
	if len(data.entries) == 0 || len(data.synsets) == 0 {
		return dataset{}, errors.New("the folder does not hold the Open English WordNet JSON release (no entries or no synsets)")
	}
	return data, nil
}

func readJSON(release fs.FS, name string, into any) error {
	body, err := fs.ReadFile(release, name)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("%s is not in the release's shape: %w", name, err)
	}
	return nil
}

// posOf is the part of speech of an entry key: "n-1" and "n-2" (homographs told apart by pronunciation) are nouns, and a satellite
// adjective ("s") is an adjective.
func posOf(key string) string {
	pos, _, _ := strings.Cut(key, "-")
	if pos == "s" {
		return "a"
	}
	return pos
}

// records turns the dataset into the index's records: each key (a lower-cased single-word lemma or listed irregular form) with its
// record, and the synsets those use, numbered in the order the sorted lemmas first use them (so the same release always builds the same
// bytes).
func (d dataset) records() (map[string]*keyRecord, []synsetRecord, error) {
	senseWord := map[string]string{}
	for lemma, byPOS := range d.entries {
		for _, entry := range byPOS {
			for _, sense := range entry.Sense {
				senseWord[sense.ID] = lemma
			}
		}
	}
	lemmas := make([]string, 0, len(d.entries))
	for lemma := range d.entries {
		if !strings.ContainsAny(lemma, " _") {
			lemmas = append(lemmas, lemma)
		}
	}
	sort.Strings(lemmas)
	synsetNumber := map[string]uint32{}
	var used []string
	keys := map[string]*keyRecord{}
	record := func(key string) *keyRecord {
		if keys[key] == nil {
			keys[key] = &keyRecord{}
		}
		return keys[key]
	}
	for _, lemma := range lemmas {
		key := strings.ToLower(lemma)
		for _, posKey := range sortedKeys(d.entries[lemma]) {
			entry := d.entries[lemma][posKey]
			lemmaRec, err := d.lemma(lemma, posOf(posKey), entry, senseWord, synsetNumber, &used)
			if err != nil {
				return nil, nil, err
			}
			record(key).Lemmas = mergeLemma(record(key).Lemmas, lemmaRec)
			for _, form := range entry.Form {
				if formKey := strings.ToLower(form); formKey != key && !strings.ContainsAny(formKey, " _") {
					record(formKey).FormOf = appendOnce(record(formKey).FormOf, formRecord{Base: key, POS: posOf(posKey)})
				}
			}
		}
	}
	for key, rec := range keys {
		sortLemmas(key, rec.Lemmas)
	}
	return keys, d.synsetRecords(used), nil
}

// lemma is one lemma in one part of speech, its synsets numbered as they are first used.
func (d dataset) lemma(lemma, pos string, entry rawEntry, senseWord map[string]string, number map[string]uint32, used *[]string) (lemmaRecord, error) {
	rec := lemmaRecord{Lemma: lemma, POS: pos}
	for _, sense := range entry.Sense {
		if _, ok := d.synsets[sense.Synset]; !ok {
			return lemmaRecord{}, fmt.Errorf("the sense %s of %q names a synset the release does not have (%s)", sense.ID, lemma, sense.Synset)
		}
		if _, ok := number[sense.Synset]; !ok {
			number[sense.Synset] = uint32(len(*used)) //nolint:gosec // G115: the release has about 120,000 synsets
			*used = append(*used, sense.Synset)
		}
		var antonyms []string
		for _, id := range sense.Antonym {
			if word, ok := senseWord[id]; ok {
				antonyms = appendOnce(antonyms, word)
			}
		}
		rec.Senses = append(rec.Senses, senseRecord{Synset: number[sense.Synset], Antonyms: antonyms})
	}
	return rec, nil
}

// synsetRecords is the synset records in the order they were numbered.
func (d dataset) synsetRecords(used []string) []synsetRecord {
	out := make([]synsetRecord, 0, len(used))
	for _, id := range used {
		raw := d.synsets[id]
		out = append(out, synsetRecord{Definitions: raw.Definition, Examples: exampleTexts(raw.Example), Members: raw.Members})
	}
	return out
}

// exampleTexts is each example's text: the release writes most as a string and a quotation as {"text", "source"}.
func exampleTexts(raw []json.RawMessage) []string {
	var out []string
	for _, item := range raw {
		var text string
		if json.Unmarshal(item, &text) == nil {
			out = append(out, text)
			continue
		}
		var quoted struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(item, &quoted) == nil && quoted.Text != "" {
			out = append(out, quoted.Text)
		}
	}
	return out
}

// mergeLemma adds a lemma record, folding "a" and its satellites (and numbered homographs) into one record per part of speech.
func mergeLemma(list []lemmaRecord, add lemmaRecord) []lemmaRecord {
	for i := range list {
		if list[i].Lemma == add.Lemma && list[i].POS == add.POS {
			list[i].Senses = append(list[i].Senses, add.Senses...)
			return list
		}
	}
	return append(list, add)
}

// sortLemmas puts the lemma spelt exactly as the key first, then the others (a capitalised name) by spelling; each lemma's parts of speech
// keep the order they were added in (noun, verb, adjective, adverb, the release's key order).
func sortLemmas(key string, lemmas []lemmaRecord) {
	sort.SliceStable(lemmas, func(i, j int) bool {
		if (lemmas[i].Lemma == key) != (lemmas[j].Lemma == key) {
			return lemmas[i].Lemma == key
		}
		return lemmas[i].Lemma < lemmas[j].Lemma
	})
}

// posOrder is the order a lemma's parts of speech are shown in.
var posOrder = map[string]int{"n": 0, "v": 1, "a": 2, "s": 2, "r": 3}

// sortedKeys is an entry's part-of-speech keys in the order they are shown.
func sortedKeys(byPOS map[string]rawEntry) []string {
	keys := make([]string, 0, len(byPOS))
	for key := range byPOS {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := posOrder[posOf(keys[i])], posOrder[posOf(keys[j])]
		if a != b {
			return a < b
		}
		return keys[i] < keys[j]
	})
	return keys
}

func appendOnce[T comparable](list []T, value T) []T {
	for _, have := range list {
		if have == value {
			return list
		}
	}
	return append(list, value)
}

// writeIndex writes the header, the two tables and the blob, to a temporary name first so a failed build leaves no index.
func writeIndex(out string, keys map[string]*keyRecord, synsets []synsetRecord) error {
	names := make([]string, 0, len(keys))
	for key := range keys {
		names = append(names, key)
	}
	sort.Strings(names)
	var blob []byte
	keyTable := make([]byte, 0, len(names)*keyEntrySize)
	for _, key := range names {
		body, err := json.Marshal(keys[key])
		if err != nil {
			return err
		}
		keyTable = appendSpan(keyTable, &blob, []byte(key))
		keyTable = appendSpan(keyTable, &blob, body)
	}
	synTable := make([]byte, 0, len(synsets)*synEntrySize)
	for _, synset := range synsets {
		body, err := json.Marshal(synset)
		if err != nil {
			return err
		}
		synTable = appendSpan(synTable, &blob, body)
	}
	header := make([]byte, headerSize)
	copy(header, indexMagic)
	binary.LittleEndian.PutUint32(header[8:], uint32(len(names)))    //nolint:gosec // G115: about 80,000 keys
	binary.LittleEndian.PutUint32(header[12:], uint32(len(synsets))) //nolint:gosec // G115: about 120,000 synsets
	return writeAtomically(out, header, keyTable, synTable, blob)
}

// appendSpan appends body to the blob and its offset and length to the table.
func appendSpan(table []byte, blob *[]byte, body []byte) []byte {
	table = binary.LittleEndian.AppendUint32(table, uint32(len(*blob))) //nolint:gosec // G115: the blob is tens of megabytes
	table = binary.LittleEndian.AppendUint32(table, uint32(len(body)))  //nolint:gosec // G115: one record is a few kilobytes
	*blob = append(*blob, body...)
	return table
}

func writeAtomically(out string, parts ...[]byte) error {
	temp := out + ".building"
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriter(file)
	for _, part := range parts {
		if _, err := writer.Write(part); err != nil {
			_ = file.Close()
			_ = os.Remove(temp)
			return err
		}
	}
	if err := writer.Flush(); err != nil {
		_ = file.Close()
		_ = os.Remove(temp)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return os.Rename(temp, out)
}
