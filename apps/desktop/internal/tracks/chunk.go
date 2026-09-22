package tracks

import "strings"

// node is a generic, untyped REAPER RPP chunk tree. RPP nests chunks as
//
//	<TAG param1 param2
//	  ATTR value1 value2
//	  <CHILDTAG ...
//	  >
//	>
//
// This parser only needs to walk that shape looking for specific tags
// (TRACK, ITEM, SOURCE) and attributes (NAME, POSITION, ...); it does not
// attempt to model every REAPER chunk type the way a general-purpose
// RPP editor (e.g. the rppp/rpp-parser projects) would.
type node struct {
	tag      string
	params   []string
	attrs    map[string][]string
	children []*node
	sequence []seqEntry
}

// seqEntry records one line of a chunk in file order: either an attribute
// occurrence (key/values) or a child chunk. attrs (a first-occurrence map)
// and children (every child, but typed by tag only) both lose information
// sequence keeps: a REAPER take repeats NAME, SOFFS, PLAYRATE, GUID and
// <SOURCE> once per take with no wrapping chunk of its own, and a <BIN>
// extension block's base64 is only reconstructable in the order its lines
// were written. The item-model parser superset (EL Phase 1) walks this to
// split an <ITEM> chunk into its takes and to decode extension data.
type seqEntry struct {
	key    string
	values []string
	child  *node
}

func (n *node) attr0(key string) string {
	values := n.attrs[key]
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

// childrenTagged returns every direct child with the given tag, in file order.
func (n *node) childrenTagged(tag string) []*node {
	var out []*node
	for _, child := range n.children {
		if child.tag == tag {
			out = append(out, child)
		}
	}
	return out
}

// firstChild returns the first direct child with the given tag, or nil.
func (n *node) firstChild(tag string) *node {
	for _, child := range n.children {
		if child.tag == tag {
			return child
		}
	}
	return nil
}

// parseChunks parses an entire .rpp file's text into a synthetic root node
// whose children are the file's top-level chunks (in practice exactly one:
// REAPER_PROJECT).
func parseChunks(text string) *node {
	root := &node{attrs: map[string][]string{}}
	stack := []*node{root}
	for _, raw := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if trimmed == "" {
			continue
		}
		top := stack[len(stack)-1]
		if trimmed == ">" {
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
			continue
		}
		if strings.HasPrefix(trimmed, "<") {
			tokens := tokenize(trimmed[1:])
			child := &node{attrs: map[string][]string{}}
			if len(tokens) > 0 {
				child.tag, child.params = tokens[0], tokens[1:]
			}
			top.children = append(top.children, child)
			top.sequence = append(top.sequence, seqEntry{child: child})
			stack = append(stack, child)
			continue
		}
		tokens := tokenize(trimmed)
		if len(tokens) == 0 {
			continue
		}
		// First occurrence wins for attrs: every scalar this package reads
		// once per chunk (NAME, POSITION, LENGTH, MUTESOLO, PEAKCOL,
		// TRACKID, FILE, IGUID, MUTE) appears at most once in REAPER's own
		// output. sequence keeps every occurrence, including repeats
		// (a take's own NAME/SOFFS/PLAYRATE/GUID).
		if _, exists := top.attrs[tokens[0]]; !exists {
			top.attrs[tokens[0]] = tokens[1:]
		}
		top.sequence = append(top.sequence, seqEntry{key: tokens[0], values: tokens[1:]})
	}
	return root
}

// tokenize splits one RPP line into whitespace-separated tokens, honoring
// REAPER's "safe string" quoting: a value containing whitespace is wrapped
// in whichever of ", ', or ` doesn't itself appear in the value. A value
// containing all three (vanishingly rare in practice - REAPER falls back to
// its own escape format in that case) is read as a bare, unquoted token
// instead of failing the whole line.
func tokenize(line string) []string {
	var tokens []string
	i, n := 0, len(line)
	for i < n {
		for i < n && isSpace(line[i]) {
			i++
		}
		if i >= n {
			break
		}
		if quote := line[i]; quote == '"' || quote == '\'' || quote == '`' {
			j := i + 1
			for j < n && line[j] != quote {
				j++
			}
			tokens = append(tokens, line[i+1:j])
			if j < n {
				j++
			}
			i = j
			continue
		}
		j := i
		for j < n && !isSpace(line[j]) {
			j++
		}
		tokens = append(tokens, line[i:j])
		i = j
	}
	return tokens
}

func isSpace(b byte) bool { return b == ' ' || b == '\t' }
