// Package contractfile is how a Go test pins a payload the host really sends (ADR 0069). It marshals the payload as
// indented JSON with sorted keys and compares it with the committed file under tests/fixtures/contracts; the TypeScript
// contract tests validate the same file against the UI's schemas, so a payload that drifts fails on one side or the other.
// Run the tests with UPDATE_CONTRACTS=1 to rewrite the files after a deliberate change, and commit the diff.
package contractfile

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// UpdateEnv, when set, makes Check write the file instead of comparing with it.
const UpdateEnv = "UPDATE_CONTRACTS"

// Dir is the shared folder of committed payloads, found by walking up to the workspace file.
func Dir() (string, error) {
	start, err := os.Getwd()
	if err != nil {
		return "", err
	}
	root, err := findRoot(start, fileExists)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "tests", "fixtures", "contracts"), nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func findRoot(start string, exists func(string) bool) (string, error) {
	for dir := start; ; dir = filepath.Dir(dir) {
		if exists(filepath.Join(dir, "pnpm-workspace.yaml")) {
			return dir, nil
		}
		if filepath.Dir(dir) == dir {
			return "", errors.New("no pnpm-workspace.yaml above " + start)
		}
	}
}

// Check compares value, marshalled, with tests/fixtures/contracts/<name>.json (or writes it in update mode).
func Check(t testing.TB, name string, value any) {
	t.Helper()
	dir, err := Dir()
	if err != nil {
		t.Fatalf("contract folder: %v", err)
	}
	checkIn(t, dir, name, value)
}

func checkIn(t testing.TB, dir, name string, value any) {
	t.Helper()
	// Not HTML-escaped: the Python helper writes the same characters raw, and a payload with < or & must read the same in both.
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		t.Fatalf("marshal %s: %v", name, err)
	}
	encoded := buffer.Bytes()
	path := filepath.Join(dir, name+".json")
	if os.Getenv(UpdateEnv) != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("create %s: %v", dir, err)
		}
		if err := os.WriteFile(path, encoded, 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		return
	}
	committed, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no committed contract file %s (run the test with %s=1 and commit it): %v", path, UpdateEnv, err)
	}
	if string(committed) != string(encoded) {
		t.Fatalf("%s no longer matches what the host sends.\ncommitted:\n%s\nnow:\n%s\nRun the test with %s=1, then update the schema and the mock together.", path, committed, encoded, UpdateEnv)
	}
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
