package audacitybridge_test

import (
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge/audacitybridgetest"
)

func TestCommandEncoding(t *testing.T) {
	cases := []struct {
		name string
		cmd  *audacitybridge.Command
		want string
	}{
		{"no parameters", audacitybridge.NewCommand("AddLabel"), "AddLabel:"},
		{"text is quoted", audacitybridge.NewCommand("SetLabel").Int("Label", 3).String("Text", "nu:f1 a word"), `SetLabel: Label=3 Text="nu:f1 a word"`},
		{"numbers in the C locale, no exponent", audacitybridge.NewCommand("SelectTime").Float("Start", 0.0000015).Float("End", 12345678.25), "SelectTime: Start=0.0000015 End=12345678.25"},
		{"booleans are 1 and 0", audacitybridge.NewCommand("OpenProject2").Bool("AddToHistory", false).Bool("X", true), "OpenProject2: AddToHistory=0 X=1"},
		{"a choice is bare", audacitybridge.NewCommand("GetInfo").Choice("Type", "Labels").Choice("Format", "JSON"), "GetInfo: Type=Labels Format=JSON"},
		{"a path uses forward slashes", audacitybridge.NewCommand("Export2").Path("Filename", `C:\narration\new take.wav`), `Export2: Filename="C:/narration/new take.wav"`},
		{"unicode text passes", audacitybridge.NewCommand("SetLabel").String("Text", "Zoë’s ‘line’ — ok"), `SetLabel: Text="Zoë’s ‘line’ — ok"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.cmd.Encode()
			if err != nil {
				t.Fatalf("Encode: %v", err)
			}
			if got != tc.want {
				t.Errorf("Encode = %q, want %q", got, tc.want)
			}
		})
	}
}

// Every value the syntax cannot carry is refused before anything reaches the pipe, never escaped or passed through.
func TestCommandRefusesWhatTheSyntaxCannotCarry(t *testing.T) {
	cases := []struct {
		name string
		cmd  *audacitybridge.Command
	}{
		{"a double quote would end the value", audacitybridge.NewCommand("SetLabel").String("Text", `a" Label=0 Text="b`)},
		{"a backslash is un-escaped by Audacity", audacitybridge.NewCommand("SetLabel").String("Text", `a\nb`)},
		{"a line break ends the command", audacitybridge.NewCommand("SetLabel").String("Text", "a\nb")},
		{"a carriage return", audacitybridge.NewCommand("SetLabel").String("Text", "a\rb")},
		{"a NUL", audacitybridge.NewCommand("SetLabel").String("Text", "a\x00b")},
		{"a line separator", audacitybridge.NewCommand("SetLabel").String("Text", "a\u2028b")},
		{"invalid UTF-8", audacitybridge.NewCommand("SetLabel").String("Text", "a\xffb")},
		{"too long for one value", audacitybridge.NewCommand("SetLabel").String("Text", strings.Repeat("a", 901))},
		{"too long for Audacity's buffer", audacitybridge.NewCommand("SetLabel").String("A", strings.Repeat("a", 600)).String("B", strings.Repeat("b", 600))},
		{"NaN", audacitybridge.NewCommand("SelectTime").Float("Start", math.NaN())},
		{"infinity", audacitybridge.NewCommand("SelectTime").Float("End", math.Inf(1))},
		{"a command name with a colon", audacitybridge.NewCommand("Export2: Filename")},
		{"an empty command name", audacitybridge.NewCommand("")},
		{"a key with a space", audacitybridge.NewCommand("SetLabel").String("Text X", "a")},
		{"a key with an equals sign", audacitybridge.NewCommand("SetLabel").Int("Label=1 Text", 1)},
		{"a choice that is data", audacitybridge.NewCommand("GetInfo").Choice("Type", "Labels Format=LISP")},
		{"a relative path", audacitybridge.NewCommand("Export2").Path("Filename", `take.wav`)},
		{"a UNC path leaves the machine", audacitybridge.NewCommand("Export2").Path("Filename", `\\server\share\take.wav`)},
		{"a forward-slash UNC path", audacitybridge.NewCommand("Export2").Path("Filename", `//server/share/take.wav`)},
		{"a device path", audacitybridge.NewCommand("Export2").Path("Filename", `\\?\C:\take.wav`)},
		{"a drive-relative path", audacitybridge.NewCommand("Export2").Path("Filename", `C:take.wav`)},
		{"a .. element", audacitybridge.NewCommand("Export2").Path("Filename", `C:\book\..\..\Windows\take.wav`)},
		{"a quote in a path", audacitybridge.NewCommand("Export2").Path("Filename", `C:\a"b.wav`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			line, err := tc.cmd.Encode()
			if !errors.Is(err, audacitybridge.ErrInvalidValue) {
				t.Fatalf("Encode = %q, %v; want ErrInvalidValue", line, err)
			}
		})
	}
}

// The first refusal sticks: later setters add nothing, and the error names the first bad value.
func TestCommandKeepsTheFirstRefusal(t *testing.T) {
	cmd := audacitybridge.NewCommand("SetLabel").String("Text", `"`).Int("Label", 1)
	if err := cmd.Err(); err == nil || !strings.Contains(err.Error(), "Text") {
		t.Fatalf("Err = %v, want the Text refusal", err)
	}
}

// Whatever SanitizeText returns, String accepts, and Audacity's own parser (the fake's, which mirrors it) reads back exactly
// that text as one parameter.
func TestSanitizedTextRoundTripsThroughAudacitysParser(t *testing.T) {
	inputs := []string{
		`plain`, `she said "no"`, `C:\path\name`, "tab\there", "line\nbreak\r\n", "\u2028sep\u2029", "bad\xffutf8",
		`a" Label=0 Text="b`, `\n\"\\`, strings.Repeat("é", 800), "",
	}
	for _, in := range inputs {
		text := audacitybridge.SanitizeText(in, 0)
		line, err := audacitybridge.NewCommand("SetLabel").Int("Label", 0).String("Text", text).Encode()
		if err != nil {
			t.Errorf("SanitizeText(%q) = %q, which String refuses: %v", in, text, err)
			continue
		}
		parsed, err := audacitybridgetest.ParseCommand(line)
		if err != nil {
			t.Errorf("%q: the parser refused %q: %v", in, line, err)
			continue
		}
		if parsed.Params["Text"] != text || parsed.Params["Label"] != "0" || len(parsed.Params) != 2 {
			t.Errorf("%q: parsed %+v, want Label=0 Text=%q", in, parsed.Params, text)
		}
	}
}

func TestSanitizeTextCutsOnACharacterBoundary(t *testing.T) {
	got := audacitybridge.SanitizeText("aéé", 4)
	if got != "aé" {
		t.Errorf("SanitizeText = %q, want %q", got, "aé")
	}
}

// A path is written with forward slashes precisely because Audacity's un-escaping would turn `\n` in C:\narration into a line
// break: the parsed path must be the same file.
func TestAPathSurvivesAudacitysUnescaping(t *testing.T) {
	line, err := audacitybridge.NewCommand("Export2").Path("Filename", `C:\narration\book\n01.wav`).Encode()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := audacitybridgetest.ParseCommand(line)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Params["Filename"]; got != "C:/narration/book/n01.wav" {
		t.Errorf("Filename = %q", got)
	}
}
