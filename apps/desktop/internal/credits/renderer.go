// Package credits renders audiobook opening/closing credit templates: bracketed
// `[Token]` placeholders resolved from a flat value map, with `{...}` optional
// segments that drop cleanly (their own punctuation and whitespace with them)
// when any token inside them has no value (PRD audiobook-credits-templates.prd.md,
// Open Questions C1-C12; C5's "optional segments yes"). One renderer is used by
// every surface that shows credits text (Settings preview now; the estimate and
// the teleprompter in later phases), so what a narrator previews is exactly what
// gets counted and read (PRD "Technical Approach").
//
// Callers: apps/desktop's credits bindings (creditsbindings.go, Phase 1); the
// audiobook estimate and the teleprompter call this in later phases. Public API:
// Render, Result, ParseTokens.
package credits

import (
	"regexp"
	"strings"
)

// Result is what Render returns: the resolved text exactly as it will be read,
// its word count (a plain whitespace split, matching the teleprompter tokenizer
// contract so a preview's count equals the estimate's), and the token names that
// had no non-empty value, in first-seen order with no duplicates ("unresolved
// tokens are reported by name", Success Metrics).
type Result struct {
	Text       string   `json:"text"`
	Words      int      `json:"words"`
	Unresolved []string `json:"unresolved"`
}

var tokenPattern = regexp.MustCompile(`\[([^\[\]{}]+)\]`)

// Render fills template's `[Token]` placeholders from values and drops any
// `{...}` optional segment whose own tokens are not all resolved. An unresolved
// token outside an optional segment is left visible in the output (never
// rendered as empty text, C6: "Read by ." on a recording is worse than a
// warning) and named in Result.Unresolved. Segment syntax does not nest.
func Render(template string, values map[string]string) Result {
	var unresolved []string
	seen := map[string]bool{}
	noteUnresolved := func(name string) {
		if !seen[name] {
			seen[name] = true
			unresolved = append(unresolved, name)
		}
	}

	var text strings.Builder
	remaining := template
	for {
		open := strings.IndexByte(remaining, '{')
		if open == -1 {
			text.WriteString(renderTokens(remaining, values, noteUnresolved))
			break
		}
		close := strings.IndexByte(remaining[open:], '}')
		if close == -1 {
			// An unclosed '{' is not a segment; treat the rest as literal/token text.
			text.WriteString(renderTokens(remaining, values, noteUnresolved))
			break
		}
		close += open
		text.WriteString(renderTokens(remaining[:open], values, noteUnresolved))
		segment := remaining[open+1 : close]
		if resolved, ok := renderSegmentIfComplete(segment, values); ok {
			text.WriteString(resolved)
		}
		remaining = remaining[close+1:]
	}

	return Result{Text: text.String(), Words: len(strings.Fields(text.String())), Unresolved: unresolved}
}

// renderTokens replaces every `[Token]` in fragment, reporting a token with no
// non-empty value to onUnresolved and leaving its placeholder text in place.
func renderTokens(fragment string, values map[string]string, onUnresolved func(string)) string {
	return tokenPattern.ReplaceAllStringFunc(fragment, func(match string) string {
		name := tokenPattern.FindStringSubmatch(match)[1]
		if value, ok := values[name]; ok && value != "" {
			return value
		}
		onUnresolved(name)
		return match
	})
}

// renderSegmentIfComplete resolves every token in segment and returns it with
// ok=false when any of its own tokens has no non-empty value, so the caller
// drops the segment (and its literal punctuation) instead of showing a partial,
// unresolved fragment. A segment's own tokens never reach the caller's
// Unresolved list - dropping them silently is the point of making them optional.
func renderSegmentIfComplete(segment string, values map[string]string) (string, bool) {
	complete := true
	resolved := tokenPattern.ReplaceAllStringFunc(segment, func(match string) string {
		name := tokenPattern.FindStringSubmatch(match)[1]
		if value, ok := values[name]; ok && value != "" {
			return value
		}
		complete = false
		return match
	})
	if !complete {
		return "", false
	}
	return resolved, true
}

// ParseTokens returns the token names referenced anywhere in template
// (including inside optional segments), in first-seen order with no
// duplicates. It is used to validate or list a template's vocabulary without
// rendering it.
func ParseTokens(template string) []string {
	var names []string
	seen := map[string]bool{}
	for _, match := range tokenPattern.FindAllStringSubmatch(template, -1) {
		name := match[1]
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}
