// Package credentialstore keeps the narrator's own secrets at rest (ADR 0405 Q10, ADR 0354): today exactly one, the
// Merriam-Webster Dictionary API key (prep-depth.prd.md Phase 9). It is the first secret this app stores.
//
// A secret lives in its own per-user file (credentials.json beside the settings and the recents list), never in the
// settings file, so no settings export, diagnostics copy or project file can carry it. On Windows, the one supported
// platform (D74), each value is sealed with DPAPI (CryptProtectData, current-user scope) and only ever unsealed in
// memory, for the length of one request. On any other platform the value is kept in the clear, and ProtectedAtRest
// says so for the Settings page to show.
//
// A value crosses this package's API as a Secret, whose every text form (fmt, %v, %#v, JSON, text marshalling) is
// "[redacted]": a Secret passed to a logger or wrapped into an error by mistake still never prints. Only Reveal gives
// the value, and nothing in this package's errors ever contains it.
package credentialstore

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sync"
)

// Redacted is every text form of a Secret.
const Redacted = "[redacted]"

// Secret is a value that never prints. Its zero value is empty.
type Secret struct{ value string }

// NewSecret wraps value.
func NewSecret(value string) Secret { return Secret{value: value} }

// Reveal is the secret's value, for the one place that must send it.
func (s Secret) Reveal() string { return s.value }

// Empty reports whether the secret holds nothing.
func (s Secret) Empty() bool { return s.value == "" }

func (s Secret) String() string               { return Redacted }
func (s Secret) GoString() string             { return Redacted }
func (s Secret) Format(f fmt.State, _ rune)   { _, _ = io.WriteString(f, Redacted) }
func (s Secret) MarshalJSON() ([]byte, error) { return json.Marshal(Redacted) }
func (s Secret) MarshalText() ([]byte, error) { return []byte(Redacted), nil }
func (s *Secret) UnmarshalJSON(_ []byte) error {
	return errors.New("credentialstore: a secret is never read from JSON")
}
func (s *Secret) UnmarshalText(_ []byte) error {
	return errors.New("credentialstore: a secret is never read from text")
}
func (s Secret) LogValue() slog.Value { return slog.StringValue(Redacted) }

// ErrOtherProtection is a saved value sealed a way this build cannot open (saved on another platform, or by a build
// with another protection): the narrator enters it again.
var ErrOtherProtection = errors.New("credentialstore: the saved key was protected on another system; enter it again") // +checklocksignore: an error value, returned under the lock by chance

// name is a secret's row name: lower-case letters, digits and underscores.
var name = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

const fileVersion = 1

type fileEntry struct {
	// Protection is how Blob is sealed: "dpapi" (Windows) or "none".
	Protection string `json:"protection"`
	// Blob is the sealed value, base64.
	Blob string `json:"blob"`
}

type file struct {
	Version int                  `json:"version"`
	Entries map[string]fileEntry `json:"entries"`
}

// Store is one per-user credentials file. Its methods are safe for concurrent use.
type Store struct {
	path string
	mu   sync.Mutex
}

// New is the store kept at path (created on the first Set).
func New(path string) *Store { return &Store{path: path} }

// ProtectedAtRest reports whether this build seals values with the platform's credential protection (DPAPI on
// Windows) rather than keeping them in the clear.
func ProtectedAtRest() bool { return protection != "none" }

// Set seals secret and saves it under key, replacing any value already there. An empty secret is refused: Delete
// removes one.
func (s *Store) Set(key string, secret Secret) error {
	if !name.MatchString(key) {
		return fmt.Errorf("credentialstore: %q is not a credential name", key)
	}
	if secret.Empty() {
		return errors.New("credentialstore: an empty value is not saved; remove the credential instead")
	}
	sealed, err := protect([]byte(secret.value))
	if err != nil {
		return fmt.Errorf("credentialstore: the key could not be protected: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.read()
	if err != nil {
		return err
	}
	current.Entries[key] = fileEntry{Protection: protection, Blob: base64.StdEncoding.EncodeToString(sealed)}
	return s.write(current)
}

// Get unseals the value saved under key. ok is false when nothing is saved there.
func (s *Store) Get(key string) (secret Secret, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.read()
	if err != nil {
		return Secret{}, false, err
	}
	entry, found := current.Entries[key]
	if !found {
		return Secret{}, false, nil
	}
	if entry.Protection != protection {
		return Secret{}, false, ErrOtherProtection
	}
	sealed, err := base64.StdEncoding.DecodeString(entry.Blob)
	if err != nil {
		return Secret{}, false, errors.New("credentialstore: the saved key is damaged; enter it again")
	}
	plain, err := unprotect(sealed)
	if err != nil {
		return Secret{}, false, fmt.Errorf("credentialstore: the saved key could not be opened; enter it again: %w", err)
	}
	return Secret{value: string(plain)}, true, nil
}

// Present reports whether a value is saved under key, without unsealing it.
func (s *Store) Present(key string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.read()
	if err != nil {
		return false, err
	}
	_, found := current.Entries[key]
	return found, nil
}

// Delete removes the value saved under key; removing one that is not there is not an error.
func (s *Store) Delete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.read()
	if err != nil {
		return err
	}
	if _, found := current.Entries[key]; !found {
		return nil
	}
	delete(current.Entries, key)
	return s.write(current)
}

func (s *Store) read() (file, error) {
	empty := file{Version: fileVersion, Entries: map[string]fileEntry{}}
	bytes, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return empty, nil
	}
	if err != nil {
		return file{}, fmt.Errorf("credentialstore: the credentials file could not be read: %w", err)
	}
	var parsed file
	if err := json.Unmarshal(bytes, &parsed); err != nil || parsed.Version != fileVersion {
		// Never echo the file's content: it holds the sealed values.
		return file{}, errors.New("credentialstore: the credentials file is damaged; remove it and enter the key again")
	}
	if parsed.Entries == nil {
		parsed.Entries = map[string]fileEntry{}
	}
	return parsed, nil
}

// write replaces the file whole: a temporary file beside it, owner-only, renamed over it, so a crash never leaves half
// a file.
func (s *Store) write(current file) error {
	bytes, err := json.MarshalIndent(current, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("credentialstore: the credentials folder could not be created: %w", err)
	}
	temp, err := os.CreateTemp(filepath.Dir(s.path), ".credentials-*.tmp")
	if err != nil {
		return fmt.Errorf("credentialstore: the credentials file could not be written: %w", err)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("credentialstore: the credentials file could not be written: %w", err)
	}
	if _, err := temp.Write(bytes); err != nil {
		_ = temp.Close()
		return fmt.Errorf("credentialstore: the credentials file could not be written: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("credentialstore: the credentials file could not be written: %w", err)
	}
	if err := os.Rename(tempPath, s.path); err != nil {
		return fmt.Errorf("credentialstore: the credentials file could not be written: %w", err)
	}
	return nil
}
