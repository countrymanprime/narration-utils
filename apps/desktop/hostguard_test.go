package main

import (
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
// lock is already held (or nothing else can see the Host yet). This list does
// not shrink: it is the reasoning, not a debt.
var permanentDirectReaders = map[string]string{
	"NewHost":         "builds the Host before any other goroutine can see it",
	"configureLocked": "the only writer of the fields; its caller holds h.mu",
	"canAttachLocked": "runs inside attachProjectLocked, whose caller holds h.mu",
	"services":        "the accessor: the one place that reads the fields under the lock",
}

// directReadAllowlist is the ratchet: functions that still read a swappable
// field directly, and so still race with a project switch. It can only shrink.
// A function that no longer reads a field must be removed (the guard fails
// on a stale entry), and adding one needs a written reason in the pull request.
// Keep it sorted, one name per line, so concurrent edits rebase cleanly.
var directReadAllowlist = []string{
	"Bootstrap",
	"GuideCreate",
	"GuideDelete",
	"GuideEdit",
	"GuideEntities",
	"GuideMerge",
	"GuidePreview",
	"GuideRelate",
	"GuideRescan",
	"GuideSetLocked",
	"GuideUnrelate",
	"ManuscriptBeginImport",
	"ManuscriptChapters",
	"ManuscriptClearProjectData",
	"ManuscriptCreateBookmark",
	"ManuscriptCreateNote",
	"ManuscriptDeleteBookmark",
	"ManuscriptDeleteNote",
	"ManuscriptImportCancel",
	"ManuscriptImportCommit",
	"ManuscriptImportPreview",
	"ManuscriptImportState",
	"ManuscriptNotes",
	"ManuscriptParagraphs",
	"ManuscriptReader",
	"ManuscriptReaderState",
	"ManuscriptSaveReaderState",
	"ManuscriptSearch",
	"ManuscriptSelectFile",
	"ManuscriptSetChapterStatus",
	"TranscriptAddEquivalence",
	"TranscriptCancel",
	"TranscriptExportMarkers",
	"TranscriptHints",
	"TranscriptJump",
	"TranscriptLastCompleted",
	"TranscriptReset",
	"TranscriptSaveHints",
	"TranscriptStart",
	"TranscriptSuggestHints",
	"TtsCatalog",
	"TtsRemove",
	"WhisperCatalog",
	"WhisperRemove",
	"resolveWhisperModelID",
	"saveSettings",
	"seedCharacterCandidates",
	"settingsForScope",
	"startGuideBuild",
	"startTtsInstall",
	"startWhisperInstall",
}

type directRead struct {
	function string
	field    string
	position token.Position
}

// hostNames returns the names a function uses for a Host: its receiver and any
// parameter whose type is Host or *Host.
func hostNames(function *ast.FuncDecl) map[string]bool {
	names := map[string]bool{}
	collect := func(fields *ast.FieldList) {
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
	collect(function.Recv)
	collect(function.Type.Params)
	return names
}

// directHostReads lists every selection of a swappable field on a Host inside
// file's functions, closures included.
func directHostReads(fset *token.FileSet, file *ast.File) []directRead {
	var reads []directRead
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		hosts := hostNames(function)
		if len(hosts) == 0 {
			continue
		}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok || !swappableHostFields[selector.Sel.Name] {
				return true
			}
			if owner, ok := selector.X.(*ast.Ident); ok && hosts[owner.Name] {
				reads = append(reads, directRead{function.Name.Name, selector.Sel.Name, fset.Position(selector.Pos())})
			}
			return true
		})
	}
	return reads
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

	allowed := map[string]bool{}
	for index, name := range directReadAllowlist {
		if index > 0 && name <= directReadAllowlist[index-1] {
			t.Errorf("directReadAllowlist must be sorted with no duplicates: %q follows %q", name, directReadAllowlist[index-1])
		}
		allowed[name] = true
	}

	var unexpected, stale []string
	for name, reads := range violations {
		if _, permanent := permanentDirectReaders[name]; permanent || allowed[name] {
			continue
		}
		first := reads[0]
		unexpected = append(unexpected, first.position.String()+": "+name+" reads h."+first.field+" directly; take a snapshot with h.services() instead")
	}
	for name := range allowed {
		if _, permanent := permanentDirectReaders[name]; permanent {
			stale = append(stale, name+" is permanently allowed; remove it from directReadAllowlist")
		} else if len(violations[name]) == 0 {
			stale = append(stale, name+" no longer reads a swappable field directly; remove it from directReadAllowlist")
		}
	}
	sort.Strings(unexpected)
	sort.Strings(stale)
	for _, message := range unexpected {
		t.Error(message)
	}
	for _, message := range stale {
		t.Error(message)
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

// The guard is only worth having if it fires. These fixtures are parsed the
// same way as the real sources.
func TestHostGuardFlagsDirectReadsAndIgnoresSnapshots(t *testing.T) {
	const source = `package main

func (h *Host) Bad() { _ = h.guide }
func (host *Host) BadAlias() { host.settings.Global("x") }
func BadParam(target *Host) { target.tts = nil }
func (h *Host) BadClosure() { go func() { h.transcript.Poll() }() }
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
	want := map[string]string{"Bad": "guide", "BadAlias": "settings", "BadParam": "tts", "BadClosure": "transcript"}
	if len(flagged) != len(want) {
		t.Fatalf("flagged = %v, want %v", flagged, want)
	}
	for name, field := range want {
		if flagged[name] != field {
			t.Errorf("%s: flagged %q, want %q (all flagged: %v)", name, flagged[name], field, flagged)
		}
	}
}
