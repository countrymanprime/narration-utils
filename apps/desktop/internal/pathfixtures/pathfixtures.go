// Package pathfixtures is the one shared set of paths every function that resolves a project, DAW project or manuscript path is
// tested against (definition of done, rule 1, "Paths"). It is test support, in the way of net/http/httptest: nothing in the app
// imports it, only _test.go files do.
//
// Two shapes of fixture, because a path has two lives:
//
//   - Texts and Names are pure strings. They run on any OS and prove a function does not panic, does not claim to have found
//     what is not there, and keeps the text it was given. Many of them (a UNC path, a \\?\ prefix, a drive letter) only mean
//     something to Windows; on Linux they are just odd file names, which is still a fair thing to hand a resolver.
//   - Run builds Places on disk under a temp folder: a project folder holding a REAPER project file and a manuscript, or the
//     absence of one, spelled the way the class says. Cases the OS cannot create (a UNC share, a junction without rights, a
//     \\?\ path on Linux) skip with a reason a reader can see in the test output.
//
// A resolver test walks every fixture and states what the resolver must do for it; a new class is added here once and every
// resolver's test picks it up.
package pathfixtures

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// Class names a kind of path the owner has found, or could find, breaking a resolver.
type Class string

// The classes. Each is the name of one or more fixtures.
const (
	OutsideStartingFolder Class = "outside-starting-folder"
	NestedDeep            Class = "nested-deep"
	Spaces                Class = "spaces"
	UnicodeAccented       Class = "unicode-accented"
	UnicodeCJK            Class = "unicode-cjk"
	UnicodeEmoji          Class = "unicode-emoji"
	UnicodeRTL            Class = "unicode-rtl"
	LongOver260           Class = "long-over-260"
	LongPathPrefix        Class = "long-path-prefix"
	UNC                   Class = "unc"
	CaseDiffers           Class = "case-differs"
	TrailingDotSpace      Class = "trailing-dot-space"
	Junction              Class = "junction-or-symlink"
	ReadOnlyFile          Class = "read-only-file"
	ReadOnlyFolder        Class = "read-only-folder"
	Missing               Class = "missing"
	FileForFolder         Class = "file-where-folder-expected"
	FolderForFile         Class = "folder-where-file-expected"
	Empty                 Class = "empty"
	Relative              Class = "relative"
	DotDot                Class = "dot-dot-segments"
	ForwardSlashes        Class = "forward-slashes"
	Plain                 Class = "plain"
)

// Text is a pure-string path: no file behind it. Path is meant to be handed to a function that takes a project folder, a DAW
// project file or a manuscript file; none of these exists on any machine.
type Text struct {
	Name  string
	Class Class
	Path  string
	// WindowsForm is true when the text is only a path on Windows (a drive letter, a UNC share, the \\?\ prefix, trailing dots).
	WindowsForm bool
}

// Texts returns the pure-string fixtures. The order is stable.
func Texts() []Text {
	long := `C:\Books\` + strings.Repeat(`a-very-long-folder-name-`, 4) // 96 characters, repeated below to pass 260
	longPath := long + `\` + long + `\` + long + `\Show.rpp`
	return []Text{
		{"outside-starting-folder", OutsideStartingFolder, `D:\Audio Jobs\Elsewhere\Show.rpp`, true},
		{"nested-deep", NestedDeep, `C:\a\b\c\d\e\f\g\h\i\j\k\l\m\n\o\p\Show.rpp`, true},
		{"spaces", Spaces, `C:\My Books\The  Long   Book\Show Final.rpp`, true},
		{"unicode-accented", UnicodeAccented, `C:\Livres\Café Résumé\Été à Zürich.rpp`, true},
		{"unicode-cjk", UnicodeCJK, `C:\本\朗読 プロジェクト\ショー.rpp`, true},
		{"unicode-emoji", UnicodeEmoji, `C:\Books\Book 📚🎙️\Show 🎧.rpp`, true},
		{"unicode-rtl", UnicodeRTL, `C:\Books\كتاب עברית\عرض.rpp`, true},
		{"long-over-260", LongOver260, longPath, true},
		{"long-path-prefix", LongPathPrefix, `\\?\` + longPath, true},
		{"long-path-prefix-unc", LongPathPrefix, `\\?\UNC\nu-test-server.invalid\share\Books\Show.rpp`, true},
		{"unc", UNC, `\\nu-test-server.invalid\share\Books\Show.rpp`, true},
		{"case-differs", CaseDiffers, `c:\USERS\narrator\BOOKS\show.RPP`, true},
		{"trailing-dot-in-file", TrailingDotSpace, `C:\Books\Show.rpp.`, true},
		{"trailing-space-in-file", TrailingDotSpace, `C:\Books\Show.rpp `, true},
		{"trailing-dot-in-folder", TrailingDotSpace, `C:\Books\My Book.\Show.rpp`, true},
		{"trailing-space-in-folder", TrailingDotSpace, `C:\Books\My Book \Show.rpp`, true},
		{"empty", Empty, ``, false},
		{"relative", Relative, `Books\Show.rpp`, false},
		{"relative-dot", Relative, `.\Show.rpp`, false},
		{"relative-climbing", Relative, `..\..\Show.rpp`, false},
		{"drive-relative", Relative, `C:Show.rpp`, true},
		{"dot-dot-segments", DotDot, `C:\Books\Other\..\Show.rpp`, true},
		{"forward-slashes", ForwardSlashes, `C:/Books/My Book/Show.rpp`, true},
		{"mixed-slashes", ForwardSlashes, `C:/Books\Sub/Show.rpp`, true},
		{"embedded-nul", Plain, "C:\\Books\\Show\x00.rpp", false},
		{"device-name", Plain, `\\.\COM1`, true},
		{"just-a-separator", Plain, `\`, false},
		{"just-spaces", Plain, `   `, false},
	}
}

// Name is a candidate project name (a single folder name the narrator types), and whether a project may be called that.
type Name struct {
	Name  string
	Class Class
	Value string
	// Valid is whether project.ValidateName must accept the name once the caller has trimmed surrounding spaces, as
	// ProjectCreateIn does.
	Valid bool
}

// Names returns the project-name fixtures. The order is stable.
func Names() []Name {
	return []Name{
		{"plain", Plain, "My Book", true},
		{"spaces-inside", Spaces, "The   Long  Book", true},
		{"trailing-space-is-trimmed", TrailingDotSpace, "My Book  ", true},
		{"trailing-dot", TrailingDotSpace, "My Book.", false},
		{"trailing-dots", TrailingDotSpace, "My Book...", false},
		{"trailing-dot-then-space", TrailingDotSpace, "My Book. ", false},
		{"only-dots", TrailingDotSpace, "...", false},
		{"inner-dot", Plain, "Vol. 2 - Part One", true},
		{"leading-dot", Plain, ".hidden", true},
		{"accented", UnicodeAccented, "Café Résumé", true},
		{"cjk", UnicodeCJK, "朗読プロジェクト", true},
		{"emoji", UnicodeEmoji, "Book 📚🎙️", true},
		{"rtl", UnicodeRTL, "كتاب עברית", true},
		{"empty", Empty, "", false},
		{"only-spaces", Empty, "   ", false},
		{"dot", DotDot, ".", false},
		{"dot-dot", DotDot, "..", false},
		{"dot-dot-segment", DotDot, `..\Other`, false},
		{"forward-slash", ForwardSlashes, "a/b", false},
		{"back-slash", ForwardSlashes, `a\b`, false},
		{"drive-colon", Plain, "C:Book", false},
		{"unc-ish", UNC, `\\server\share`, false},
		{"reserved", Plain, "CON", false},
		{"reserved-lower-with-extension", Plain, "nul.txt", false},
		{"reserved-with-space-before-extension", Plain, "CON .txt", false},
		{"reserved-lookalike", Plain, "CONSOLE", true},
		{"control-character", Plain, "Book\x07", false},
		{"embedded-nul", Plain, "Book\x00", false},
		{"wildcard", Plain, "Book*", false},
		{"exactly-255-characters", LongOver260, strings.Repeat("a", 255), true},
		{"256-characters", LongOver260, strings.Repeat("a", 256), false},
		{"300-cjk-characters", LongOver260, strings.Repeat("本", 300), false},
	}
}

// Alias is another spelling of the same place on disk: the same folder, project file and manuscript reached by different text
// (a letter case, a forward slash, a trailing separator, a `..` segment, a junction). A resolver given the alias must treat it
// as the place it names.
type Alias struct {
	Name       string
	Dir        string
	RPP        string
	Manuscript string
}

// Place is one fixture on disk, under a temp folder the test owns.
type Place struct {
	Name  string
	Class Class

	// Start is the stand-in for the starting folder (~/NarrationStudio): it exists, is empty of projects, and does not contain
	// Dir unless the class is Plain.
	Start string

	// Dir is the project folder as the resolver is handed it, RPP the DAW project file and Manuscript the manuscript file.
	// All three are spelled the way the class says. They may be empty, relative, missing or the wrong kind of entry.
	Dir        string
	RPP        string
	Manuscript string

	// Usable is true when Dir is a real folder that holds RPP (a real file) and Manuscript (a real file). A resolver given a
	// usable place must find and use it; given any other, it must say "not found" or refuse, never panic, never act on a
	// neighbouring path.
	Usable bool

	// DirReadOnly and FileReadOnly are true when the OS really refuses a write into Dir or to RPP here. They are probed, not
	// assumed: a root user, or Windows (where a read-only attribute on a folder does not stop new files), is not blocked, and
	// then these stay false so a test does not assert a refusal the OS will not give.
	DirReadOnly  bool
	FileReadOnly bool

	// Aliases are other spellings of the same place.
	Aliases []Alias
}

type builder struct {
	name  string
	class Class
	build func(t *testing.T, root string) Place
}

// Run builds every Place in its own temp folder and calls fn once per place in a subtest named for the fixture. A place the OS
// cannot build skips with its reason.
func Run(t *testing.T, fn func(t *testing.T, p Place)) {
	t.Helper()
	for _, b := range builders() {
		t.Run(b.name, func(t *testing.T) {
			root := t.TempDir()
			place := b.build(t, root)
			place.Name, place.Class = b.name, b.class
			place.Aliases = append(place.Aliases, spellings(t, place)...)
			place.Start = filepath.Join(root, "NarrationStudio")
			if err := os.MkdirAll(place.Start, 0o755); err != nil {
				t.Fatal(err)
			}
			fn(t, place)
		})
	}
}

// spellings are the respellings every usable, absolute place gets: forward slashes, a trailing separator and a `..` detour.
func spellings(t *testing.T, p Place) []Alias {
	if !p.Usable || !filepath.IsAbs(p.Dir) || strings.HasPrefix(p.Dir, `\\?\`) {
		return nil
	}
	// Join would clean the `..` away, which is the one thing this spelling must keep.
	if err := os.MkdirAll(filepath.Join(filepath.Dir(p.Dir), "Detour"), 0o755); err != nil {
		t.Fatal(err)
	}
	detour := raw(filepath.Dir(p.Dir), "Detour", "..", filepath.Base(p.Dir))
	return []Alias{
		{"forward-slashes", filepath.ToSlash(p.Dir), filepath.ToSlash(p.RPP), filepath.ToSlash(p.Manuscript)},
		{"trailing-separator", p.Dir + string(filepath.Separator), p.RPP, p.Manuscript},
		{"dot-dot-detour", detour, raw(detour, filepath.Base(p.RPP)), raw(detour, filepath.Base(p.Manuscript))},
	}
}

// PlaceNames lists the place fixtures' names, so a test can state which fixtures it covers.
func PlaceNames() []string {
	var names []string
	for _, b := range builders() {
		names = append(names, b.name)
	}
	return names
}

const (
	rppFile        = "Show.rpp"
	manuscriptFile = "manuscript.md"
)

func builders() []builder {
	usable := func(name string, class Class, folder func(root string) string, file string) builder {
		return builder{name, class, func(t *testing.T, root string) Place {
			return usablePlace(t, folder(root), file)
		}}
	}
	return []builder{
		usable("plain", Plain, func(root string) string { return filepath.Join(root, "Project") }, rppFile),
		usable("outside-starting-folder", OutsideStartingFolder, func(root string) string { return filepath.Join(root, "Elsewhere", "On Another Drive", "Project") }, rppFile),
		usable("nested-deep", NestedDeep, func(root string) string {
			return filepath.Join(root, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "Project")
		}, rppFile),
		usable("spaces", Spaces, func(root string) string { return filepath.Join(root, "My  Audio   Book (draft 2)") }, "Show Final.rpp"),
		usable("unicode-accented", UnicodeAccented, func(root string) string { return filepath.Join(root, "Café Résumé") }, "Été à Zürich.rpp"),
		usable("unicode-cjk", UnicodeCJK, func(root string) string { return filepath.Join(root, "朗読 プロジェクト") }, "ショー.rpp"),
		usable("unicode-emoji", UnicodeEmoji, func(root string) string { return filepath.Join(root, "Book 📚🎙️") }, "Show 🎧.rpp"),
		usable("unicode-rtl", UnicodeRTL, func(root string) string { return filepath.Join(root, "كتاب עברית") }, "عرض.rpp"),
		usable("long-over-260", LongOver260, func(root string) string {
			dir := root
			for i := 0; len(dir) <= 300; i++ {
				dir = filepath.Join(dir, strings.Repeat("long-folder-name-", 3)+string(rune('a'+i%26)))
			}
			return dir
		}, rppFile),
		{"long-path-prefix", LongPathPrefix, func(t *testing.T, root string) Place {
			if runtime.GOOS != "windows" {
				t.Skip(`the \\?\ prefix is a Windows path form; the pure-string long-path-prefix cases cover its text here`)
			}
			dir := root
			for i := 0; len(dir) <= 300; i++ {
				dir = filepath.Join(dir, strings.Repeat("long-folder-name-", 3)+string(rune('a'+i%26)))
			}
			place := usablePlace(t, `\\?\`+dir, rppFile)
			return place
		}},
		{"unc", UNC, func(t *testing.T, root string) Place {
			t.Skip(`a test cannot create a network share; the pure-string UNC cases cover its text, and a real \\server\share path is not exercised`)
			return Place{}
		}},
		{"case-differs", CaseDiffers, func(t *testing.T, root string) Place {
			dir := filepath.Join(root, "Case Book")
			place := usablePlace(t, dir, "Show.rpp")
			upper := filepath.Join(root, "CASE BOOK")
			if _, err := os.Stat(filepath.Join(upper, "Show.rpp")); err != nil {
				t.Skip("this filesystem is case-sensitive, so a different case names a different folder (Windows is the supported platform)")
			}
			place.Aliases = append(place.Aliases, Alias{"upper-case", upper, filepath.Join(upper, "SHOW.RPP"), filepath.Join(upper, "MANUSCRIPT.MD")})
			return place
		}},
		{"trailing-dot-name", TrailingDotSpace, func(t *testing.T, root string) Place {
			// Win32 strips a trailing dot from a name: "Book." is made as the folder "Book". The project must still resolve by the
			// spelling the narrator gave.
			return usablePlace(t, filepath.Join(root, "Trailing dot."), rppFile)
		}},
		{"trailing-space-name", TrailingDotSpace, func(t *testing.T, root string) Place {
			t.Skip("Win32 strips a trailing space from a name, so the supported platform cannot make such a folder; the pure-string trailing-space cases cover the text")
			return Place{}
		}},
		{"junction-or-symlink", Junction, func(t *testing.T, root string) Place {
			real := usablePlace(t, filepath.Join(root, "Real Project"), rppFile)
			link := filepath.Join(root, "Link To Project")
			if err := makeLink(real.Dir, link); err != nil {
				t.Skip("this machine cannot create a symlink or junction here: " + err.Error())
			}
			place := real
			place.Aliases = append(place.Aliases, Alias{"through-the-link", link, filepath.Join(link, rppFile), filepath.Join(link, manuscriptFile)})
			return place
		}},
		{"read-only-file", ReadOnlyFile, func(t *testing.T, root string) Place {
			place := usablePlace(t, filepath.Join(root, "Project"), rppFile)
			for _, file := range []string{place.RPP, place.Manuscript} {
				if err := os.Chmod(file, 0o400); err != nil {
					t.Fatal(err)
				}
			}
			t.Cleanup(func() { _ = os.Chmod(place.RPP, 0o600); _ = os.Chmod(place.Manuscript, 0o600) })
			place.FileReadOnly = writeRefused(place.RPP)
			return place
		}},
		{"read-only-folder", ReadOnlyFolder, func(t *testing.T, root string) Place {
			place := usablePlace(t, filepath.Join(root, "Project"), rppFile)
			err := os.Chmod(place.Dir, 0o555) //nolint:gosec // a read-only folder still needs its search bit, or nothing in it can be opened
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(place.Dir, 0o700) }) //nolint:gosec // a folder needs its search bit so the temp dir can be removed
			place.DirReadOnly = createRefused(place.Dir)
			return place
		}},
		{"missing", Missing, func(t *testing.T, root string) Place {
			dir := filepath.Join(root, "No Such Project")
			return Place{Dir: dir, RPP: filepath.Join(dir, rppFile), Manuscript: filepath.Join(dir, manuscriptFile)}
		}},
		{"file-where-folder-expected", FileForFolder, func(t *testing.T, root string) Place {
			dir := filepath.Join(root, "Project")
			writeFile(t, dir, []byte("this is a file, not a folder"))
			return Place{Dir: dir, RPP: filepath.Join(dir, rppFile), Manuscript: filepath.Join(dir, manuscriptFile)}
		}},
		{"folder-where-file-expected", FolderForFile, func(t *testing.T, root string) Place {
			dir := filepath.Join(root, "Project")
			for _, name := range []string{rppFile, manuscriptFile, "manuscript.docx"} {
				if err := os.MkdirAll(filepath.Join(dir, name), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			return Place{Dir: dir, RPP: filepath.Join(dir, rppFile), Manuscript: filepath.Join(dir, manuscriptFile)}
		}},
		{"empty", Empty, func(t *testing.T, root string) Place {
			t.Chdir(root) // a resolver that wrongly reads "" as "here" would find or write in this folder
			return Place{}
		}},
		{"relative", Relative, func(t *testing.T, root string) Place {
			absolute := usablePlace(t, filepath.Join(root, "Project"), rppFile)
			t.Chdir(root)
			place := Place{Dir: "Project", RPP: filepath.Join("Project", rppFile), Manuscript: filepath.Join("Project", manuscriptFile), Usable: true}
			place.Aliases = append(place.Aliases, Alias{"absolute", absolute.Dir, absolute.RPP, absolute.Manuscript})
			return place
		}},
		{"dot-dot-segments", DotDot, func(t *testing.T, root string) Place {
			real := usablePlace(t, filepath.Join(root, "Project"), rppFile)
			detour := filepath.Join(root, "Detour", "Deeper")
			if err := os.MkdirAll(detour, 0o755); err != nil {
				t.Fatal(err)
			}
			via := raw(detour, "..", "..", "Project")
			place := real
			place.Dir, place.RPP, place.Manuscript = via, raw(via, rppFile), raw(via, manuscriptFile)
			place.Aliases = append(place.Aliases, Alias{"clean", real.Dir, real.RPP, real.Manuscript})
			return place
		}},
		{"forward-slashes", ForwardSlashes, func(t *testing.T, root string) Place {
			real := usablePlace(t, filepath.Join(root, "My Project"), rppFile)
			place := real
			place.Dir, place.RPP, place.Manuscript = filepath.ToSlash(real.Dir), filepath.ToSlash(real.RPP), filepath.ToSlash(real.Manuscript)
			place.Aliases = append(place.Aliases,
				Alias{"back-slashes", real.Dir, real.RPP, real.Manuscript},
				Alias{"trailing-separator", real.Dir + string(filepath.Separator), real.RPP, real.Manuscript},
			)
			return place
		}},
	}
}

// usablePlace creates dir holding the rpp file and a manuscript.md.
func usablePlace(t *testing.T, dir, rpp string) Place {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("cannot create the fixture folder %q: %v", dir, err)
	}
	place := Place{Dir: dir, RPP: filepath.Join(dir, rpp), Manuscript: filepath.Join(dir, manuscriptFile), Usable: true}
	writeFile(t, place.RPP, []byte("<REAPER_PROJECT 0.1 \"7.0\" 1\n>\n"))
	writeFile(t, place.Manuscript, []byte("# Chapter One\n\nIt was a dark and stormy night.\n"))
	return place
}

// raw joins parts with the OS separator and cleans nothing, so `..` segments survive.
func raw(parts ...string) string { return strings.Join(parts, string(filepath.Separator)) }

func writeFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatalf("cannot create the fixture file %q: %v", path, err)
	}
}

// makeLink makes link a symlink to target, or on Windows a junction (which needs no privilege, unlike a symlink).
func makeLink(target, link string) error {
	if runtime.GOOS == "windows" {
		command := exec.Command("cmd", "/c", "mklink", "/J", link, target) //nolint:gosec // the arguments are fixture paths made by the test
		out, err := command.CombinedOutput()
		if err != nil {
			return &linkError{string(out), err}
		}
		return nil
	}
	return os.Symlink(target, link)
}

type linkError struct {
	output string
	err    error
}

func (e *linkError) Error() string { return strings.TrimSpace(e.output) + " (" + e.err.Error() + ")" }

// writeRefused reports whether opening file for writing is refused.
func writeRefused(file string) bool {
	handle, err := os.OpenFile(file, os.O_WRONLY, 0)
	if err != nil {
		return true
	}
	_ = handle.Close()
	return false
}

// createRefused reports whether creating a new file in dir is refused.
func createRefused(dir string) bool {
	probe := filepath.Join(dir, ".nu-write-probe")
	handle, err := os.OpenFile(probe, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o600)
	if err != nil {
		return true
	}
	_ = handle.Close()
	_ = os.Remove(probe)
	return false
}
