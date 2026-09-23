package dictionary

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// oewnFixture is a few entries and synsets in the shape of the Open English WordNet JSON release (english-wordnet-<year>-json.zip): one
// entries-<letter>.json per initial, lemma -> part of speech -> forms and senses, and one <pos>.<lexfile>.json per lexicographer file,
// synset id -> definition, examples and members.
var oewnFixture = map[string]any{
	"entries-h.json": map[string]any{
		"happy": map[string]any{"a": map[string]any{
			"form":          []string{"happier", "happiest"},
			"pronunciation": []map[string]string{{"value": "ˈhæpi", "variety": "US"}},
			"sense": []map[string]any{
				{"id": "happy%3:00:00::", "synset": "01151786-a", "antonym": []string{"unhappy%3:00:00::"}},
				{"id": "happy%5:00:00:fortunate:00", "synset": "01052105-s"},
			},
		}},
	},
	"entries-u.json": map[string]any{
		"unhappy": map[string]any{"a": map[string]any{"sense": []map[string]any{{"id": "unhappy%3:00:00::", "synset": "01152992-a", "antonym": []string{"happy%3:00:00::"}}}}},
	},
	"entries-r.json": map[string]any{
		"run": map[string]any{
			"v": map[string]any{"form": []string{"ran"}, "sense": []map[string]any{{"id": "run%2:38:00::", "synset": "02095311-v"}}},
			"n": map[string]any{"sense": []map[string]any{{"id": "run%1:04:00::", "synset": "00797430-n"}}},
		},
	},
	"entries-c.json": map[string]any{
		"cat": map[string]any{"n": map[string]any{"sense": []map[string]any{{"id": "cat%1:05:00::", "synset": "02124272-n"}}}},
		// A capitalised lemma and a lower-case one share a key; both are shown.
		"Cat": map[string]any{"n": map[string]any{"sense": []map[string]any{{"id": "cat%1:06:00::", "synset": "03000001-n"}}}},
		// A multi-word lemma is left out of the index (single-word lookups only, ADR 0097).
		"cat burglar": map[string]any{"n": map[string]any{"sense": []map[string]any{{"id": "cat_burglar%1:18:00::", "synset": "10000001-n"}}}},
	},
	"entries-f.json": map[string]any{
		"felicitous": map[string]any{"s": map[string]any{"sense": []map[string]any{{"id": "felicitous%5:00:00:fortunate:00", "synset": "01052105-s"}}}},
	},
	"adj.all.json": map[string]any{
		"01151786-a": map[string]any{"definition": []string{"enjoying or showing or marked by joy or pleasure"}, "example": []string{"a happy smile"}, "members": []string{"happy"}, "partOfSpeech": "a"},
		"01052105-s": map[string]any{"definition": []string{"marked by good fortune"}, "members": []string{"felicitous", "happy"}, "partOfSpeech": "s"},
		"01152992-a": map[string]any{"definition": []string{"experiencing or marked by or causing sadness or sorrow or discontent"}, "members": []string{"unhappy"}, "partOfSpeech": "a"},
	},
	"verb.motion.json": map[string]any{
		"02095311-v": map[string]any{"definition": []string{"move fast by using one's feet"}, "example": []string{"Don't run--you'll be out of breath"}, "members": []string{"run"}, "partOfSpeech": "v"},
	},
	"noun.act.json": map[string]any{
		"00797430-n": map[string]any{"definition": []string{"a score in baseball made by a runner touching all four bases safely"}, "members": []string{"run", "tally"}, "partOfSpeech": "n"},
	},
	"noun.animal.json": map[string]any{
		"02124272-n": map[string]any{"definition": []string{"feline mammal usually having thick soft fur"}, "members": []string{"cat", "true cat"}, "partOfSpeech": "n"},
		"03000001-n": map[string]any{"definition": []string{"a large tracked vehicle (trademark)"}, "members": []string{"Cat", "Caterpillar"}, "partOfSpeech": "n"},
	},
	"noun.person.json": map[string]any{
		"10000001-n": map[string]any{"definition": []string{"a burglar who enters a building by climbing"}, "members": []string{"cat burglar"}, "partOfSpeech": "n"},
	},
	// Files the index does not read are ignored.
	"frames.json": map[string]any{"via": "Somebody ----s"},
}

// writeFixture writes the fixture as the unpacked release folder.
func writeFixture(t *testing.T, files map[string]any) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// zipFixture is the fixture as the release archive.
func zipFixture(t *testing.T, files map[string]any) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range files {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// buildFixtureIndex builds the index of the fixture and returns its path.
func buildFixtureIndex(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), IndexName)
	if err := BuildIndex(writeFixture(t, oewnFixture), path); err != nil {
		t.Fatal(err)
	}
	return path
}
