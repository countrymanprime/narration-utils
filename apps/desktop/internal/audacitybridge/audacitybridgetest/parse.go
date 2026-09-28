package audacitybridgetest

import (
	"fmt"
	"strings"
)

// Parsed is one command line as Audacity's parameter parser reads it: the name before the colon, then space-separated Key=value
// pairs where a value is either up to the next space or, when it starts with a double quote, up to the next double quote (no
// splitter escapes), and then each value is un-escaped as CommandParameters::Unescape does: \n, then \", then \\. The fake parses
// exactly that way, so a value the client failed to guard would change the parsed command here too.
type Parsed struct {
	Name   string
	Params map[string]string
	Order  []string
}

// audacityText is an error whose text is what Audacity itself answers (capitalised, several lines), sent back as the reply body.
type audacityText string

func (a audacityText) Error() string { return string(a) }

// ParseCommand parses one command line (without its line ending).
func ParseCommand(line string) (Parsed, error) {
	name, rest, ok := strings.Cut(line, ":")
	if !ok {
		return Parsed{}, audacityText("Syntax error!\nCommand is missing ':'")
	}
	p := Parsed{Name: strings.TrimSpace(name), Params: map[string]string{}}
	i := 0
	for {
		for i < len(rest) && rest[i] == ' ' {
			i++
		}
		if i >= len(rest) {
			return p, nil
		}
		eq := strings.IndexByte(rest[i:], '=')
		if eq < 0 {
			return Parsed{}, audacityText(fmt.Sprintf("Syntax error!\nParameter %q has no value", rest[i:]))
		}
		key := rest[i : i+eq]
		i += eq + 1
		var value string
		if i < len(rest) && rest[i] == '"' {
			end := strings.IndexByte(rest[i+1:], '"')
			if end < 0 {
				return Parsed{}, audacityText("Syntax error!\nUnterminated quote")
			}
			value = rest[i+1 : i+1+end]
			i += end + 2
		} else {
			end := strings.IndexByte(rest[i:], ' ')
			if end < 0 {
				end = len(rest) - i
			}
			value = rest[i : i+end]
			i += end
		}
		if _, dup := p.Params[key]; !dup {
			p.Order = append(p.Order, key)
		}
		p.Params[key] = unescape(value)
	}
}

// unescape is CommandParameters::Unescape, in its order.
func unescape(v string) string {
	v = strings.ReplaceAll(v, `\n`, "\n")
	v = strings.ReplaceAll(v, `\"`, `"`)
	return strings.ReplaceAll(v, `\\`, `\`)
}
