package audacitybridge

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Command is one scripting command: a name and its parameters, in order. Build it with NewCommand and the typed setters, which
// refuse (through Err) any value the documented syntax cannot carry; Encode then writes `Name: Key=value Key="text"`.
//
// Audacity splits the parameters with wxWidgets' command-line splitter and then un-escapes each value, replacing \n, \" and \\ in
// that order (CommandParameters::Unescape; the spec note, "Quoting and escaping"). The order means no escaping is safe: `\\n` comes
// out as a backslash and a newline. So a string never carries a backslash or a double quote at all: text is refused (SanitizeText
// replaces them first), and a path is written with forward slashes, which Windows accepts. The pipe server deletes every CR and LF
// it reads, so a line break is refused too, and the whole line must fit Audacity's 1024-byte read buffer.
type Command struct {
	name   string
	params []param
	err    error
}

type param struct {
	key, value string
}

// NewCommand starts a command. A name that is not a plain identifier (letters and digits, starting with a letter) is refused.
func NewCommand(name string) *Command {
	c := &Command{name: name}
	if !isIdentifier(name) {
		c.err = fmt.Errorf("%w: command name %q", ErrInvalidValue, name)
	}
	return c
}

// Name is the command's name.
func (c *Command) Name() string { return c.name }

// Err is the first value this command refused, or nil.
func (c *Command) Err() error { return c.err }

// String adds a double-quoted text parameter. The text must be valid UTF-8 with no double quote, backslash or control character
// (SanitizeText makes label text fit).
func (c *Command) String(key, value string) *Command {
	if c.checkKey(key) {
		if err := checkText(value); err != nil {
			c.err = fmt.Errorf("%w: %s: %v", ErrInvalidValue, key, err)
		} else {
			c.params = append(c.params, param{key, `"` + value + `"`})
		}
	}
	return c
}

// Path adds a double-quoted file path. It must be an absolute path on a local drive (`C:\...` or `C:/...`): a relative path would
// resolve against Audacity's own working folder, and a UNC or device path (`\\server\share`, `\\?\...`) could send the
// narrator's audio off the machine or reach a device (D72). Backslashes are written as forward slashes (see Command), and a path
// with a double quote, a control character or a `..` element is refused.
func (c *Command) Path(key, path string) *Command {
	if c.checkKey(key) {
		if err := checkPath(path); err != nil {
			c.err = fmt.Errorf("%w: %s: %v", ErrInvalidValue, key, err)
		} else {
			c.params = append(c.params, param{key, `"` + strings.ReplaceAll(path, `\`, "/") + `"`})
		}
	}
	return c
}

func checkPath(path string) error {
	if len(path) < 3 || !isDriveLetter(path[0]) || path[1] != ':' || (path[2] != '\\' && path[2] != '/') {
		return fmt.Errorf("not an absolute path on a local drive")
	}
	for _, part := range strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." {
			return fmt.Errorf("has a .. element")
		}
	}
	return checkText(strings.ReplaceAll(path, `\`, "/"))
}

func isDriveLetter(b byte) bool { return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') }

// Float adds a number parameter, written in the C locale with no exponent. A NaN or infinity is refused.
func (c *Command) Float(key string, value float64) *Command {
	if c.checkKey(key) {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			c.err = fmt.Errorf("%w: %s is not a finite number", ErrInvalidValue, key)
		} else {
			c.params = append(c.params, param{key, strconv.FormatFloat(value, 'f', -1, 64)})
		}
	}
	return c
}

// Int adds an integer parameter.
func (c *Command) Int(key string, value int) *Command {
	if c.checkKey(key) {
		c.params = append(c.params, param{key, strconv.Itoa(value)})
	}
	return c
}

// Bool adds a boolean parameter, as Audacity writes them: 1 or 0.
func (c *Command) Bool(key string, value bool) *Command {
	if c.checkKey(key) {
		v := "0"
		if value {
			v = "1"
		}
		c.params = append(c.params, param{key, v})
	}
	return c
}

// Choice adds an enumerated parameter (Type=Labels, Format=JSON, RelativeTo=ProjectStart). It must be a plain identifier: a
// choice is always one of the command's own names, never data.
func (c *Command) Choice(key, value string) *Command {
	if c.checkKey(key) {
		if !isIdentifier(value) {
			c.err = fmt.Errorf("%w: %s choice %q", ErrInvalidValue, key, value)
		} else {
			c.params = append(c.params, param{key, value})
		}
	}
	return c
}

// Encode is the command line, with no terminator (the transport's framing adds it), or Err when a value was refused.
func (c *Command) Encode() (string, error) {
	if c.err != nil {
		return "", c.err
	}
	var b strings.Builder
	b.WriteString(c.name)
	b.WriteByte(':')
	for _, p := range c.params {
		b.WriteByte(' ')
		b.WriteString(p.key)
		b.WriteByte('=')
		b.WriteString(p.value)
	}
	if b.Len() > maxLineBytes {
		return "", fmt.Errorf("%w: the command is %d bytes, more than Audacity reads (%d)", ErrInvalidValue, b.Len(), maxLineBytes)
	}
	return b.String(), nil
}

func (c *Command) checkKey(key string) bool {
	if c.err != nil {
		return false
	}
	if !isIdentifier(key) {
		c.err = fmt.Errorf("%w: parameter name %q", ErrInvalidValue, key)
		return false
	}
	return true
}

// Audacity reads each command into a 1024-byte buffer (ScripterCallback), line ending included, so a longer line would be cut.
// maxLineBytes leaves room for CR, LF and NUL; maxTextBytes bounds one value well inside it.
const (
	maxLineBytes = 1020
	maxTextBytes = 900
)

func checkText(value string) error {
	if !utf8.ValidString(value) {
		return fmt.Errorf("not valid UTF-8")
	}
	if len(value) > maxTextBytes {
		return fmt.Errorf("longer than %d bytes", maxTextBytes)
	}
	for _, r := range value {
		switch {
		case r == '"':
			return fmt.Errorf("contains a double quote")
		case r == '\\':
			return fmt.Errorf("contains a backslash")
		case unicode.IsControl(r):
			return fmt.Errorf("contains a control character (U+%04X)", r)
		case r == '\u2028' || r == '\u2029':
			return fmt.Errorf("contains a line separator")
		}
	}
	return nil
}

// SanitizeText makes free text (a finding's words, a chapter title) fit a String value: a double quote becomes a right double
// quotation mark, every control character or line separator becomes a space, and the result is cut to a whole character within
// max bytes (max <= 0 or above the command limit means the limit). A backslash becomes U+2216 (set minus), which looks like one.
// Invalid UTF-8 becomes U+FFFD. Label text the host builds goes through it; a path never does (Path refuses what it cannot carry,
// because a changed path names another file).
func SanitizeText(value string, max int) string {
	if max <= 0 || max > maxTextBytes {
		max = maxTextBytes
	}
	var b strings.Builder
	for _, r := range strings.ToValidUTF8(value, "\uFFFD") {
		switch {
		case r == '"':
			r = '\u201D'
		case r == '\\':
			r = '\u2216'
		case unicode.IsControl(r), r == '\u2028', r == '\u2029':
			r = ' '
		}
		if b.Len()+utf8.RuneLen(r) > max {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}

func isIdentifier(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for i, r := range s {
		isLetter := (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z')
		isDigit := r >= '0' && r <= '9'
		if !isLetter && (i == 0 || !isDigit) {
			return false
		}
	}
	return true
}
