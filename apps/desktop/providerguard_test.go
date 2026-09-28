package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	"github.com/countrymanprime/narration-utils/shell/internal/captureport"
	"github.com/countrymanprime/narration-utils/shell/internal/port"
	"github.com/countrymanprime/narration-utils/shell/internal/pronunciationport"
	"github.com/countrymanprime/narration-utils/shell/internal/ttsport"
)

// The provider-ports guard (ADR 0301): no host code outside a port package compares a provider name. A call site asks a
// registry (asrport.Supports, asrport.AssetKind, pronunciationport.CheckPronounce, ...) and never writes
// engine == teleprompter.EngineMoonshine, because a new engine is meant to be one registry row with no call site edited.
// The Python sidecars have the same guard in libs/python/tests/test_provider_guard.py.

// providerGuardExceptions are the functions, as "<file relative to apps/desktop> <function>", that compare a provider name
// for a reason other than choosing one. Each needs a written reason, and an entry that stops being needed fails the guard.
var providerGuardExceptions = map[string]string{
	"smoke.go checkFrozenMoonshine": "checks the frozen sidecar's --check-moonshine report names the engine it was asked about; it selects nothing",
}

// providerNames are the names in every provider registry.
func providerNames() map[string]bool {
	names := map[string]bool{}
	add := func(rows []string) {
		for _, name := range rows {
			names[name] = true
		}
	}
	add(entryNames(asrport.Engines.Entries()))
	add(entryNames(ttsport.Engines.Entries()))
	add(entryNames(pronunciationport.Sources.Entries()))
	add(entryNames(captureport.Backends.Entries()))
	return names
}

// entryNames are the rows' names on every platform.
func entryNames[P any](entries []port.Entry[P]) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}
	return names
}

// isPortDir reports whether dir (slash-separated, relative to apps/desktop) is a provider or DAW port package or one of its
// conformance suites: internal/<x>port/...
func isPortDir(dir string) bool {
	parts := strings.Split(dir, "/")
	return len(parts) >= 2 && parts[0] == "internal" && strings.HasSuffix(parts[1], "port")
}

type guardFile struct {
	rel  string // slash-separated, relative to apps/desktop
	pkg  string // the package's directory, the key of its constants
	file *ast.File
}

// providerConstants maps "<package dir> <name>" to the constants that spell a provider name: those a port package declares
// with a name's literal value, and any constant elsewhere defined as one of them (teleprompter.EngineMoonshine =
// asrport.Moonshine). A constant with the same value that is not defined through a port (an asset kind such as
// installKindMoonshine) is not a provider name.
func providerConstants(files []guardFile, names map[string]bool) map[string]bool {
	constants := map[string]bool{}
	for changed := true; changed; {
		changed = false
		for _, f := range files {
			imports := importDirs(f.file)
			for _, declaration := range f.file.Decls {
				general, ok := declaration.(*ast.GenDecl)
				if !ok || general.Tok != token.CONST {
					continue
				}
				for _, spec := range general.Specs {
					value := spec.(*ast.ValueSpec)
					for index, name := range value.Names {
						if index >= len(value.Values) || constants[f.pkg+" "+name.Name] {
							continue
						}
						expression := value.Values[index]
						literal := isPortDir(f.pkg) && isNameLiteral(expression, names)
						if literal || refersToProvider(expression, f.pkg, imports, constants) {
							constants[f.pkg+" "+name.Name] = true
							changed = true
						}
					}
				}
			}
		}
	}
	return constants
}

// importDirs maps each import's local name to its directory relative to apps/desktop (only this module's imports).
func importDirs(file *ast.File) map[string]string {
	const module = "github.com/countrymanprime/narration-utils/shell/"
	dirs := map[string]string{}
	for _, spec := range file.Imports {
		importPath, _ := strconv.Unquote(spec.Path.Value)
		if !strings.HasPrefix(importPath, module) {
			continue
		}
		local := path.Base(importPath)
		if spec.Name != nil {
			local = spec.Name.Name
		}
		dirs[local] = strings.TrimPrefix(importPath, module)
	}
	return dirs
}

func isNameLiteral(expression ast.Expr, names map[string]bool) bool {
	literal, ok := expression.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return false
	}
	value, err := strconv.Unquote(literal.Value)
	return err == nil && names[value]
}

func refersToProvider(expression ast.Expr, pkg string, imports map[string]string, constants map[string]bool) bool {
	switch typed := expression.(type) {
	case *ast.ParenExpr:
		return refersToProvider(typed.X, pkg, imports, constants)
	case *ast.Ident:
		return constants[pkg+" "+typed.Name]
	case *ast.SelectorExpr:
		owner, ok := typed.X.(*ast.Ident)
		if !ok {
			return false
		}
		dir, imported := imports[owner.Name]
		return imported && constants[dir+" "+typed.Sel.Name]
	}
	return false
}

type providerComparison struct {
	function string
	position token.Position
	what     string
}

// providerComparisons lists each ==, != and switch case in f that has a provider name on one side (a literal, or a constant
// that spells one), and each composite literal listing two or more names.
func providerComparisons(fset *token.FileSet, f guardFile, names, constants map[string]bool) []providerComparison {
	imports := importDirs(f.file)
	named := func(expression ast.Expr) bool {
		return isNameLiteral(expression, names) || refersToProvider(expression, f.pkg, imports, constants)
	}
	var found []providerComparison
	visit := func(function string, body ast.Node) {
		ast.Inspect(body, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.BinaryExpr:
				if (typed.Op == token.EQL || typed.Op == token.NEQ) && (named(typed.X) || named(typed.Y)) {
					found = append(found, providerComparison{function, fset.Position(typed.Pos()), "compares a provider name"})
				}
			case *ast.SwitchStmt:
				if typed.Tag == nil {
					return true
				}
				for _, clause := range typed.Body.List {
					for _, expression := range clause.(*ast.CaseClause).List {
						if named(expression) {
							found = append(found, providerComparison{function, fset.Position(expression.Pos()), "switches on a provider name"})
						}
					}
				}
			case *ast.CompositeLit:
				count := 0
				for _, element := range typed.Elts {
					if pair, ok := element.(*ast.KeyValueExpr); ok {
						element = pair.Key
					}
					if named(element) {
						count++
					}
				}
				if count >= 2 {
					found = append(found, providerComparison{function, fset.Position(typed.Pos()), "lists provider names"})
				}
			}
			return true
		})
	}
	for _, declaration := range f.file.Decls {
		switch typed := declaration.(type) {
		case *ast.FuncDecl:
			if typed.Body != nil {
				visit(typed.Name.Name, typed.Body)
			}
		case *ast.GenDecl:
			visit(closureName, typed)
		}
	}
	return found
}

// parseGuardSources parses every non-test Go file of the module (the root package, internal/..., cmd/...).
func parseGuardSources(t *testing.T) (*token.FileSet, []guardFile) {
	t.Helper()
	fset := token.NewFileSet()
	var files []guardFile
	err := filepath.WalkDir(".", func(walked string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name := entry.Name(); walked != "." && (strings.HasPrefix(name, ".") || name == "testdata" || name == "node_modules" || name == "build") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(walked, ".go") || strings.HasSuffix(walked, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(fset, walked, nil, 0)
		if err != nil {
			return fmt.Errorf("parse %s: %w", walked, err)
		}
		rel := filepath.ToSlash(walked)
		files = append(files, guardFile{rel: rel, pkg: path.Dir(rel), file: file})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("found no Go sources to check; the guard must run from apps/desktop")
	}
	return fset, files
}

// providerViolations groups every comparison outside a port package by "<file> <function>".
func providerViolations(t *testing.T) map[string][]providerComparison {
	fset, files := parseGuardSources(t)
	names := providerNames()
	constants := providerConstants(files, names)
	violations := map[string][]providerComparison{}
	for _, f := range files {
		if isPortDir(f.pkg) {
			continue
		}
		for _, comparison := range providerComparisons(fset, f, names, constants) {
			key := f.rel + " " + comparison.function
			violations[key] = append(violations[key], comparison)
		}
	}
	return violations
}

func TestTheProviderGuardKnowsEveryRegisteredName(t *testing.T) {
	names := providerNames()
	for _, want := range []string{asrport.Whisper, asrport.Moonshine, ttsport.Piper, pronunciationport.CMU, pronunciationport.Espeak, captureport.DShow, captureport.WASAPI} {
		if !names[want] {
			t.Errorf("providerNames() is missing %q; the guard would let it be compared", want)
		}
	}
}

func TestNoHostCodeComparesAProviderNameOutsideTheRegistries(t *testing.T) {
	var problems []string
	for key, comparisons := range providerViolations(t) {
		if _, allowed := providerGuardExceptions[key]; allowed {
			continue
		}
		first := comparisons[0]
		problems = append(problems, fmt.Sprintf("%s: %s %s (%d places); ask the port's registry instead", first.position, first.function, first.what, len(comparisons)))
	}
	sort.Strings(problems)
	for _, problem := range problems {
		t.Error(problem)
	}
}

func TestEveryProviderGuardExceptionIsStillNeeded(t *testing.T) {
	violations := providerViolations(t)
	for key := range providerGuardExceptions {
		if len(violations[key]) == 0 {
			t.Errorf("providerGuardExceptions names %q, which no longer compares a provider name; remove the entry", key)
		}
	}
}

// The guard is only worth having if it fires. The fixtures are parsed the same way as the real sources.
func TestProviderGuardFlagsComparisonsSwitchesAndListsButNotLookups(t *testing.T) {
	const portSource = `package asrport

const (
	Whisper   = "whisper"
	Moonshine = "moonshine"
	ModeLive  = "live"
)
`
	const aliasSource = `package teleprompter

import "github.com/countrymanprime/narration-utils/shell/internal/asrport"

const EngineMoonshine = asrport.Moonshine

func Local(engine string) bool { return engine == EngineMoonshine }
`
	const hostSource = `package main

import (
	"github.com/countrymanprime/narration-utils/shell/internal/asrport"
	tp "github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

const installKindMoonshine = "moonshine"

func Literal(engine string) bool   { return engine == "moonshine" }
func Reversed(engine string) bool  { return "whisper" != engine }
func Constant(engine string) bool  { return engine == asrport.Moonshine }
func Alias(engine string) bool     { return engine == tp.EngineMoonshine }
func Switch(engine string) {
	switch engine {
	case asrport.Whisper:
	}
}
func List() []string               { return []string{"whisper", "moonshine"} }
func Keys() map[string]int         { return map[string]int{asrport.Whisper: 1, asrport.Moonshine: 2} }
func AssetKind(kind string) bool   { return kind == installKindMoonshine }
func Mode(mode string) bool        { return mode == asrport.ModeLive }
func Lookup(engine string) bool    { return asrport.Supports("windows", asrport.ModeLive, engine) }
func Default() string              { return asrport.Whisper }
func One() []string                { return []string{asrport.Whisper} }
`
	fset := token.NewFileSet()
	var files []guardFile
	for rel, source := range map[string]string{"internal/asrport/asrport.go": portSource, "internal/teleprompter/service.go": aliasSource, "host.go": hostSource} {
		file, err := parser.ParseFile(fset, rel, source, 0)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, guardFile{rel: rel, pkg: path.Dir(rel), file: file})
	}
	names := map[string]bool{"whisper": true, "moonshine": true}
	constants := providerConstants(files, names)
	flagged := map[string]bool{}
	for _, f := range files {
		if isPortDir(f.pkg) {
			continue
		}
		for _, comparison := range providerComparisons(fset, f, names, constants) {
			flagged[comparison.function] = true
		}
	}
	want := []string{"Alias", "Constant", "Keys", "List", "Literal", "Local", "Reversed", "Switch"}
	var got []string
	for function := range flagged {
		got = append(got, function)
	}
	sort.Strings(got)
	if strings.Join(got, " ") != strings.Join(want, " ") {
		t.Fatalf("flagged %v, want %v", got, want)
	}
}
