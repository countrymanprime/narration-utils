package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The online pronunciation lookup's guards (prep-depth.prd.md Phase 9, mirroring providerguard_test.go): the key store,
// the adapter and the API's host are each reachable from exactly one place, so no other code can read the narrator's
// key or build a request to Merriam-Webster, and no future edit can quietly add a second caller.

const onlineGuardModule = "github.com/countrymanprime/narration-utils/shell/"

// goSources is every non-test Go file in the desktop module, relative to it with forward slashes.
func onlineGuardSources(t *testing.T) map[string]*ast.File {
	t.Helper()
	files := map[string]*ast.File{}
	fset := token.NewFileSet()
	err := filepath.WalkDir(".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() && (entry.Name() == "node_modules" || entry.Name() == "cmd" || strings.HasPrefix(entry.Name(), ".")) && path != "." {
			return filepath.SkipDir
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		parsed, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(path)] = parsed
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func onlineGuardImporters(t *testing.T, files map[string]*ast.File, pkg string) []string {
	t.Helper()
	found := []string{}
	for path, file := range files {
		for _, spec := range file.Imports {
			if value, _ := strconv.Unquote(spec.Path.Value); value == onlineGuardModule+pkg {
				found = append(found, path)
			}
		}
	}
	return found
}

func TestOnlyTheOnlineLookupReachesTheCredentialStore(t *testing.T) {
	for _, path := range onlineGuardImporters(t, onlineGuardSources(t), "internal/credentialstore") {
		if !strings.HasPrefix(path, "internal/pronunciationonline/") {
			t.Errorf("%s imports the credential store; only internal/pronunciationonline may read the narrator's key", path)
		}
	}
}

func TestOnlyTheCompositionRootBuildsTheMerriamWebsterAdapter(t *testing.T) {
	for _, path := range onlineGuardImporters(t, onlineGuardSources(t), "internal/pronunciationonline/merriamwebster") {
		if path != "bindings_pronunciationonline.go" {
			t.Errorf("%s imports the Merriam-Webster adapter; depend on the pronunciationonline port instead", path)
		}
	}
	for _, path := range onlineGuardImporters(t, onlineGuardSources(t), "internal/pronunciationonline/pronunciationonlinetest") {
		t.Errorf("%s (not a test) imports the fake dictionary", path)
	}
}

// No code but the adapter names the API's host or an address on it, so nothing else can build a request to it. (The
// port's error messages may still tell the narrator about "your dictionaryapi.com account page".)
func TestOnlyTheAdapterNamesTheDictionaryAPIHost(t *testing.T) {
	for path := range onlineGuardSources(t) {
		bytes, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		text := string(bytes)
		if (strings.Contains(text, "www.dictionaryapi.com") || strings.Contains(text, "dictionaryapi.com/")) && !strings.HasPrefix(path, "internal/pronunciationonline/merriamwebster/") {
			t.Errorf("%s names an address on dictionaryapi.com; only the Merriam-Webster adapter may", path)
		}
	}
}

// Wails logs every binding call's arguments at its Debug level, which would put a pasted key into its log. The app
// leaves the level at Wails' default (Info) and sets no logger of its own; this pins that main.go keeps it so.
func TestTheAppNeverLowersWailsLogLevel(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	ast.Inspect(file, func(node ast.Node) bool {
		literal, ok := node.(*ast.CompositeLit)
		if !ok {
			return true
		}
		selector, ok := literal.Type.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Options" {
			return true
		}
		found = true
		for _, element := range literal.Elts {
			if pair, ok := element.(*ast.KeyValueExpr); ok {
				if key, ok := pair.Key.(*ast.Ident); ok && (key.Name == "LogLevel" || key.Name == "Logger") {
					t.Errorf("main.go sets application.Options.%s; Wails would log binding arguments (the pasted key) at Debug", key.Name)
				}
			}
		}
		return true
	})
	if !found {
		t.Fatal("main.go builds no application.Options; update this guard")
	}
}
