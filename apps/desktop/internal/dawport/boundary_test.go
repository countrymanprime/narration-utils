package dawport

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
)

// The DAW port boundary guard (DAW port PRD P6, ADR 0300): dawport is the only way the host reaches an audio engine, so
//   - no package outside internal/bridge (the transport) and internal/dawport/reaper (the one adapter that wraps it) may hold a
//     *bridge.Client or *bridge.Actions: a caller takes a role from a Resolver instead;
//   - no code outside internal/dawport (any adapter, including the fake) may branch on a dawport.Kind or the DAW's own label
//     ("REAPER", "Audacity"): a caller asks the resolver for a capability's level, never a DAW's identity.
//
// Both rules have a small, named exceptions list rather than zero tolerance, because the composition root itself must pick one
// concrete adapter and one concrete transport for the launch (that is what "composition root" means). internal/dawadapter, the
// seam this port replaced, was retired at P8: its own bridgeHolderExceptions and kindBranchExceptions entries went with it, and
// the guard's own dawadapter references below (dawadapterPkgDir, the fixture tests) are deliberately independent of whether that
// package still exists, so the guard still proves its rules fire correctly with nothing real to check against. An exception is
// not a loophole: every remaining entry names why it is still there, and TestEveryBoundaryExceptionIsStillNeeded fails the
// moment that reason stops applying, so the list can only shrink honestly, not grow silently.

const (
	shellModule      = "github.com/countrymanprime/narration-utils/shell/"
	bridgePackageDir = "internal/bridge"
	reaperAdapterDir = "internal/dawport/reaper"
	dawadapterPkgDir = "internal/dawadapter"
	dawportPkgPrefix = "internal/dawport"
)

// bridgeHolderExceptions are files outside internal/bridge and internal/dawport/reaper allowed to declare a *bridge.Client or
// *bridge.Actions field, parameter, result or variable today, each with the reason it is not yet gone.
var bridgeHolderExceptions = map[string]string{
	"app.go": "the composition root: configureLocked opens the launch's one REAPER transport and Host/hostServices carry it " +
		"until every remaining holder reaches it through a role instead",
	"services.go": "hostServices is the snapshot of the same fields app.go's Host carries, read under h.services() (hostguard_test.go)",
	"bindings_navigation.go": "p5aAdapter hands out the shared navigator and actions object as roles rather than build a second " +
		"dawport/reaper.Adapter over the same client, which would race its own run IDs against h.actions' (DAW port PRD P5a)",
	"internal/daw/reachability.go": "the Heartbeat role's one implementation; every holder of it is typed dawport.Heartbeat " +
		"(DAW port PRD P5c), but the tracker itself still subscribes to the concrete client's own fan-out",
}

// kindBranchExceptions name "<file> <function>" pairs allowed to branch on a dawport.Kind or a DAW label outside
// internal/dawport, each with a written reason.
var kindBranchExceptions = map[string]string{
	"app.go configureLocked": "the composition root: it alone decides which physical transport to open for the launch's DAW, " +
		"and which review session (REAPER's bridge or Audacity's not-yet-available refusal) to build for it " +
		"(DAW port PRD P2's OCP note: the composition root picks the factory by Kind)",
	"bindings.go pickerSwitchDAW": "a picker switch keeps an Audacity launch Audacity and turns any other into Standalone: an " +
		"identity choice a picked project's own DAW makes, not a capability, so it has no resolver equivalent",
	"bindings_daw.go dawDeclarationFor": "the launch's declaration-only adapter, chosen by Kind the same way dawport.Register's " +
		"factories are (DAW port PRD's OCP note), until the registry replaces every P4-era caller's own adapter",
	"internal/daw/locate.go looksLikeReaper": "matches a Windows uninstall registry DisplayName against Cockos's own naming " +
		"(\"REAPER\", \"REAPER (x64)\"); it locates an install on disk and never decides behaviour, so it is not a Kind branch",
}

type guardFile struct {
	rel  string // slash-separated, relative to apps/desktop
	pkg  string // the package's directory, relative to apps/desktop
	file *ast.File
}

// moduleRoot is apps/desktop: this test lives two directories below it.
const moduleRoot = "../.."

// parseModuleSources parses every non-test Go file in the module (apps/desktop and everything under it).
func parseModuleSources(t *testing.T) (*token.FileSet, []guardFile) {
	t.Helper()
	fset := token.NewFileSet()
	var files []guardFile
	err := filepath.WalkDir(moduleRoot, func(walked string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name := entry.Name(); walked != moduleRoot && (strings.HasPrefix(name, ".") || name == "testdata" || name == "node_modules" || name == "build") {
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
		rel, err := filepath.Rel(moduleRoot, walked)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		files = append(files, guardFile{rel: rel, pkg: path.Dir(rel), file: file})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("found no Go sources to check; the guard must run from internal/dawport")
	}
	return fset, files
}

// importDirs maps each import's local name to its directory relative to apps/desktop (only this module's imports).
func importDirs(file *ast.File) map[string]string {
	dirs := map[string]string{}
	for _, spec := range file.Imports {
		importPath, _ := strconv.Unquote(spec.Path.Value)
		if !strings.HasPrefix(importPath, shellModule) {
			continue
		}
		local := path.Base(importPath)
		if spec.Name != nil {
			local = spec.Name.Name
		}
		dirs[local] = strings.TrimPrefix(importPath, shellModule)
	}
	return dirs
}

// isDawportDir reports whether dir (relative to apps/desktop) is internal/dawport or one of its subpackages (reaper, audacity,
// dawporttest): the port and every adapter it registers.
func isDawportDir(dir string) bool {
	return dir == dawportPkgPrefix || strings.HasPrefix(dir, dawportPkgPrefix+"/")
}

// bridgeFieldType reports the *bridge.Client or *bridge.Actions type name a type expression names, using imports to resolve the
// package the selector's prefix refers to (so a local alias for internal/bridge is still caught).
func bridgeFieldType(expr ast.Expr, imports map[string]string) (string, bool) {
	star, ok := expr.(*ast.StarExpr)
	if !ok {
		return "", false
	}
	sel, ok := star.X.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	ident, ok := sel.X.(*ast.Ident)
	if !ok {
		return "", false
	}
	if dir, imported := imports[ident.Name]; !imported || dir != bridgePackageDir {
		return "", false
	}
	if sel.Sel.Name == "Client" || sel.Sel.Name == "Actions" {
		return sel.Sel.Name, true
	}
	return "", false
}

type bridgeHolder struct {
	kind     string
	position token.Position
}

// bridgeHolders lists every *bridge.Client/*bridge.Actions naming in f's field lists (struct fields, function parameters and
// results) and package or local variable declarations.
func bridgeHolders(fset *token.FileSet, f guardFile) []bridgeHolder {
	imports := importDirs(f.file)
	var found []bridgeHolder
	ast.Inspect(f.file, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.Field:
			if kind, ok := bridgeFieldType(typed.Type, imports); ok {
				found = append(found, bridgeHolder{kind, fset.Position(typed.Pos())})
			}
		case *ast.ValueSpec:
			if typed.Type != nil {
				if kind, ok := bridgeFieldType(typed.Type, imports); ok {
					found = append(found, bridgeHolder{kind, fset.Position(typed.Pos())})
				}
			}
		}
		return true
	})
	return found
}

// bridgeViolations groups every bridgeHolder found outside internal/bridge and internal/dawport/reaper by file.
func bridgeViolations(t *testing.T) map[string][]bridgeHolder {
	fset, files := parseModuleSources(t)
	violations := map[string][]bridgeHolder{}
	for _, f := range files {
		if f.pkg == bridgePackageDir || f.pkg == reaperAdapterDir {
			continue
		}
		if found := bridgeHolders(fset, f); len(found) > 0 {
			violations[f.rel] = found
		}
	}
	return violations
}

func TestNoPackageOutsideBridgeAndReaperHoldsTheBridgeClientOrActions(t *testing.T) {
	var problems []string
	for file, holders := range bridgeViolations(t) {
		if _, allowed := bridgeHolderExceptions[file]; allowed {
			continue
		}
		first := holders[0]
		problems = append(problems, fmt.Sprintf("%s: names *bridge.%s (%d places); take a role from the resolver instead", first.position, first.kind, len(holders)))
	}
	sort.Strings(problems)
	for _, problem := range problems {
		t.Error(problem)
	}
}

func TestEveryBridgeHolderExceptionIsStillNeeded(t *testing.T) {
	violations := bridgeViolations(t)
	for file := range bridgeHolderExceptions {
		if len(violations[file]) == 0 {
			t.Errorf("bridgeHolderExceptions names %q, which no longer holds *bridge.Client or *bridge.Actions; remove the entry", file)
		}
	}
}

// kindConstantNames are dawadapter.Kind's constants, also reachable through dawport's aliases (adapter.go).
var kindConstantNames = map[string]bool{"KindNone": true, "KindREAPER": true, "KindAudacity": true}

// dawLabels are the DAW-identifying strings dawadapter.Kind.String() returns.
var dawLabels = map[string]bool{"REAPER": true, "Audacity": true}

// namesKindOrLabel reports whether expression is a dawadapter.Kind (or dawport-aliased) constant, or a string literal spelling a
// DAW's own label.
func namesKindOrLabel(expression ast.Expr, imports map[string]string) bool {
	if literal, ok := expression.(*ast.BasicLit); ok && literal.Kind == token.STRING {
		value, err := strconv.Unquote(literal.Value)
		return err == nil && dawLabels[value]
	}
	sel, ok := expression.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	ident, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	dir, imported := imports[ident.Name]
	if !imported {
		return false
	}
	return (dir == dawadapterPkgDir || isDawportDir(dir)) && kindConstantNames[sel.Sel.Name]
}

type kindBranch struct {
	function string
	position token.Position
}

// kindBranches lists every ==, != and switch case in f that names a Kind constant or a DAW label.
func kindBranches(fset *token.FileSet, f guardFile) []kindBranch {
	imports := importDirs(f.file)
	named := func(expression ast.Expr) bool { return namesKindOrLabel(expression, imports) }
	var found []kindBranch
	visit := func(function string, body ast.Node) {
		ast.Inspect(body, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.BinaryExpr:
				if (typed.Op == token.EQL || typed.Op == token.NEQ) && (named(typed.X) || named(typed.Y)) {
					found = append(found, kindBranch{function, fset.Position(typed.Pos())})
				}
			case *ast.SwitchStmt:
				if typed.Tag == nil {
					return true
				}
				for _, clause := range typed.Body.List {
					for _, expression := range clause.(*ast.CaseClause).List {
						if named(expression) {
							found = append(found, kindBranch{function, fset.Position(expression.Pos())})
						}
					}
				}
			}
			return true
		})
	}
	for _, declaration := range f.file.Decls {
		if function, ok := declaration.(*ast.FuncDecl); ok && function.Body != nil {
			visit(function.Name.Name, function.Body)
		}
	}
	return found
}

// kindBranchViolations groups every kindBranch found outside internal/dawport by "<file> <function>".
func kindBranchViolations(t *testing.T) map[string][]kindBranch {
	fset, files := parseModuleSources(t)
	violations := map[string][]kindBranch{}
	for _, f := range files {
		if isDawportDir(f.pkg) {
			continue
		}
		for _, branch := range kindBranches(fset, f) {
			key := f.rel + " " + branch.function
			violations[key] = append(violations[key], branch)
		}
	}
	return violations
}

func TestNoCodeOutsideDawportBranchesOnKindOrTheDawLabel(t *testing.T) {
	var problems []string
	for key, branches := range kindBranchViolations(t) {
		if _, allowed := kindBranchExceptions[key]; allowed {
			continue
		}
		first := branches[0]
		problems = append(problems, fmt.Sprintf("%s: %s branches on a DAW's Kind or label (%d places); ask the resolver for a capability instead", first.position, key, len(branches)))
	}
	sort.Strings(problems)
	for _, problem := range problems {
		t.Error(problem)
	}
}

func TestEveryKindBranchExceptionIsStillNeeded(t *testing.T) {
	violations := kindBranchViolations(t)
	for key := range kindBranchExceptions {
		if len(violations[key]) == 0 {
			t.Errorf("kindBranchExceptions names %q, which no longer branches on a Kind or a DAW label; remove the entry", key)
		}
	}
}

// The guards are only worth having if they fire. These fixtures are parsed the same way as the real sources, entirely separate
// from the exceptions lists above, so a fixture never needs one.

func TestBridgeGuardFlagsFieldsParamsAndVarsButNotTheAllowedPackages(t *testing.T) {
	const bridgeSource = `package bridge

type Client struct{}
type Actions struct{}
`
	const reaperSource = `package reaper

import "github.com/countrymanprime/narration-utils/shell/internal/bridge"

type Adapter struct{ client *bridge.Client }
`
	const hostSource = `package main

import "github.com/countrymanprime/narration-utils/shell/internal/bridge"

type Host struct {
	bridge  *bridge.Client
	actions *bridge.Actions
}

func Build() *bridge.Client {
	var client *bridge.Client
	return client
}

func TakesActions(a *bridge.Actions) {}

func NoBridge(count int) int { return count }
`
	fset := token.NewFileSet()
	sources := map[string]string{
		"internal/bridge/client.go":         bridgeSource,
		"internal/dawport/reaper/reaper.go": reaperSource,
		"host.go":                           hostSource,
	}
	var files []guardFile
	for rel, source := range sources {
		file, err := parser.ParseFile(fset, rel, source, 0)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, guardFile{rel: rel, pkg: path.Dir(rel), file: file})
	}

	violations := map[string][]bridgeHolder{}
	for _, f := range files {
		if f.pkg == bridgePackageDir || f.pkg == reaperAdapterDir {
			continue
		}
		if found := bridgeHolders(fset, f); len(found) > 0 {
			violations[f.rel] = found
		}
	}
	if len(violations) != 1 {
		t.Fatalf("violations = %v, want exactly host.go flagged", violations)
	}
	if len(violations["host.go"]) != 5 {
		t.Fatalf("host.go violations = %d, want 5 (2 fields, a var, a return type, a param)", len(violations["host.go"]))
	}
}

func TestKindGuardFlagsComparisonsAndSwitchesButNotLookupsOrDawport(t *testing.T) {
	const dawadapterSource = `package dawadapter

type Kind int

const (
	KindNone Kind = iota
	KindREAPER
	KindAudacity
)
`
	const dawportSource = `package dawport

import "github.com/countrymanprime/narration-utils/shell/internal/dawadapter"

func InsideDawport(kind dawadapter.Kind) bool { return kind == dawadapter.KindREAPER }
`
	const hostSource = `package main

import "github.com/countrymanprime/narration-utils/shell/internal/dawadapter"

func Compares(kind dawadapter.Kind) bool  { return kind == dawadapter.KindREAPER }
func Reversed(kind dawadapter.Kind) bool  { return dawadapter.KindAudacity != kind }
func Literal(daw string) bool             { return daw == "REAPER" }
func Switches(kind dawadapter.Kind) bool {
	switch kind {
	case dawadapter.KindAudacity:
		return true
	}
	return false
}
func Lookup(kind dawadapter.Kind) string { return kind.String() }
func Unrelated(daw string) bool          { return daw == "Standalone" }
`
	fset := token.NewFileSet()
	sources := map[string]string{
		"internal/dawadapter/daw.go":  dawadapterSource,
		"internal/dawport/adapter.go": dawportSource,
		"host.go":                     hostSource,
	}
	var files []guardFile
	for rel, source := range sources {
		file, err := parser.ParseFile(fset, rel, source, 0)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, guardFile{rel: rel, pkg: path.Dir(rel), file: file})
	}

	flagged := map[string]bool{}
	for _, f := range files {
		if isDawportDir(f.pkg) {
			continue
		}
		for _, branch := range kindBranches(fset, f) {
			flagged[branch.function] = true
		}
	}
	want := map[string]bool{"Compares": true, "Reversed": true, "Literal": true, "Switches": true}
	if len(flagged) != len(want) {
		t.Fatalf("flagged = %v, want %v", flagged, want)
	}
	for function := range want {
		if !flagged[function] {
			t.Errorf("%s not flagged, want it flagged", function)
		}
	}
}
