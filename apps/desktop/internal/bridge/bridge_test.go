package bridge

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEncodingMatchesRFC3986PythonQuote(t *testing.T) {
	encoded := EncodeFields([]string{"hello world", "A|B", "é", "~_.-"})
	if encoded != "hello%20world|A%7CB|%C3%A9|~_.-" {
		t.Fatalf("encoding = %q", encoded)
	}
	decoded, err := DecodeFields(encoded + "\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 4 || decoded[2] != "é" {
		t.Fatalf("decoded = %#v", decoded)
	}
}

func TestCommandsAreAtomicallyActivatedAndEventsAreReadOnce(t *testing.T) {
	client, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path, err := client.Send("jump", []string{"A|B"})
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(bytes) != "1|jump|A%7CB\n" {
		t.Fatalf("command = %q", bytes)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(filepath.Dir(path)), "events.log"), []byte("one\ntwo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	events, err := client.ReadEvents()
	if err != nil || len(events) != 2 {
		t.Fatalf("events = %#v, %v", events, err)
	}
	events, err = client.ReadEvents()
	if err != nil || len(events) != 0 {
		t.Fatalf("events = %#v, %v", events, err)
	}
}
