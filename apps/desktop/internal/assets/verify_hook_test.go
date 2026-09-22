package assets

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The verify hook fires once per file, after every byte of that file arrived and before the file counts as installed, so a job can say
// "checking" for the moment a large file is being hashed.
func TestInstallWithTellsWhenAFileIsBeingChecked(t *testing.T) {
	body := []byte(strings.Repeat("a", 4096))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }))
	defer server.Close()
	var received int64
	var checked []int64
	options := Options{
		OnProgress: func(_ File, done int64) { received = done },
		OnVerify:   func(File) { checked = append(checked, received) },
	}
	if err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(server.URL, body)}, options); err != nil {
		t.Fatal(err)
	}
	if len(checked) != 1 || checked[0] != int64(len(body)) {
		t.Fatalf("checked at %v bytes received, want once, after all %d", checked, len(body))
	}
}

// A file that does not match its catalog entry fails with an error a caller can recognise, not a string to compare.
func TestInstallWithNamesAChecksumMismatchAsOne(t *testing.T) {
	body := []byte("payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("PAYLOAD")) }))
	defer server.Close()
	err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(server.URL, body)}, Options{})
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("err = %v, want ErrChecksumMismatch", err)
	}
	long := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("payload and more")) }))
	defer long.Close()
	if err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(long.URL, body)}, Options{}); !errors.Is(err, ErrSizeMismatch) {
		t.Fatalf("err = %v, want ErrSizeMismatch for a body longer than the catalog says", err)
	}
	// A body that stops short is not a mismatch: it is an incomplete download, and what arrived is kept to be resumed.
	short := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("pay")) }))
	defer short.Close()
	if err := InstallWith(context.Background(), t.TempDir(), "p", "id", "1", []File{fileFor(short.URL, body)}, Options{}); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("err = %v, want ErrIncomplete", err)
	}
}
