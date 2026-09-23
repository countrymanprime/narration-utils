package dictionary

import (
	"strings"
)

// Result is what a lookup found for one selection: the key it looked up and one entry per headword and part of speech. A word the
// dictionary does not have is a result with no entries, not an error.
type Result struct {
	Query   string  `json:"query"`
	Entries []Entry `json:"entries"`
}

// Entry is one headword in one part of speech ("noun", "verb", "adjective" or "adverb") and its senses, most common first as the
// dataset orders them.
type Entry struct {
	Headword     string  `json:"headword"`
	PartOfSpeech string  `json:"partOfSpeech"`
	Senses       []Sense `json:"senses"`
}

// Sense is one meaning: its definition, the dataset's examples of it, the other words that share it, and the words opposite to it.
type Sense struct {
	Definition string   `json:"definition"`
	Examples   []string `json:"examples"`
	Synonyms   []string `json:"synonyms"`
	Antonyms   []string `json:"antonyms"`
}

var partsOfSpeech = map[string]string{"n": "noun", "v": "verb", "a": "adjective", "r": "adverb"}

// LookupFile looks one selection up in the index at path: the word as it is spelt, then the base words it is a listed irregular form of,
// and only when neither finds anything, the base forms its regular ending could have come from (WordNet's detachment rules).
func LookupFile(path, selection string) (Result, error) {
	key, err := Normalize(selection)
	if err != nil {
		return Result{}, err
	}
	idx, err := openIndex(path)
	if err != nil {
		return Result{}, err
	}
	defer idx.close()
	lemmas, err := collect(idx, key)
	if err != nil {
		return Result{}, err
	}
	entries := make([]Entry, 0, len(lemmas))
	for _, lemma := range lemmas {
		entry, err := expand(idx, lemma)
		if err != nil {
			return Result{}, err
		}
		entries = append(entries, entry)
	}
	return Result{Query: key, Entries: entries}, nil
}

// collect finds the lemmas a key stands for, in the order they are shown and each (lemma, part of speech) once.
func collect(idx *index, key string) ([]lemmaRecord, error) {
	var out []lemmaRecord
	seen := map[string]bool{}
	add := func(lemmas []lemmaRecord, pos string) {
		for _, lemma := range lemmas {
			id := lemma.Lemma + "/" + lemma.POS
			if seen[id] || (pos != "" && lemma.POS != pos) {
				continue
			}
			seen[id] = true
			out = append(out, lemma)
		}
	}
	record, err := idx.find(key)
	if err != nil {
		return nil, err
	}
	if record != nil {
		add(record.Lemmas, "")
		for _, form := range record.FormOf {
			baseRecord, err := idx.find(form.Base)
			if err != nil {
				return nil, err
			}
			if baseRecord != nil {
				add(baseRecord.Lemmas, form.POS)
			}
		}
	}
	if len(out) > 0 {
		return out, nil
	}
	for _, guess := range baseForms(key) {
		baseRecord, err := idx.find(guess.base)
		if err != nil {
			return nil, err
		}
		if baseRecord != nil {
			add(baseRecord.Lemmas, guess.pos)
		}
	}
	return out, nil
}

// expand reads the synsets of a lemma's senses into what the narrator reads.
func expand(idx *index, lemma lemmaRecord) (Entry, error) {
	entry := Entry{Headword: lemma.Lemma, PartOfSpeech: partsOfSpeech[lemma.POS], Senses: make([]Sense, 0, len(lemma.Senses))}
	for _, sense := range lemma.Senses {
		synset, err := idx.synset(sense.Synset)
		if err != nil {
			return Entry{}, err
		}
		synonyms := []string{}
		for _, member := range synset.Members {
			if !strings.EqualFold(member, lemma.Lemma) {
				synonyms = append(synonyms, member)
			}
		}
		entry.Senses = append(entry.Senses, Sense{Definition: strings.Join(synset.Definitions, "; "), Examples: nonNil(synset.Examples), Synonyms: synonyms,
			Antonyms: nonNil(sense.Antonyms)})
	}
	return entry, nil
}

// nonNil keeps an empty list a list on the wire, so the UI never has to tell null from none.
func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
