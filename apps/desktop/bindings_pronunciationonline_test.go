package main

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/contractfile"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline/merriamwebster"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationonline/pronunciationonlinetest"
)

const onlineTestKey = "0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a"

// onlineHost is a host whose per-user folder is a temporary one and whose online lookup runs on the fake dictionary
// (D67), with its files where the app keeps them.
func onlineHost(t *testing.T) (*Host, *pronunciationonlinetest.Fake, string) {
	t.Helper()
	appData := t.TempDir()
	t.Setenv("APPDATA", appData)
	host := NewHost()
	fake := pronunciationonlinetest.New()
	dir := filepath.Dir(recentProjectsPath())
	host.pronunciationOnline = pronunciationonline.NewService(fake, filepath.Join(dir, "credentials.json"), filepath.Join(dir, "pronunciation", "merriam-webster-cache.json"))
	return host, fake, appData
}

func decodeOnline[T any](t *testing.T, raw string, err error) T {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
	var value T
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

// The first-use prompt opens exactly Merriam-Webster's sign-up page, a constant of the adapter's: nothing the UI sends
// reaches the address.
func TestPronunciationOnlineSignUpOpenOpensTheFixedSignUpPage(t *testing.T) {
	host := NewHost()
	host.ctx = context.Background()
	var opened []string
	host.openURL = func(_ context.Context, address string) { opened = append(opened, address) }
	if _, err := host.PronunciationOnlineSignUpOpen(); err != nil {
		t.Fatal(err)
	}
	if len(opened) != 1 || opened[0] != merriamwebster.SignUpURL {
		t.Fatalf("opened %v, want exactly [%s]", opened, merriamwebster.SignUpURL)
	}
}

func TestPronunciationOnlineSignUpOpenRefusesBeforeTheHostIsReady(t *testing.T) {
	if _, err := NewHost().PronunciationOnlineSignUpOpen(); err == nil {
		t.Fatal("want an error before Startup has set a context")
	}
}

// The key goes in once and never comes back out: the status says only whether one is saved.
func TestPronunciationOnlineKeyStatusNeverCarriesTheKey(t *testing.T) {
	host, _, _ := onlineHost(t)
	raw, err := host.PronunciationOnlineKeySet(onlineTestKey)
	if err != nil || strings.Contains(raw, onlineTestKey) {
		t.Fatalf("KeySet = %s, %v; want a status without the key", raw, err)
	}
	raw, err = host.PronunciationOnlineKeyStatus()
	status := decodeOnline[pronunciationonline.KeyStatus](t, raw, err)
	if !status.Present || strings.Contains(raw, onlineTestKey) {
		t.Fatalf("KeyStatus = %s; want present, without the key", raw)
	}
}

// D72 and Q11: neither the key nor the looked-up word is ever written to the host log or the run log, even with debug
// logging on, after a key is saved, a word looked up (fetched, then cached), a batch run, and every refusal the
// bindings give.
func TestPronunciationOnlineNeverLogsTheKeyOrTheWord(t *testing.T) {
	host, fake, appData := onlineHost(t)
	host.runLog.SetDebug(true)
	const word = "Quorlenwick"
	fake.Answers["quorlenwick"] = pronunciationonline.Answer{Found: true, Pronunciations: []pronunciationonline.Pronunciation{{Headword: word, Spelling: "ˈkwȯr-lən-ˌwik"}}}
	fake.Errs = map[string]error{"brastlewick": pronunciationonline.ErrKeyRefused}

	errs := []error{}
	call := func(_ string, err error) { errs = append(errs, err) }
	call(host.PronunciationOnlineLookup(word)) // no key yet
	call(host.PronunciationOnlineKeySet("not a key " + onlineTestKey))
	call(host.PronunciationOnlineKeySet(onlineTestKey))
	call(host.PronunciationOnlineLookup(word))
	call(host.PronunciationOnlineLookup(word)) // cached
	call(host.PronunciationOnlineLookup(word + " said quietly, turning away"))
	call(host.PronunciationOnlineLookup("Brastlewick"))
	call(host.PronunciationOnlineLookupBatch([]string{word, "Brastlewick", "croquet"}, 2))
	call(host.PronunciationOnlineLookupBatch([]string{word, "Brastlewick", "croquet"}, 3))
	call(host.PronunciationOnlineKeyStatus())
	call(host.PronunciationOnlineKeyClear())
	// The UI reports its own errors to the host log; make sure the log exists, then look through every log file.
	_, _ = host.SystemReportDiagnostic("probe", "after the online lookups")

	for _, err := range errs {
		if err != nil && (strings.Contains(err.Error(), onlineTestKey) || strings.Contains(strings.ToLower(err.Error()), "quorlenwick") || strings.Contains(err.Error(), "Brastlewick")) {
			t.Errorf("a binding's error quotes the key or the word: %v", err)
		}
	}
	logs := filepath.Join(appData, "narration-utils", "logs")
	read := 0
	_ = filepath.WalkDir(logs, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		bytes, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		read++
		text := strings.ToLower(string(bytes))
		for _, secret := range []string{onlineTestKey, "quorlenwick", "brastlewick"} {
			if strings.Contains(text, secret) {
				t.Errorf("%s holds %q", filepath.Base(path), secret)
			}
		}
		return nil
	})
	if read == 0 {
		t.Fatal("no log file was written, so the test proved nothing")
	}
	if calls := fake.Calls(); len(calls) != 3 {
		t.Fatalf("the dictionary was called %d times; want 3 (the lookup, the refused one, croquet in the batch)", len(calls))
	}
}

// The wire contracts: every shape these bindings send, from the fake dictionary (D67), as the UI's schemas read them.
func TestContractPronunciationOnline(t *testing.T) {
	host, _, _ := onlineHost(t)
	status := func(name string, call func() (string, error)) {
		t.Helper()
		raw, err := call()
		value := decodeOnline[map[string]any](t, raw, err)
		value["protectedAtRest"] = true // Windows, the supported platform (D74), seals the key; the golden says so everywhere
		contractfile.Check(t, name, value)
	}
	status("pronunciation-online-key-absent", host.PronunciationOnlineKeyStatus)
	status("pronunciation-online-key-present", func() (string, error) { return host.PronunciationOnlineKeySet(onlineTestKey) })

	lookup := func(name, word string) {
		t.Helper()
		raw, err := host.PronunciationOnlineLookup(word)
		value := decodeOnline[map[string]any](t, raw, err)
		value["fetchedAt"] = "2026-09-27T21:00:00Z"
		contractfile.Check(t, name, value)
	}
	lookup("pronunciation-online-lookup-found", "croquet")
	lookup("pronunciation-online-lookup-cached", "Croquet")
	lookup("pronunciation-online-lookup-not-found", "quorlen")

	raw, err := host.PronunciationOnlineLookupBatch([]string{"croquet", "wren", "quorlen"}, 3)
	batch := decodeOnline[map[string]any](t, raw, err)
	contractfile.Check(t, "pronunciation-online-batch", batch)
}
