package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// swappableHostFields are the Host fields configureLocked reassigns on every
// project switch. Reading one of them straight off the Host, without holding
// h.mu, races with that reassignment; every reader goes through h.services()
// (see services.go).
var swappableHostFields = map[string]bool{
	"guide":        true,
	"manuscript":   true,
	"settings":     true,
	"teleprompter": true,
	"transcript":   true,
	"tts":          true,
	"whisper":      true,
}

// permanentDirectReaders may touch the swappable fields directly because the
// lock is already held. This list does not shrink: it is the reasoning, not a
// debt. (NewHost builds its fields with a composite literal before any other
// goroutine can see the Host, which the guard cannot flag, so it needs no entry.)
var permanentDirectReaders = map[string]string{
	"configureLocked": "the only writer of the fields; its caller holds h.mu",
	"canAttachLocked": "runs inside attachProjectLocked, whose caller holds h.mu",
	"services":        "the accessor: the one place that reads the fields under the lock",
}

// directReadAllowlist is the ratchet: functions that still read swappable
// fields directly, with how many reads each has, and so still race with a
// project switch. It can only shrink. Converting a read must lower its count
// (the guard fails on a count that is too high, and on one that is too low), a
// function with no reads left must be removed, and a new entry needs a written
// reason in the pull request. Keep it sorted, one name per line, so concurrent
// edits rebase cleanly.
var directReadAllowlist = []allowedReads{}

type allowedReads struct {
	function string
	reads    int
}

type directRead struct {
	function string
	field    string
	position token.Position
}

// closureName attributes reads inside a package-level function literal.
const closureName = "(package-level closure)"

// unwrapHost returns the identifier under parentheses and dereferences, so
// (*h).guide is seen as h.guide.
func unwrapHost(expression ast.Expr) (string, bool) {
	for {
		switch typed := expression.(type) {
		case *ast.ParenExpr:
			expression = typed.X
		case *ast.StarExpr:
			expression = typed.X
		case *ast.Ident:
			return typed.Name, true
		default:
			return "", false
		}
	}
}

// addHostParams records the names in fields whose type is Host or *Host.
func addHostParams(names map[string]bool, fields *ast.FieldList) {
	if fields == nil {
		return
	}
	for _, field := range fields.List {
		typeExpr := field.Type
		if star, ok := typeExpr.(*ast.StarExpr); ok {
			typeExpr = star.X
		}
		if ident, ok := typeExpr.(*ast.Ident); ok && ident.Name == "Host" {
			for _, name := range field.Names {
				names[name.Name] = true
			}
		}
	}
}

// producesHost reports whether expression evaluates to a Host the function
// already tracks: another name for it, NewHost(), or a &Host{} literal.
func producesHost(expression ast.Expr, hosts map[string]bool) bool {
	if name, ok := unwrapHost(expression); ok {
		return hosts[name]
	}
	switch typed := expression.(type) {
	case *ast.CallExpr:
		callee, ok := typed.Fun.(*ast.Ident)
		return ok && callee.Name == "NewHost"
	case *ast.UnaryExpr:
		literal, ok := typed.X.(*ast.CompositeLit)
		if !ok || typed.Op != token.AND {
			return false
		}
		ident, ok := literal.Type.(*ast.Ident)
		return ok && ident.Name == "Host"
	}
	return false
}

// scanHostUse walks one function body (closures included) and reports each
// selection of a swappable field on a Host, and each h.services() call.
// Hosts are found by receiver, by parameter type (closure parameters too) and
// by simple aliases (x := h, x := NewHost(), x := &Host{}).
func scanHostUse(fset *token.FileSet, name string, body ast.Node, hosts map[string]bool, onRead func(directRead), onServices func(token.Position)) {
	ast.Inspect(body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.FuncLit:
			addHostParams(hosts, typed.Type.Params)
		case *ast.AssignStmt:
			for index, right := range typed.Rhs {
				if left, ok := typed.Lhs[min(index, len(typed.Lhs)-1)].(*ast.Ident); ok && producesHost(right, hosts) {
					hosts[left.Name] = true
				}
			}
		case *ast.SelectorExpr:
			owner, ok := unwrapHost(typed.X)
			if !ok || !hosts[owner] {
				return true
			}
			if swappableHostFields[typed.Sel.Name] {
				onRead(directRead{name, typed.Sel.Name, fset.Position(typed.Pos())})
			}
			if typed.Sel.Name == "services" && onServices != nil {
				onServices(fset.Position(typed.Pos()))
			}
		}
		return true
	})
}

// directHostReads lists every selection of a swappable field on a Host in
// file's functions and package-level function literals.
func directHostReads(fset *token.FileSet, file *ast.File) []directRead {
	var reads []directRead
	collect := func(read directRead) { reads = append(reads, read) }
	for _, declaration := range file.Decls {
		switch typed := declaration.(type) {
		case *ast.FuncDecl:
			if typed.Body == nil {
				continue
			}
			hosts := map[string]bool{}
			addHostParams(hosts, typed.Recv)
			addHostParams(hosts, typed.Type.Params)
			scanHostUse(fset, typed.Name.Name, typed.Body, hosts, collect, nil)
		case *ast.GenDecl:
			scanHostUse(fset, closureName, typed, map[string]bool{}, collect, nil)
		}
	}
	return reads
}

// servicesCallsInLocked lists the h.services() calls made from unexported
// functions whose name ends in "Locked" (configureLocked, attachProjectLocked;
// the exported GuideSetLocked binding is not one). Their caller already holds
// h.mu, so the accessor's RLock would self-deadlock (a write lock is held) or
// deadlock behind a queued writer (a read lock is held).
func servicesCallsInLocked(fset *token.FileSet, file *ast.File) []string {
	var calls []string
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil || !strings.HasSuffix(function.Name.Name, "Locked") || function.Name.IsExported() {
			continue
		}
		hosts := map[string]bool{}
		addHostParams(hosts, function.Recv)
		addHostParams(hosts, function.Type.Params)
		scanHostUse(fset, function.Name.Name, function.Body, hosts, func(directRead) {}, func(position token.Position) {
			calls = append(calls, fmt.Sprintf("%s: %s calls services() but its caller holds h.mu", position, function.Name.Name))
		})
	}
	return calls
}

func parseHostSources(t *testing.T) (*token.FileSet, []*ast.File) {
	t.Helper()
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
	if len(files) == 0 {
		t.Fatal("found no Go sources to check; the guard must run from the package directory")
	}
	return fset, files
}

func TestHostReadsSwappableServicesOnlyThroughTheAccessor(t *testing.T) {
	fset, files := parseHostSources(t)
	violations := map[string][]directRead{}
	for _, file := range files {
		for _, read := range directHostReads(fset, file) {
			violations[read.function] = append(violations[read.function], read)
		}
	}

	allowed := map[string]int{}
	for index, entry := range directReadAllowlist {
		if index > 0 && entry.function <= directReadAllowlist[index-1].function {
			t.Errorf("directReadAllowlist must be sorted with no duplicates: %q follows %q", entry.function, directReadAllowlist[index-1].function)
		}
		if entry.reads < 1 {
			t.Errorf("directReadAllowlist entry %q has %d reads; remove an entry with none", entry.function, entry.reads)
		}
		allowed[entry.function] = entry.reads
	}

	var problems []string
	for name, reads := range violations {
		if _, permanent := permanentDirectReaders[name]; permanent {
			continue
		}
		budget, listed := allowed[name]
		if listed && len(reads) == budget {
			continue
		}
		first := reads[0]
		switch {
		case !listed:
			problems = append(problems, fmt.Sprintf("%s: %s reads h.%s directly (%d reads); take a snapshot with h.services() instead", first.position, name, first.field, len(reads)))
		case len(reads) > budget:
			problems = append(problems, fmt.Sprintf("%s: %s has %d direct reads, more than its allowlist count of %d; use h.services() for the new one", reads[budget].position, name, len(reads), budget))
		default:
			problems = append(problems, fmt.Sprintf("%s now has %d direct reads; lower its directReadAllowlist count from %d to %d", name, len(reads), budget, len(reads)))
		}
	}
	for name := range allowed {
		if _, permanent := permanentDirectReaders[name]; permanent {
			problems = append(problems, name+" is permanently allowed; remove it from directReadAllowlist")
		} else if len(violations[name]) == 0 {
			problems = append(problems, name+" no longer reads a swappable field directly; remove it from directReadAllowlist")
		}
	}
	sort.Strings(problems)
	for _, problem := range problems {
		t.Error(problem)
	}
}

func TestServicesIsNeverCalledWhileTheHostLockIsHeld(t *testing.T) {
	fset, files := parseHostSources(t)
	for _, file := range files {
		for _, call := range servicesCallsInLocked(fset, file) {
			t.Error(call)
		}
	}
}

func TestPermanentDirectReadersStillExist(t *testing.T) {
	_, files := parseHostSources(t)
	declared := map[string]bool{}
	for _, file := range files {
		for _, declaration := range file.Decls {
			if function, ok := declaration.(*ast.FuncDecl); ok {
				declared[function.Name.Name] = true
			}
		}
	}
	for name := range permanentDirectReaders {
		if !declared[name] {
			t.Errorf("permanentDirectReaders names %q, which is no longer declared; remove the entry", name)
		}
	}
}

// structFieldNames returns the field names of the named struct type in files.
func structFieldNames(files []*ast.File, typeName string) map[string]bool {
	for _, file := range files {
		for _, declaration := range file.Decls {
			general, ok := declaration.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range general.Specs {
				typeSpec, ok := spec.(*ast.TypeSpec)
				if !ok || typeSpec.Name.Name != typeName {
					continue
				}
				structType, ok := typeSpec.Type.(*ast.StructType)
				if !ok {
					continue
				}
				names := map[string]bool{}
				for _, field := range structType.Fields.List {
					for _, name := range field.Names {
						names[name.Name] = true
					}
				}
				return names
			}
		}
	}
	return nil
}

// configureLockedAssignments returns the Host fields configureLocked assigns
// (h.x = ..., including h.config.y = ...).
func configureLockedAssignments(files []*ast.File) map[string]bool {
	assigned := map[string]bool{}
	for _, file := range files {
		for _, declaration := range file.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Name.Name != "configureLocked" || function.Recv == nil || len(function.Recv.List[0].Names) == 0 {
				continue
			}
			receiver := function.Recv.List[0].Names[0].Name
			ast.Inspect(function.Body, func(node ast.Node) bool {
				assignment, ok := node.(*ast.AssignStmt)
				if !ok {
					return true
				}
				for _, left := range assignment.Lhs {
					selector, ok := left.(*ast.SelectorExpr)
					for ok {
						if owner, isIdent := selector.X.(*ast.Ident); isIdent && owner.Name == receiver {
							assigned[selector.Sel.Name] = true
							break
						}
						selector, ok = selector.X.(*ast.SelectorExpr)
					}
				}
				return true
			})
		}
	}
	return assigned
}

// The field list exists in four places that must agree: what configureLocked
// assigns, swappableHostFields, the Host struct and the hostServices snapshot
// (which also copies config). A field added to one and not the others would
// silently escape the guard or the snapshot.
func TestSwappableFieldsAgreeAcrossTheHostConfigureLockedAndTheSnapshot(t *testing.T) {
	_, files := parseHostSources(t)
	assigned := configureLockedAssignments(files)
	hostFields := structFieldNames(files, "Host")
	snapshotFields := structFieldNames(files, "hostServices")
	if len(assigned) == 0 || hostFields == nil || snapshotFields == nil {
		t.Fatalf("could not read configureLocked (%d assignments), Host (%v) or hostServices (%v)", len(assigned), hostFields != nil, snapshotFields != nil)
	}

	for field := range swappableHostFields {
		if !hostFields[field] {
			t.Errorf("swappableHostFields names %q, which is not a Host field", field)
		}
		if !snapshotFields[field] {
			t.Errorf("hostServices has no %q field; copy it in services()", field)
		}
	}
	if !snapshotFields["config"] {
		t.Error("hostServices must carry config")
	}
	for field := range assigned {
		if field != "config" && !swappableHostFields[field] {
			t.Errorf("configureLocked assigns h.%s, which is not in swappableHostFields; add it to the guard and to hostServices, or make it a set-once field", field)
		}
	}
	for field := range snapshotFields {
		if field != "config" && !swappableHostFields[field] {
			t.Errorf("hostServices carries %q, which is not in swappableHostFields", field)
		}
	}
}

// The guard is only worth having if it fires. These fixtures are parsed the
// same way as the real sources.
func TestHostGuardFlagsDirectReadsAndIgnoresSnapshots(t *testing.T) {
	const source = `package main

func (h *Host) Bad() { _ = h.guide }
func (host *Host) BadAlias() { host.settings.Global("x") }
func BadParam(target *Host) { target.tts = nil }
func (h *Host) BadClosure() { go func() { h.transcript.Poll() }() }
func (h *Host) BadDereference() { _ = (*h).whisper }
func (h *Host) BadLocalAlias() { other := h; _ = other.manuscript }
func BadConstructed() { app := NewHost(); _ = app.teleprompter }
func BadLiteral() { app := &Host{}; _ = app.guide }
func BadClosureParam() { func(x *Host) { _ = x.guide }(nil) }
var packageLevel = func(h *Host) { _ = h.settings }
func (h *Host) Good() { svc := h.services(); _ = svc.guide; _ = h.config; _ = h.recents }
func Unrelated(other *Other) { _ = other.guide }
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "fixture.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	flagged := map[string]string{}
	for _, read := range directHostReads(fset, file) {
		flagged[read.function] = read.field
	}
	want := map[string]string{
		"Bad": "guide", "BadAlias": "settings", "BadParam": "tts", "BadClosure": "transcript",
		"BadDereference": "whisper", "BadLocalAlias": "manuscript", "BadConstructed": "teleprompter",
		"BadLiteral": "guide", "BadClosureParam": "guide", closureName: "settings",
	}
	if len(flagged) != len(want) {
		t.Fatalf("flagged = %v, want %v", flagged, want)
	}
	for name, field := range want {
		if flagged[name] != field {
			t.Errorf("%s: flagged %q, want %q (all flagged: %v)", name, flagged[name], field, flagged)
		}
	}
}

func TestLockedGuardFlagsServicesCalledUnderTheLock(t *testing.T) {
	const source = `package main

func (h *Host) configureLocked() { _ = h.services() }
func (h *Host) attachLocked() { svc := h.services(); _ = svc }
func (h *Host) Binding() { _ = h.services() }
func (h *Host) GuideSetLocked() { _ = h.services() }
func (h *Host) canAttachLocked() bool { return h.config.projectFolder != "" }
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "fixture.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	calls := servicesCallsInLocked(fset, file)
	if len(calls) != 2 || !strings.Contains(calls[0], "configureLocked") || !strings.Contains(calls[1], "attachLocked") {
		t.Fatalf("calls = %v, want configureLocked and attachLocked only", calls)
	}
}
