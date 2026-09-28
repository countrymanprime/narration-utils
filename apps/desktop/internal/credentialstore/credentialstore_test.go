package credentialstore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const rawKey = "0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a"

func TestASecretNeverPrints(t *testing.T) {
	secret := NewSecret(rawKey)
	var logged bytes.Buffer
	slog.New(slog.NewTextHandler(&logged, nil)).Info("lookup", "key", secret)
	marshalled, err := json.Marshal(map[string]any{"key": secret})
	if err != nil {
		t.Fatal(err)
	}
	text, err := secret.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	for name, got := range map[string]string{
		"%s":        fmt.Sprintf("%s", secret),
		"%v":        fmt.Sprintf("%v", secret),
		"%+v":       fmt.Sprintf("%+v", secret),
		"%#v":       fmt.Sprintf("%#v", secret),
		"%q":        fmt.Sprintf("%q", secret),
		"%x":        fmt.Sprintf("%x", secret),
		"a struct":  fmt.Sprintf("%+v", struct{ Key Secret }{secret}),
		"an error":  fmt.Errorf("lookup failed with %v", secret).Error(),
		"json":      string(marshalled),
		"text":      string(text),
		"slog":      logged.String(),
		"String()":  secret.String(),
		"GoString":  secret.GoString(),
		"a pointer": fmt.Sprintf("%v", &secret),
	} {
		if strings.Contains(got, rawKey) || !strings.Contains(got, Redacted) {
			t.Errorf("%s printed %q; want %q and never the key", name, got, Redacted)
		}
	}
	if secret.Reveal() != rawKey {
		t.Fatalf("Reveal() = %q, want the value", secret.Reveal())
	}
}

func TestASecretIsNeverReadFromJSON(t *testing.T) {
	var got struct{ Key Secret }
	if err := json.Unmarshal([]byte(`{"Key":"x"}`), &got); err == nil {
		t.Fatal("a Secret decoded from JSON; want it refused, so no payload can smuggle one in")
	}
}

func TestSetThenGetGivesTheValueBack(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "narration-utils", "credentials.json"))
	if present, err := store.Present("merriam_webster"); err != nil || present {
		t.Fatalf("Present before Set = %v, %v; want false", present, err)
	}
	if err := store.Set("merriam_webster", NewSecret(rawKey)); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.Get("merriam_webster")
	if err != nil || !ok || got.Reveal() != rawKey {
		t.Fatalf("Get = %v, %v, %v; want the saved value", got.Reveal() == rawKey, ok, err)
	}
	if present, _ := store.Present("merriam_webster"); !present {
		t.Fatal("Present after Set = false")
	}
	// A second store over the same file reads it: the value is at rest, not in memory.
	if again, ok, err := New(store.path).Get("merriam_webster"); err != nil || !ok || again.Reveal() != rawKey {
		t.Fatalf("a fresh store over the file = %v, %v; want the saved value", ok, err)
	}
}

func TestDeleteRemovesTheValue(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "credentials.json"))
	if err := store.Delete("merriam_webster"); err != nil {
		t.Fatalf("Delete with nothing saved = %v", err)
	}
	if err := store.Set("merriam_webster", NewSecret(rawKey)); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete("merriam_webster"); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.Get("merriam_webster"); ok || err != nil {
		t.Fatalf("Get after Delete = %v, %v; want nothing", ok, err)
	}
	bytes, _ := os.ReadFile(store.path)
	if strings.Contains(string(bytes), rawKey) {
		t.Fatal("the deleted key is still in the file")
	}
}

func TestSetRefusesAnEmptyValueAndABadName(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "credentials.json"))
	if err := store.Set("merriam_webster", NewSecret("")); err == nil {
		t.Error("Set of an empty value = nil")
	}
	for _, bad := range []string{"", "Merriam", "../x", "a b"} {
		if err := store.Set(bad, NewSecret(rawKey)); err == nil {
			t.Errorf("Set(%q) = nil; want a bad name refused", bad)
		}
	}
}

// The file is owner-only, and on Windows (the supported platform, D74) the value in it is sealed, never the key's text.
func TestTheFileIsOwnerOnlyAndSealedOnWindows(t *testing.T) {
	store := New(filepath.Join(t.TempDir(), "credentials.json"))
	if err := store.Set("merriam_webster", NewSecret(rawKey)); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(store.path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Errorf("the credentials file's mode = %v, want 0600", info.Mode().Perm())
	}
	bytes, _ := os.ReadFile(store.path)
	if ProtectedAtRest() == (runtime.GOOS != "windows") {
		t.Fatalf("ProtectedAtRest() = %v on %s; want true exactly on Windows", ProtectedAtRest(), runtime.GOOS)
	}
	if ProtectedAtRest() {
		if strings.Contains(string(bytes), rawKey) || !strings.Contains(string(bytes), `"dpapi"`) {
			t.Fatalf("the file on Windows holds the key's text or no DPAPI blob: %s", bytes)
		}
	}
	if entries, _ := os.ReadDir(filepath.Dir(store.path)); len(entries) != 1 {
		t.Fatalf("the folder holds %d files after a save; want the credentials file alone, no temporary left", len(entries))
	}
}

func TestAValueSealedAnotherWayIsRefusedNotMisread(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	other := "dpapi"
	if protection == "dpapi" {
		other = "none"
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"entries":{"merriam_webster":{"protection":"`+other+`","blob":"eA=="}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := New(path).Get("merriam_webster"); !errors.Is(err, ErrOtherProtection) {
		t.Fatalf("Get of a value sealed another way = %v, want ErrOtherProtection", err)
	}
}

// A damaged file's error never echoes the file, which holds the (sealed or, off Windows, clear) key.
func TestADamagedFileIsReportedWithoutItsContent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"entries":{"merriam_webster":{"blob":"`+rawKey), 0o600); err != nil {
		t.Fatal(err)
	}
	_, _, err := New(path).Get("merriam_webster")
	if err == nil || strings.Contains(err.Error(), rawKey) {
		t.Fatalf("Get of a damaged file = %v; want an error without the key", err)
	}
}
