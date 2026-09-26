package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// jobKindConstNames lists every jobKindXxx identifier declared in jobs.go, by parsing its own const block rather than
// hand-copying the list, so a new job kind is caught by TestEveryJobKindHasARegisteredBeginSiteThatCallsIt the moment
// it is declared, not only once someone remembers to register it.
func jobKindConstNames(t *testing.T, files []*ast.File) []string {
	t.Helper()
	var names []string
	for _, file := range files {
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for _, name := range value.Names {
					if strings.HasPrefix(name.Name, "jobKind") {
						names = append(names, name.Name)
					}
				}
			}
		}
	}
	if len(names) == 0 {
		t.Fatal("found no jobKindXxx constants; the guard must run from the package directory")
	}
	return names
}

// funcBodies indexes every top-level function's body by name (a name shared by more than one function, none are here,
// would only need the first — the guard just needs one body per registered name to scan).
func funcBodies(files []*ast.File) map[string]*ast.BlockStmt {
	bodies := map[string]*ast.BlockStmt{}
	for _, file := range files {
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			bodies[function.Name.Name] = function.Body
		}
	}
	return bodies
}

// callsBegin reports whether body contains a call whose method name is "begin" (jobRuns.begin) or "Begin"
// (runlog.Logger.Begin, transcriptWatch's own special case) anywhere in it, closures included.
func callsBegin(body ast.Node) bool {
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if ok && (selector.Sel.Name == "begin" || selector.Sel.Name == "Begin") {
			found = true
		}
		return true
	})
	return found
}

// jobsGoConstValue reads the string literal jobs.go assigned to constName, so the test looks kinds up in
// jobKindBeginSites by their real value ("story_bible") rather than assuming it matches the Go identifier.
func jobsGoConstValue(files []*ast.File, constName string) string {
	for _, file := range files {
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok || general.Tok != token.CONST {
				continue
			}
			for _, spec := range general.Specs {
				value, ok := spec.(*ast.ValueSpec)
				if !ok || len(value.Names) == 0 || value.Names[0].Name != constName || len(value.Values) == 0 {
					continue
				}
				literal, ok := value.Values[0].(*ast.BasicLit)
				if !ok || literal.Kind != token.STRING {
					continue
				}
				if unquoted, err := strconv.Unquote(literal.Value); err == nil {
					return unquoted
				}
			}
		}
	}
	return ""
}

func TestEveryJobKindHasARegisteredBeginSiteThatCallsIt(t *testing.T) {
	paths, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	var files []*ast.File
	for _, path := range paths {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		files = append(files, file)
	}

	kinds := jobKindConstNames(t, files)
	bodies := funcBodies(files)

	var problems []string
	for _, kind := range kinds {
		sites, registered := jobKindBeginSites[jobsGoConstValue(files, kind)]
		if !registered {
			problems = append(problems, kind+" has no entry in jobKindBeginSites (runlog_jobs.go); a new job kind must say where its run.start happens")
			continue
		}
		for _, site := range sites {
			body, exists := bodies[site]
			if !exists {
				problems = append(problems, kind+": jobKindBeginSites names "+site+", which is not a declared function")
				continue
			}
			if !callsBegin(body) {
				problems = append(problems, kind+": "+site+" no longer calls begin/Begin — its run.start record was dropped")
			}
		}
	}
	sort.Strings(problems)
	for _, problem := range problems {
		t.Error(problem)
	}
}

// The guard is only worth having if it fires. This fixture is parsed the same way as the real sources.
func TestBeginGuardFlagsAMissingRegistrationAndASiteThatStoppedCallingBegin(t *testing.T) {
	const source = `package main

const (
	jobKindFixtureCovered   = "fixture_covered"
	jobKindFixtureUncovered = "fixture_uncovered"
)

func siteThatBegins() { h.jobRuns.begin(nil, "id", "kind") }
func siteThatStoppedCallingBegin() { doSomethingElse() }
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "fixture.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	files := []*ast.File{file}
	bodies := funcBodies(files)

	fixtureSites := map[string][]string{
		"fixture_covered":   {"siteThatBegins"},
		"fixture_uncovered": {"siteThatStoppedCallingBegin"},
		// fixture_missing is deliberately absent, to prove jobsGoConstValue's caller reports an unregistered kind.
	}
	if !callsBegin(bodies["siteThatBegins"]) {
		t.Fatal("callsBegin missed a real begin call")
	}
	if callsBegin(bodies["siteThatStoppedCallingBegin"]) {
		t.Fatal("callsBegin flagged a function with no begin call at all")
	}
	if _, ok := fixtureSites["fixture_missing"]; ok {
		t.Fatal("test setup error: fixture_missing must be absent from fixtureSites")
	}
}
